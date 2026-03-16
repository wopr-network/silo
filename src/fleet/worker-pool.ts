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
    logger.info("[worker-pool] initialized", {
      poolSize: this.poolSize,
      tierOverride: MODEL_TIER_OVERRIDE || "(none)",
    });
  }

  async emit(event: EngineEvent): Promise<void> {
    logger.debug("[worker-pool] event received", {
      type: event.type,
      entityId: "entityId" in event ? event.entityId : undefined,
    });

    // When an entity is created, claim it and directly schedule the worker.
    // claimWork emits entity.claimed but NOT invocation.created, so we
    // synthesize the event and feed it into the pool ourselves.
    if (event.type === "entity.created") {
      logger.info("[worker-pool] entity.created — claiming work", { entityId: event.entityId });
      try {
        const claimed = await this.engine.claimWork("engineering");
        if (claimed && typeof claimed === "object") {
          logger.info("[worker-pool] claimWork succeeded — scheduling worker directly", {
            claimedEntityId: claimed.entityId,
            invocationId: claimed.invocationId,
          });
          const syntheticEvent = {
            type: "invocation.created" as const,
            entityId: claimed.entityId,
            invocationId: claimed.invocationId,
            stage: claimed.stage,
            emittedAt: new Date(),
          };
          if (this.activeWorkers < this.poolSize) {
            void this.runWorker(syntheticEvent);
          } else {
            this.pending.push(syntheticEvent);
            logger.warn("[worker-pool] all slots busy — queued claimed work", {
              entityId: claimed.entityId,
              queueDepth: this.pending.length,
            });
          }
        } else {
          logger.warn("[worker-pool] claimWork returned no work", {
            entityId: event.entityId,
            result: String(claimed),
          });
        }
      } catch (err) {
        logger.error("[worker-pool] claimWork threw", {
          entityId: event.entityId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      return;
    }

    if (event.type !== "invocation.created") return;
    if ("mode" in event && event.mode === "passive") {
      logger.debug("[worker-pool] skipping passive invocation", { entityId: event.entityId });
      return;
    }

    logger.info("[worker-pool] invocation.created — scheduling worker", {
      entityId: event.entityId,
      invocationId: event.invocationId,
      stage: event.stage,
      activeWorkers: this.activeWorkers,
      poolSize: this.poolSize,
      queueDepth: this.pending.length,
    });

    if (this.activeWorkers < this.poolSize) {
      void this.runWorker(event);
    } else {
      this.pending.push(event);
      logger.warn("[worker-pool] all slots busy — queued", {
        entityId: event.entityId,
        queueDepth: this.pending.length,
        activeWorkers: this.activeWorkers,
      });
    }
  }

  private async runWorker(event: EngineEvent & { type: "invocation.created" }): Promise<void> {
    this.activeWorkers++;
    const workerId = this.activeWorkers;
    const tag = `[worker-${workerId}]`;

    logger.info(`${tag} starting`, {
      entityId: event.entityId,
      invocationId: event.invocationId,
      activeWorkers: this.activeWorkers,
    });

    try {
      await this.executeInvocation(workerId, event);
    } catch (err) {
      logger.error(`${tag} unhandled error`, {
        entityId: event.entityId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      this.activeWorkers--;
      logger.info(`${tag} finished`, {
        entityId: event.entityId,
        activeWorkers: this.activeWorkers,
        pendingCount: this.pending.length,
      });
      const next = this.pending.shift();
      if (next) {
        logger.info(`${tag} dequeuing next`, { nextEntityId: next.entityId });
        void this.runWorker(next);
      }
    }
  }

  private async executeInvocation(
    workerId: number,
    event: EngineEvent & { type: "invocation.created" },
  ): Promise<void> {
    const { entityId, invocationId, stage } = event;
    const tag = `[worker-${workerId}]`;

    // 1. Read invocation for prompt
    logger.info(`${tag} reading invocation`, { invocationId });
    const invocation = await this.invocationRepo.get(invocationId);
    if (!invocation) {
      logger.error(`${tag} invocation not found`, { invocationId });
      return;
    }
    if (!invocation.prompt) {
      logger.error(`${tag} invocation has no prompt`, { invocationId, agentRole: invocation.agentRole });
      return;
    }

    const { prompt } = invocation;
    const artifacts = invocation.artifacts ?? {};
    const repoFullName = (artifacts.repoFullName as string) ?? "";
    const [owner = "", repo = ""] = repoFullName.includes("/") ? repoFullName.split("/") : ["", ""];
    const issueNumber = Number(artifacts.issueNumber) || 0;
    const agentRole = invocation.agentRole;

    logger.info(`${tag} invocation loaded`, {
      entityId,
      invocationId,
      agentRole,
      promptLength: prompt.length,
      repoFullName: repoFullName || "(none)",
      issueNumber: issueNumber || "(none)",
    });

    let githubToken = "";
    try {
      githubToken = (await this.getGithubToken()) ?? "";
      logger.debug(`${tag} github token ${githubToken ? "obtained" : "empty"}`);
    } catch (err) {
      logger.warn(`${tag} github token failed`, { error: String(err) });
    }

    const provisionConfig: ProvisionConfig = { entityId, flowName: stage, owner, repo, issueNumber, githubToken };

    // 2. Provision container
    logger.info(`${tag} provisioning holyshipper container`, {
      entityId,
      stage,
      owner,
      repo,
      image: process.env.HOLYSHIP_WORKER_IMAGE ?? "(default)",
    });

    const dbRecordId = crypto.randomUUID();
    await this.db.insert(holyshipperContainers).values({
      id: dbRecordId,
      tenantId: this.tenantId,
      entityId,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    logger.debug(`${tag} DB record created`, { dbRecordId });

    let runnerUrl: string;
    let containerId: string;
    try {
      const provisionStart = Date.now();
      const result = await this.fleetManager.provision(entityId, provisionConfig);
      runnerUrl = result.runnerUrl;
      containerId = result.containerId;
      const provisionMs = Date.now() - provisionStart;

      logger.info(`${tag} container provisioned`, {
        entityId,
        containerId: containerId.slice(0, 12),
        runnerUrl,
        provisionMs,
      });

      await this.db
        .update(holyshipperContainers)
        .set({ containerId, runnerUrl, status: "running", provisionedAt: new Date(), updatedAt: new Date() })
        .where(eq(holyshipperContainers.id, dbRecordId));
    } catch (err) {
      logger.error(`${tag} provision FAILED`, {
        entityId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      await this.db
        .update(holyshipperContainers)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(holyshipperContainers.id, dbRecordId));
      return;
    }

    // 3. Dispatch prompt
    const modelTier = MODEL_TIER_OVERRIDE || AGENT_ROLE_TO_TIER[agentRole ?? ""] || "sonnet";
    logger.info(`${tag} dispatching prompt`, {
      entityId,
      invocationId,
      modelTier,
      tierSource: MODEL_TIER_OVERRIDE ? "env override" : `role:${agentRole ?? "default"}`,
      promptLength: prompt.length,
      runnerUrl,
    });

    try {
      const dispatchStart = Date.now();
      const res = await fetch(`${runnerUrl.replace(/\/$/, "")}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, modelTier }),
        signal: AbortSignal.timeout(600_000),
      });

      const dispatchMs = Date.now() - dispatchStart;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error(`${tag} dispatch HTTP error`, {
          entityId,
          status: res.status,
          body: text.slice(0, 500),
          dispatchMs,
        });
        await this.teardown(dbRecordId, containerId, tag, entityId);
        return;
      }

      logger.info(`${tag} dispatch response received`, { entityId, status: res.status, dispatchMs });

      // 4. Parse SSE result
      const body = await res.text();
      logger.debug(`${tag} SSE body length`, { entityId, bodyLength: body.length });

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

      logger.info(`${tag} SSE events parsed`, {
        entityId,
        eventCount: sseEvents.length,
        types: sseEvents.map((e) => e.type),
      });

      const resultEvent = sseEvents.find((e) => e.type === "result");
      if (!resultEvent) {
        logger.error(`${tag} no result event in SSE stream`, { entityId, eventTypes: sseEvents.map((e) => e.type) });
        await this.teardown(dbRecordId, containerId, tag, entityId);
        return;
      }

      const signal = (resultEvent.signal as string) ?? "";
      const resultArtifacts = (resultEvent.artifacts as Record<string, unknown>) ?? {};

      logger.info(`${tag} dispatch complete`, {
        entityId,
        signal: signal || "(empty)",
        artifactKeys: Object.keys(resultArtifacts),
        costUsd: resultEvent.costUsd,
        isError: resultEvent.isError,
        stopReason: resultEvent.stopReason,
      });

      // 5. Feed signal to engine — gate evaluation hits the still-running container
      if (signal) {
        logger.info(`${tag} processing signal`, { entityId, signal });
        try {
          const signalResult = await this.engine.processSignal(entityId, signal, resultArtifacts);
          logger.info(`${tag} signal processed`, {
            entityId,
            signal,
            result: JSON.stringify(signalResult).slice(0, 500),
          });
        } catch (err) {
          logger.error(`${tag} processSignal FAILED`, {
            entityId,
            signal,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      } else {
        logger.warn(`${tag} no signal in result — nothing to process`, { entityId });
      }
    } catch (err) {
      logger.error(`${tag} dispatch FAILED`, {
        entityId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // 6. Teardown — processSignal is sync so gates are done
    await this.teardown(dbRecordId, containerId, tag, entityId);
  }

  private async teardown(dbRecordId: string, containerId: string, tag: string, entityId: string): Promise<void> {
    logger.info(`${tag} tearing down container`, { entityId, containerId: containerId.slice(0, 12) });
    try {
      await this.fleetManager.teardown(containerId);
      logger.info(`${tag} container removed`, { entityId, containerId: containerId.slice(0, 12) });
    } catch (err) {
      logger.warn(`${tag} teardown failed (container may already be gone)`, {
        entityId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await this.db
      .update(holyshipperContainers)
      .set({ status: "torn_down", tornDownAt: new Date(), updatedAt: new Date() })
      .where(eq(holyshipperContainers.id, dbRecordId));
    logger.info(`${tag} teardown complete`, { entityId });
  }
}
