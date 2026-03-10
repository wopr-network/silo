import { randomUUID } from "node:crypto";
import type { ClaimResponse, ReportResponse } from "../api/wire-types.js";
import { logger } from "../logger.js";
import { extractRepoFromDescription } from "../sources/linear/repo-extractor.js";
import { safeErrorMessage } from "../sources/sanitize.js";
import type { RunLoopConfig } from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 5000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const handler = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handler);
      resolve();
    }, ms);
    signal?.addEventListener("abort", handler, { once: true });
  });
}

function isWorkClaim(claim: ClaimResponse): claim is Extract<ClaimResponse, { entity_id: string }> {
  return "entity_id" in claim;
}

export class RunLoop {
  private config: RunLoopConfig;
  private pollIntervalMs: number;
  private abortController: AbortController | null = null;
  private slotPromises: Map<string, Promise<void>> = new Map();
  private pendingClaims = 0;
  private registeredWorkerId: string | null = null;

  constructor(config: RunLoopConfig) {
    this.config = config;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.abortController) throw new Error("RunLoop already started");
    this.abortController = new AbortController();
    const { workerRepo } = this.config;

    // Register worker in DB if repo provided
    let workerIdPrefix = `${this.config.workerIdPrefix ?? "wkr"}-${randomUUID().slice(0, 8)}`;
    try {
      if (workerRepo) {
        const hostname = globalThis.process?.env?.HOSTNAME ?? "unknown";
        const pid = globalThis.process?.pid ?? 0;
        const primaryDiscipline =
          this.config.workerDiscipline ?? this.config.role ?? this.config.roles?.[0]?.discipline ?? "unknown";
        const worker = await workerRepo.register({
          name: `${this.config.workerIdPrefix ?? "wkr"}-${hostname}-${pid}`,
          type: this.config.workerType ?? "unknown",
          discipline: primaryDiscipline,
        });
        this.registeredWorkerId = worker.id;
        workerIdPrefix = worker.id;

        // Heartbeat once per process per interval (not per slot per cycle)
        const heartbeatTimer = setInterval(() => {
          if (this.registeredWorkerId && this.config.workerRepo) {
            void this.config.workerRepo.heartbeat(this.registeredWorkerId).catch(() => {
              // Non-fatal — heartbeat failure shouldn't crash the loop
            });
          }
        }, this.pollIntervalMs);
        this.abortController.signal.addEventListener("abort", () => clearInterval(heartbeatTimer), { once: true });
      }
    } catch (err) {
      this.abortController = null;
      throw err;
    }

    // Expand roles into per-slot discipline assignments
    const resolvedRoles: import("./types.js").SlotRole[] =
      this.config.roles ?? (this.config.role != null ? [{ discipline: this.config.role, count: 1 }] : []);
    const slotDisciplines: string[] = [];
    for (const role of resolvedRoles) {
      for (let i = 0; i < role.count; i++) {
        slotDisciplines.push(role.discipline);
      }
    }

    const totalRoleSlots = slotDisciplines.length;
    if (totalRoleSlots !== this.config.pool.getCapacity()) {
      logger.warn(
        `[radar] roles sum (${totalRoleSlots}) !== pool capacity (${this.config.pool.getCapacity()}); slot count will follow roles`,
      );
    }

