import { randomUUID } from "node:crypto";
import { generateInstallationToken } from "../github/token-generator.js";

/**
 * Fleet manager interface — subset of platform-core's FleetManager
 * that we need for provisioning ephemeral holyshipper containers.
 */
export interface IFleetManager {
  create(opts: {
    tenantId: string;
    name: string;
    description: string;
    image: string;
    env: Record<string, string>;
    restartPolicy?: string;
  }): Promise<{ id: string }>;
  start(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface IServiceKeyRepo {
  generate(tenantId: string, instanceId: string): Promise<string>;
  revokeByInstance(instanceId: string): Promise<void>;
}

export interface ProvisionOpts {
  entityId: string;
  tenantId: string;
  installationId: number;
  discipline: string;
  repoFullName: string;
  fleet: IFleetManager;
  serviceKeyRepo: IServiceKeyRepo;
  gatewayUrl: string;
  holyshipUrl: string;
  holyshipperImage: string;
  githubAppId: string;
  githubAppPrivateKey: string;
}

export interface ProvisionResult {
  containerId: string;
  serviceKey: string;
  workerToken: string;
}

/**
 * Provision an ephemeral holyshipper container for a single issue.
 *
 * 1. Generate gateway service key (metered LLM inference)
 * 2. Generate GitHub App installation token (1hr, git push + API)
 * 3. Create + start holyshipper container via fleet
 */
export async function provisionHolyshipper(opts: ProvisionOpts): Promise<ProvisionResult> {
  const workerToken = randomUUID();

  // Gateway service key for metered inference
  const serviceKey = await opts.serviceKeyRepo.generate(opts.tenantId, opts.entityId);

  // GitHub App installation token (1 hour TTL)
  const { token: githubToken } = await generateInstallationToken(
    opts.installationId,
    opts.githubAppId,
    opts.githubAppPrivateKey,
  );

  // Create holyshipper container
  const profile = await opts.fleet.create({
    tenantId: opts.tenantId,
    name: `holyshipper-${opts.entityId.slice(0, 8)}`,
    description: `Holyshipper for entity ${opts.entityId}`,
    image: opts.holyshipperImage,
    env: {
      ANTHROPIC_API_KEY: serviceKey,
      ANTHROPIC_BASE_URL: opts.gatewayUrl,
      HOLYSHIP_URL: opts.holyshipUrl,
      HOLYSHIP_WORKER_TOKEN: workerToken,
      GITHUB_TOKEN: githubToken,
      HOLYSHIPPER_WORKSPACE: `/workspace/${opts.repoFullName.split("/").pop()}`,
      REPO_CLONE_URL: `https://x-access-token:${githubToken}@github.com/${opts.repoFullName}.git`,
      ENTITY_ID: opts.entityId,
      DISCIPLINE: opts.discipline,
    },
    restartPolicy: "no",
  });

  await opts.fleet.start(profile.id);

  return {
    containerId: profile.id,
    serviceKey,
    workerToken,
  };
}

/**
 * Tear down a holyshipper container and revoke its credentials.
 */
export async function teardownHolyshipper(opts: {
  containerId: string;
  fleet: IFleetManager;
  serviceKeyRepo: IServiceKeyRepo;
}): Promise<void> {
  // Revoke the service key first (stops billing immediately)
  try {
    await opts.serviceKeyRepo.revokeByInstance(opts.containerId);
  } catch {
    // Non-fatal — container removal is more important
  }

  // Remove the container
  try {
    await opts.fleet.remove(opts.containerId);
  } catch {
    // Container may already be gone
  }
}
