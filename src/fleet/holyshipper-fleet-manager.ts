/**
 * HolyshipperFleetManager — wraps platform-core FleetManager for ephemeral containers.
 *
 * Each invocation gets a fresh container:
 *   1. FleetManager.create() — pull image, create container, return Instance
 *   2. instance.start() — start the container
 *   3. Health check via instance.url
 *   4. POST /credentials — inject gateway key + GitHub token
 *   5. POST /checkout — clone repo(s)
 *   6. Container is now ready for dispatch + gate evaluation
 *   7. instance.remove() — stop + delete container on teardown
 *
 * Containers are ephemeral (no billing record, writable filesystem).
 * Token billing happens at the gateway layer, not per-instance.
 */

import type { FleetManager, Instance } from "@wopr-network/platform-core/fleet";
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
}

export class HolyshipperFleetManager implements IFleetManager {
  private readonly fleet: FleetManager;
  private readonly image: string;
  private readonly gatewayUrl: string;
  private readonly gatewayKey: string;
  private readonly network: string | undefined;

  /** Track live instances for teardown by containerId */
  private readonly instances = new Map<string, Instance>();

  constructor(config: HolyshipperFleetManagerConfig) {
    this.fleet = config.fleetManager;
    this.image = config.image;
    this.gatewayUrl = config.gatewayUrl;
    this.gatewayKey = config.gatewayKey;
    this.network = config.network;
  }

  async provision(entityId: string, config: ProvisionConfig): Promise<ProvisionResult> {
    const botName = `hs-${entityId.slice(0, 8)}-${Date.now()}`;

    logger.info("[fleet] provisioning holyshipper container", {
      botName,
      entityId,
      image: this.image,
      owner: config.owner,
      repo: config.repo,
    });

    const env: Record<string, string> = {
      HOLYSHIP_GATEWAY_KEY: this.gatewayKey,
      HOLYSHIP_GATEWAY_URL: this.gatewayUrl,
      HOLYSHIP_ENTITY_ID: entityId,
      PORT: "8080",
    };

    if (config.githubToken) {
      env.GH_TOKEN = config.githubToken;
      env.GITHUB_TOKEN = config.githubToken;
    }

    // Create ephemeral container — returns Instance with url
    const instance = await this.fleet.create({
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

    // Start the container
    await instance.start();

    // Track immediately so teardown works if later steps fail
    this.instances.set(instance.containerId, instance);
    const runnerUrl = instance.url;

    try {
      await this.waitForReady(runnerUrl, botName);

      // Inject credentials
      await this.postCredentials(runnerUrl, config);

      // Checkout repo(s)
      if (config.owner && config.repo) {
        await this.postCheckout(runnerUrl, config);
      }
    } catch (err) {
      // Clean up on mid-provision failure — don't leak containers
      logger.error("[fleet] mid-provision failure, cleaning up", {
        entityId,
        containerId: instance.containerId.slice(0, 12),
        error: err instanceof Error ? err.message : String(err),
      });
      await instance.remove().catch(() => {});
      this.instances.delete(instance.containerId);
      throw err;
    }

    logger.info("[fleet] holyshipper container ready", {
      botName,
      entityId,
      containerId: instance.containerId.slice(0, 12),
      runnerUrl,
    });

    return { containerId: instance.containerId, runnerUrl };
  }

  async teardown(containerId: string): Promise<void> {
    logger.info("[fleet] tearing down holyshipper container", { containerId: containerId.slice(0, 12) });

    const instance = this.instances.get(containerId);
    this.instances.delete(containerId);
    if (instance) {
      await instance.remove();
    } else {
      logger.warn("[fleet] no instance found for teardown — may already be gone", {
        containerId: containerId.slice(0, 12),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async waitForReady(runnerUrl: string, botName: string, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    const interval = 1000;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${runnerUrl}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return;
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
      signal: AbortSignal.timeout(120_000),
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
