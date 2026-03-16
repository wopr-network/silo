/**
 * HolyshipperFleetManager — wraps platform-core FleetManager for ephemeral containers.
 *
 * Each invocation gets a fresh container:
 *   1. FleetManager.create() — pull image, create + start container
 *   2. POST /credentials — inject gateway key + GitHub token
 *   3. POST /checkout — clone repo(s)
 *   4. Container is now ready for dispatch + gate evaluation
 *   5. FleetManager.remove() — stop + delete container on teardown
 *
 * Containers use restartPolicy "no" — they don't restart when the process exits.
 * The container stays alive between dispatch and gate evaluation (the worker-runtime
 * HTTP server keeps running), then is torn down on state transition.
 */

import type { FleetManager } from "@wopr-network/platform-core/fleet";
import { logger } from "../logger.js";
import type { IFleetManager, ProvisionConfig, ProvisionResult } from "./provision-holyshipper.js";

export interface HolyshipperFleetManagerConfig {
  /** Platform-core FleetManager instance (wraps Docker). */
  fleetManager: FleetManager;
  /** GHCR image for holyshipper workers. */
  image: string;
  /** Gateway URL for inference (e.g., "http://api:3001/v1"). */
  gatewayUrl: string;
  /** Gateway service key for authentication. */
  gatewayKey: string;
  /** Docker network to attach containers to (for /v1 access). */
  network?: string;
  /** Port the worker-runtime listens on inside the container. */
  containerPort?: number;
}

export class HolyshipperFleetManager implements IFleetManager {
  private readonly fleet: FleetManager;
  private readonly image: string;
  private readonly gatewayUrl: string;
  private readonly gatewayKey: string;
  private readonly network: string | undefined;
  private readonly containerPort: number;

  constructor(config: HolyshipperFleetManagerConfig) {
    this.fleet = config.fleetManager;
    this.image = config.image;
    this.gatewayUrl = config.gatewayUrl;
    this.gatewayKey = config.gatewayKey;
    this.network = config.network;
    this.containerPort = config.containerPort ?? 8080;
  }

  async provision(entityId: string, config: ProvisionConfig): Promise<ProvisionResult> {
    const profileId = crypto.randomUUID();
    const botName = `hs-${entityId.slice(0, 8)}-${Date.now()}`;

    logger.info("[fleet] provisioning holyshipper container", {
      botName,
      entityId,
      image: this.image,
      owner: config.owner,
      repo: config.repo,
    });

    // Build env vars for the container
    const env: Record<string, string> = {
      HOLYSHIP_GATEWAY_KEY: this.gatewayKey,
      HOLYSHIP_GATEWAY_URL: this.gatewayUrl,
      HOLYSHIP_ENTITY_ID: entityId,
      PORT: String(this.containerPort),
    };

    if (config.githubToken) {
      env.GH_TOKEN = config.githubToken;
      env.GITHUB_TOKEN = config.githubToken;
    }

    // Create + start ephemeral container via platform-core FleetManager
    const profile = await this.fleet.createAndStart({
      id: profileId,
      name: botName,
      tenantId: "holyship",
      image: this.image,
      env,
      restartPolicy: "no",
      description: `Ephemeral worker for entity ${entityId}`,
      updatePolicy: "manual",
      releaseChannel: "stable",
      network: this.network,
      ephemeral: true,
    });

    const containerId = profile.id;

    // Wait for container to be ready (health check)
    const runnerUrl = await this.waitForReady(containerId, botName);

    // Inject credentials
    await this.postCredentials(runnerUrl, config);

    // Checkout repo(s)
    if (config.owner && config.repo) {
      await this.postCheckout(runnerUrl, config);
    }

    logger.info("[fleet] holyshipper container ready", {
      botName,
      entityId,
      runnerUrl,
    });

    return { containerId, runnerUrl };
  }

  async teardown(containerId: string): Promise<void> {
    logger.info("[fleet] tearing down holyshipper container", { containerId });

    try {
      await this.fleet.remove(containerId);
    } catch (err) {
      logger.warn("[fleet] container removal failed (may already be gone)", {
        containerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async waitForReady(_containerId: string, botName: string, timeoutMs = 30_000): Promise<string> {
    const start = Date.now();
    const interval = 1000;

    // For now, construct URL from container name + network
    // In production this would inspect the container for the mapped port
    const runnerUrl = this.network
      ? `http://${botName}:${this.containerPort}`
      : `http://localhost:${this.containerPort}`;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${runnerUrl}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return runnerUrl;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    throw new Error(`Container ${botName} did not become ready within ${timeoutMs}ms`);
  }

  private async postCredentials(runnerUrl: string, config: ProvisionConfig): Promise<void> {
    const body: Record<string, unknown> = {
      gateway: { key: this.gatewayKey },
      gatewayUrl: this.gatewayUrl,
    };
    if (config.githubToken) {
      body.github = { token: config.githubToken };
    }

    const res = await fetch(`${runnerUrl}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Credential injection failed: HTTP ${res.status} — ${text}`);
    }

    logger.info("[fleet] credentials injected", { entityId: config.entityId });
  }

  private async postCheckout(runnerUrl: string, config: ProvisionConfig): Promise<void> {
    const repoFullName = config.owner && config.repo ? `${config.owner}/${config.repo}` : undefined;
    if (!repoFullName) return;

    const res = await fetch(`${runnerUrl}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: repoFullName,
        entityId: config.entityId,
      }),
      signal: AbortSignal.timeout(120_000), // Cloning can take a while
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Checkout failed: HTTP ${res.status} — ${text}`);
    }

    logger.info("[fleet] repo checked out", {
      entityId: config.entityId,
      repo: repoFullName,
    });
  }
}
