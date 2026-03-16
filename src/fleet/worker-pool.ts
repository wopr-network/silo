/**
 * Reactive Worker Pool — event-driven execution of invocations.
 *
 * Subscribes to engine events as an IEventBusAdapter. When invocation.created
 * fires, a worker claims it and runs the full lifecycle:
 *   provision container → dispatch prompt → collect signal → processSignal → teardown
 *
 * Concurrency is bounded by pool size. If all workers are busy, events queue.
 * No polling. No sleep loops. Purely reactive.
 */

import { eq } from "drizzle-orm";
import type { Engine } from "../engine/engine.js";
import type { EngineEvent, IEventBusAdapter } from "../engine/event-types.js";
import { logger } from "../logger.js";
import { holyshipperContainers } from "../repositories/drizzle/schema.js";
import type { IInvocationRepository } from "../repositories/interfaces.js";
import type { IFleetManager, ProvisionConfig } from "./provision-holyshipper.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
type Db = any;

const AGENT_ROLE_TO_TIER: Record<string, string> = {
  "wopr-architect": "sonnet",
  "wopr-coder": "sonnet",
  "wopr-reviewer": "haiku",
  "wopr-technical-writer": "haiku",
};

/** When set, overrides all tier selections — use "test" for free models in dev/staging */
const MODEL_TIER_OVERRIDE = process.env.HOLYSHIP_MODEL_TIER_OVERRIDE ?? "";

export interface WorkerPoolConfig {
  engine: Engine;
  db: Db;
  tenantId: string;
  fleetManager: IFleetManager;
  invocationRepo: IInvocationRepository;
  getGithubToken: () => Promise<string | null>;
  /** Max concurrent workers (containers). Default 4. */
  poolSize?: number;
}

export class WorkerPool implements IEventBusAdapter {
  private readonly engine: Engine;
  private readonly db: Db;
  private readonly tenantId: string;
  private readonly fleetManager: IFleetManager;
  private readonly invocationRepo: IInvocationRepository;
  private readonly getGithubToken: () => Promise<string | null>;
  private readonly poolSize: number;

  private activeWorkers = 0;
  private readonly pending: Array<EngineEvent & { type: "invocation.created" }> = [];

  constructor(config: WorkerPoolConfig) {
    this.engine = config.engine;
    this.db = config.db;
    this.tenantId = config.tenantId;
    this.fleetManager = config.fleetManager;
    this.invocationRepo = config.invocationRepo;
    this.getGithubToken = config.getGithubToken;
    this.poolSize = config.poolSize ?? 4;
  }

  async emit(event: EngineEvent): Promise<void> {
    // When an entity is created, claim it to build the first invocation
    if (event.type === "entity.created") {
      logger.info("[worker-pool] entity.created — claiming work", { entityId: event.entityId });
      await this.engine.claimWork("engineering");
      return;
    }

    if (event.type !== "invocation.created") return;
    if ("mode" in event && event.mode === "passive") return;

    if (this.activeWorkers < this.poolSize) {
      void this.runWorker(event);
    } else {
      this.pending.push(event);
      logger.info("[worker-pool] queued (all slots busy)", {
        entityId: event.entityId,
        queueDepth: this.pending.length,
        activeWorkers: this.activeWorkers,
      });
    }
  }