    for (let i = 0; i < slotDisciplines.length; i++) {
      const slotId = `slot-${i}`;
      const workerId = workerRepo ? workerIdPrefix : `${workerIdPrefix}-${randomUUID().slice(0, 8)}`;
      const promise = this.runSlot(slotId, workerId, slotDisciplines[i]);
      this.slotPromises.set(slotId, promise);
    }
  }

  async stop(): Promise<void> {
    if (!this.abortController) return;
    this.abortController.abort();

    const timeout = this.config.stopTimeoutMs ?? 5000;
    const allSettled = Promise.allSettled(this.slotPromises.values());
    let timedOut = false;
    let forceTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const forceTimeout = new Promise<void>((resolve) => {
      forceTimeoutHandle = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeout);
    });

    await Promise.race([allSettled, forceTimeout]);
    clearTimeout(forceTimeoutHandle);

    if (!timedOut) {
      // Natural completion — all slots settled cleanly.
      await allSettled;
    }
    // Force-timeout path: slots are still running but aborted; null controller now
    // so this.signal getter returns a pre-aborted signal for any in-flight code.

    // Deregister worker from DB
    if (this.registeredWorkerId && this.config.workerRepo) {
      try {
        await this.config.workerRepo.deregister(this.registeredWorkerId);
      } catch {
        // Best-effort deregister — ungraceful shutdown handled by WOP-1874 reaper
      }
      this.registeredWorkerId = null;
    }

    this.slotPromises.clear();
    this.abortController = null;
  }

  private get signal(): AbortSignal {
    if (!this.abortController) {
      // Controller was nulled after force-timeout; return a pre-aborted signal
      // so any in-flight slot coroutines see aborted=true and exit cleanly.
      const ac = new AbortController();
      ac.abort();
      return ac.signal;
    }
    return this.abortController.signal;
  }

  private async runSlot(slotId: string, workerId: string, discipline: string): Promise<void> {
    while (!this.signal.aborted) {
      try {
        await this.claimAndProcess(slotId, workerId, discipline);
      } catch (err) {
        if (!this.signal.aborted) {
          logger.error(`[radar] slot ${slotId} claim error`, { error: safeErrorMessage(err) });
          await sleep(this.pollIntervalMs, this.signal);
        }
      }
    }
  }

  private async claimAndProcess(slotId: string, workerId: string, discipline: string): Promise<void> {
    const { engine: defcon, dispatcher, pool, flow } = this.config;

    // Concurrency gate: global per-flow limit
    // Use pendingClaims to prevent TOCTOU: multiple slots checking the count
    // before any of them completes a claim. pending + active must stay < maxConcurrent.
    if (flow != null && this.config.maxConcurrent != null) {
      const active = pool.activeCountByFlow(flow);
      if (active + this.pendingClaims >= this.config.maxConcurrent) {
        await sleep(this.pollIntervalMs, this.signal);
        return;
      }
    }

    this.pendingClaims++;
    let claim: ClaimResponse;
    try {
      claim = await defcon.claim({ workerId, role: discipline, flow }, { signal: this.signal });
    } finally {
      this.pendingClaims--;
    }

    if (!isWorkClaim(claim)) {
      logger.info(`[radar] slot ${slotId} no work`, { check_back_ms: claim.retry_after_ms });
      await sleep(claim.retry_after_ms, this.signal);
      return;
    }

    logger.info(`[radar] slot ${slotId} claimed entity`, {
      entity: claim.entity_id,
      flow: claim.flow ?? "none",
      stage: (claim as Record<string, unknown>).stage ?? "?",
    });

    const claimFlow = claim.flow;
    const claimRepo = extractRepoFromDescription(claim.prompt);

    // Concurrency gate: per-repo limit — checked BEFORE allocating a slot
    // so we skip rather than crash the entity
    if (claimFlow != null && claimRepo != null && this.config.maxConcurrentPerRepo != null) {
      const repoActive = pool.activeCountByRepo(claimFlow, claimRepo);
      if (repoActive >= this.config.maxConcurrentPerRepo) {
        try {
          await defcon.report({
            entityId: claim.entity_id,
            signal: "crash",
            artifacts: { error: `per-repo concurrency limit reached for ${claimRepo}` },
          });
        } catch (err) {
          logger.error("[run-loop] crash report failed", { error: safeErrorMessage(err) });
        }
        await sleep(this.pollIntervalMs, this.signal);
        return;
      }
    }

    const slot = pool.allocate(slotId, workerId, discipline, claim.entity_id, claim.prompt, claimFlow, claimRepo);
    if (!slot) {
      try {
        await defcon.report({
          entityId: claim.entity_id,
          signal: "crash",
          artifacts: { error: "slot unavailable" },
        });
      } catch {}
      await sleep(this.pollIntervalMs, this.signal);
      return;
    }

    try {
      const claimAny = claim as Record<string, unknown>;
      const rawModelTier = (claimAny.model_tier as string | undefined) ?? "sonnet";
      const modelTier: "opus" | "sonnet" | "haiku" =
        rawModelTier === "opus" || rawModelTier === "haiku" ? rawModelTier : "sonnet";
      // agentRole is fixed for the lifetime of this claim. On `continue` responses the
      // new prompt is applied but the agent role stays the same — the next stage's
      // invocation will be claimed fresh with its own agentRole set by defcon.
      const agentRole = (claimAny.agent_role as string | null | undefined) ?? null;
      const originalPrompt = claim.prompt;
      let currentPrompt = claim.prompt;
      let currentSignal: string | undefined;
      let currentArtifacts: Record<string, unknown> | undefined;
      const startTime = Date.now();
      let recorded = false;

      while (!this.signal.aborted) {
        if (currentSignal === undefined) {
          pool.setState(slotId, "working");
          const heartbeatInterval = setInterval(() => {
            pool.heartbeat(slotId);
          }, this.pollIntervalMs);
          logger.info(`[radar] slot ${slotId} dispatching entity`, {
            entity: claim.entity_id,
            model: modelTier,
            agentRole: agentRole ?? "none",
          });
          try {
            const result = await dispatcher.dispatch(currentPrompt, {
              modelTier,
              workerId,
              entityId: claim.entity_id,
              agentRole,
              templateContext: ((claim as Record<string, unknown>).context as Record<string, unknown> | null) ?? null,
            });
            logger.info(`[radar] slot ${slotId} dispatch done`, {
              signal: result.signal,
              exitCode: result.exitCode,
            });
            currentSignal = result.signal;
            currentArtifacts = result.artifacts;
          } catch (err) {
            logger.error(`[radar] slot ${slotId} dispatch threw`, { error: safeErrorMessage(err) });
            currentSignal = "crash";
            currentArtifacts = { error: safeErrorMessage(err) };
          } finally {
            clearInterval(heartbeatInterval);
          }
        }

        let activityHistory: string | null = null;
        if (this.config.activityRepo) {
          try {
            activityHistory = await this.config.activityRepo.getSummary(claim.entity_id);
            if (activityHistory) {
              activityHistory = activityHistory.trim();
              const MAX_HISTORY_CHARS = 8000;
              if (activityHistory.length > MAX_HISTORY_CHARS) {
                activityHistory = `[...history truncated]\n\n${activityHistory.slice(-MAX_HISTORY_CHARS)}`;
              }
            }
          } catch (err) {
            logger.warn(`[radar] slot ${slotId} failed to get activity history`, {
              error: safeErrorMessage(err),
            });
          }
        }

        if (activityHistory) {
          currentArtifacts = { ...(currentArtifacts ?? {}), activityHistory: activityHistory };
        }

        pool.setState(slotId, "reporting");
        let response: ReportResponse;
        try {
          response = await defcon.report({
            entityId: claim.entity_id,
            signal: currentSignal,
            artifacts: currentArtifacts,
          });
        } catch (err) {
          if (!this.signal.aborted) {
            logger.error(`[radar] slot ${slotId} report error`, { error: safeErrorMessage(err) });
            await sleep(this.pollIntervalMs, this.signal);
            continue;
          }
          break;
        }

        logger.info(`[radar] slot ${slotId} report ack`, { next_action: response.next_action });

        if (response.next_action === "continue") {
          const basePrompt = response.prompt ?? originalPrompt;
          currentPrompt = activityHistory ? `${activityHistory}\n\n---\n${basePrompt}` : basePrompt;
          // Update templateContext from the engine so the next dispatch uses fresh context
          if ("context" in response && response.context != null) {
            (claim as Record<string, unknown>).context = response.context;
          }
          currentSignal = undefined;
          currentArtifacts = undefined;
          continue;
        }

        if (response.next_action === "check_back") {
          await sleep(response.retry_after_ms, this.signal);
          continue;
        }

        // "waiting" — release slot
        if (this.config.throughputTracker) {
          const durationMs = Date.now() - startTime;
          const FAILURE_SIGNALS = new Set(["crash", "timeout", "unknown", "cant_resolve"]);
          const outcome = currentSignal && !FAILURE_SIGNALS.has(currentSignal) ? "completed" : "failed";
          this.config.throughputTracker.record(outcome, durationMs);
          recorded = true;
        }
        break;
      }

      // Aborted mid-flight — record as failed so throughput stats account for it
      if (this.signal.aborted && this.config.throughputTracker && !recorded) {
        this.config.throughputTracker.record("failed", Date.now() - startTime);
      }
    } finally {
      try {
        pool.release(slotId);
      } catch {
        // slot may not be allocated if early error
      }
    }
  }
}