  private async runWorker(event: EngineEvent & { type: "invocation.created" }): Promise<void> {
    this.activeWorkers++;
    const workerId = this.activeWorkers;

    try {
      await this.executeInvocation(workerId, event);
    } catch (err) {
      logger.error(`[worker-${workerId}] unhandled error`, {
        entityId: event.entityId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.activeWorkers--;
      const next = this.pending.shift();
      if (next) void this.runWorker(next);
    }
  }

  private async executeInvocation(
    workerId: number,
    event: EngineEvent & { type: "invocation.created" },
  ): Promise<void> {
    const { entityId, invocationId, stage } = event;
    const tag = `[worker-${workerId}]`;

    // 1. Read invocation for prompt
    const invocation = await this.invocationRepo.get(invocationId);
    if (!invocation?.prompt) {
      logger.error(`${tag} invocation missing or no prompt`, { invocationId });
      return;
    }

    const { prompt } = invocation;
    const artifacts = invocation.artifacts ?? {};
    const repoFullName = (artifacts.repoFullName as string) ?? "";
    const [owner = "", repo = ""] = repoFullName.includes("/") ? repoFullName.split("/") : ["", ""];
    const issueNumber = Number(artifacts.issueNumber) || 0;
    const agentRole = invocation.agentRole;

    let githubToken = "";
    try {
      githubToken = (await this.getGithubToken()) ?? "";
    } catch (err) {
      logger.warn(`${tag} github token failed`, { error: String(err) });
    }

    const provisionConfig: ProvisionConfig = { entityId, flowName: stage, owner, repo, issueNumber, githubToken };

    // 2. Provision container
    logger.info(`${tag} provisioning`, { entityId, stage, owner, repo });

    const dbRecordId = crypto.randomUUID();
    await this.db.insert(holyshipperContainers).values({
      id: dbRecordId,
      tenantId: this.tenantId,
      entityId,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let runnerUrl: string;
    let containerId: string;
    try {
      const result = await this.fleetManager.provision(entityId, provisionConfig);
      runnerUrl = result.runnerUrl;
      containerId = result.containerId;

      await this.db
        .update(holyshipperContainers)
        .set({ containerId, runnerUrl, status: "running", provisionedAt: new Date(), updatedAt: new Date() })
        .where(eq(holyshipperContainers.id, dbRecordId));
    } catch (err) {
      logger.error(`${tag} provision failed`, { entityId, error: err instanceof Error ? err.message : String(err) });
      await this.db
        .update(holyshipperContainers)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(holyshipperContainers.id, dbRecordId));
      return;
    }

    // 3. Dispatch prompt
    const modelTier = MODEL_TIER_OVERRIDE || AGENT_ROLE_TO_TIER[agentRole ?? ""] || "sonnet";
    logger.info(`${tag} dispatching`, { entityId, invocationId, modelTier, promptLength: prompt.length });

    try {
      const res = await fetch(`${runnerUrl.replace(/\/$/, "")}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, modelTier }),
        signal: AbortSignal.timeout(600_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error(`${tag} dispatch HTTP error`, { entityId, status: res.status, body: text.slice(0, 500) });
        await this.teardown(dbRecordId, containerId, tag, entityId);
        return;
      }

      // 4. Parse SSE result
      const body = await res.text();
      const sseEvents = body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => {
          try {
            return JSON.parse(line.slice(5)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<Record<string, unknown>>;

      const resultEvent = sseEvents.find((e) => e.type === "result");
      if (!resultEvent) {
        logger.error(`${tag} no result in SSE stream`, { entityId });
        await this.teardown(dbRecordId, containerId, tag, entityId);
        return;
      }

      const signal = (resultEvent.signal as string) ?? "";
      const resultArtifacts = (resultEvent.artifacts as Record<string, unknown>) ?? {};

      logger.info(`${tag} dispatch complete`, {
        entityId,
        signal,
        artifactKeys: Object.keys(resultArtifacts),
        costUsd: resultEvent.costUsd,
      });

      // 5. Feed signal to engine — gate evaluation hits the still-running container
      if (signal) {
        await this.engine.processSignal(entityId, signal, resultArtifacts);
        logger.info(`${tag} signal processed`, { entityId, signal });
      } else {
        logger.warn(`${tag} no signal`, { entityId });
      }
    } catch (err) {
      logger.error(`${tag} dispatch failed`, { entityId, error: err instanceof Error ? err.message : String(err) });
    }

    // 6. Teardown — processSignal is sync so gates are done
    await this.teardown(dbRecordId, containerId, tag, entityId);
  }

  private async teardown(dbRecordId: string, containerId: string, tag: string, entityId: string): Promise<void> {
    try {
      await this.fleetManager.teardown(containerId);
    } catch (err) {
      logger.warn(`${tag} teardown failed`, { entityId, error: err instanceof Error ? err.message : String(err) });
    }
    await this.db
      .update(holyshipperContainers)
      .set({ status: "torn_down", tornDownAt: new Date(), updatedAt: new Date() })
      .where(eq(holyshipperContainers.id, dbRecordId));
    logger.info(`${tag} teardown complete`, { entityId });
  }
}
