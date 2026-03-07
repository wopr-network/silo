import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  Artifacts,
  EnrichedEntity,
  Entity,
  Flow,
  IEntityRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "../repositories/interfaces.js";
import { DEFAULT_TIMEOUT_PROMPT } from "./constants.js";
import type { IEventBusAdapter } from "./event-types.js";
import { executeSpawn } from "./flow-spawner.js";
import { evaluateGate } from "./gate-evaluator.js";
import { getHandlebars } from "./handlebars.js";
import { buildInvocation } from "./invocation-builder.js";
import { executeOnEnter } from "./on-enter.js";
import { findTransition, isTerminal } from "./state-machine.js";

export interface ProcessSignalResult {
  newState?: string;
  /** Names (not IDs) of gates that evaluated and passed during this transition. */
  gatesPassed: string[];
  gated: boolean;
  gateTimedOut?: boolean;
  gateOutput?: string;
  gateName?: string;
  failurePrompt?: string;
  timeoutPrompt?: string;
  onEnterFailed?: boolean;
  invocationId?: string;
  spawned?: string[];
  terminal: boolean;
}

export interface ClaimWorkResult {
  entityId: string;
  invocationId: string;
  prompt: string;
  context: Record<string, unknown> | null;
}

export interface EngineStatus {
  flows: Record<string, Record<string, number>>;
  activeInvocations: number;
  pendingClaims: number;
}

export interface EngineDeps {
  entityRepo: IEntityRepository;
  flowRepo: IFlowRepository;
  invocationRepo: IInvocationRepository;
  gateRepo: IGateRepository;
  transitionLogRepo: ITransitionLogRepository;
  adapters: Map<string, unknown>;
  eventEmitter: IEventBusAdapter;
  logger?: Logger;
}

export class Engine {
  private entityRepo: IEntityRepository;
  private flowRepo: IFlowRepository;
  private invocationRepo: IInvocationRepository;
  private gateRepo: IGateRepository;
  private transitionLogRepo: ITransitionLogRepository;
  readonly adapters: Map<string, unknown>;
  private eventEmitter: IEventBusAdapter;
  private readonly logger: Logger;

  constructor(deps: EngineDeps) {
    this.entityRepo = deps.entityRepo;
    this.flowRepo = deps.flowRepo;
    this.invocationRepo = deps.invocationRepo;
    this.gateRepo = deps.gateRepo;
    this.transitionLogRepo = deps.transitionLogRepo;
    this.adapters = deps.adapters;
    this.eventEmitter = deps.eventEmitter;
    this.logger = deps.logger ?? consoleLogger;
  }

  async processSignal(
    entityId: string,
    signal: string,
    artifacts?: Artifacts,
    triggeringInvocationId?: string,
  ): Promise<ProcessSignalResult> {
    // 1. Load entity
    const entity = await this.entityRepo.get(entityId);
    if (!entity) throw new Error(`Entity "${entityId}" not found`);

    // 2. Load flow
    const flow = await this.flowRepo.get(entity.flowId);
    if (!flow) throw new Error(`Flow "${entity.flowId}" not found`);

    // 3. Find transition
    const transition = findTransition(flow, entity.state, signal, { entity }, true, this.logger);
    if (!transition)
      throw new Error(`No transition from "${entity.state}" on signal "${signal}" in flow "${flow.name}"`);

    // 4. Evaluate gate if present
    const gatesPassed: string[] = [];
    if (transition.gateId) {
      const gate = await this.gateRepo.get(transition.gateId);
      if (!gate) throw new Error(`Gate "${transition.gateId}" not found`);

      const gateResult = await evaluateGate(gate, entity, this.gateRepo, flow.gateTimeoutMs);
      if (!gateResult.passed) {
        // Persist gate failure into entity artifacts for retry context
        const priorFailures = Array.isArray(entity.artifacts?.gate_failures)
          ? (entity.artifacts.gate_failures as Array<Record<string, unknown>>)
          : [];
        await this.entityRepo.updateArtifacts(entityId, {
          gate_failures: [
            ...priorFailures,
            {
              gateId: gate.id,
              gateName: gate.name,
              output: gateResult.output,
              failedAt: new Date().toISOString(),
            },
          ],
        });
        if (gateResult.timedOut) {
          await this.eventEmitter.emit({
            type: "gate.timedOut",
            entityId,
            gateId: gate.id,
            emittedAt: new Date(),
          });
        } else {
          await this.eventEmitter.emit({
            type: "gate.failed",
            entityId,
            gateId: gate.id,
            emittedAt: new Date(),
          });
        }
        let resolvedTimeoutPrompt: string | undefined;
        if (gateResult.timedOut) {
          const rawTemplate = gate.timeoutPrompt ?? flow.timeoutPrompt ?? DEFAULT_TIMEOUT_PROMPT;
          try {
            const hbs = getHandlebars();
            const template = hbs.compile(rawTemplate);
            resolvedTimeoutPrompt = template({
              entity,
              flow,
              gate: { name: gate.name, output: gateResult.output },
            });
          } catch (err) {
            this.logger.error("[engine] Failed to render timeoutPrompt template:", err);
            resolvedTimeoutPrompt = DEFAULT_TIMEOUT_PROMPT;
          }
        }
        return {
          gated: true,
          gateTimedOut: gateResult.timedOut,
          gateOutput: gateResult.output,
          gateName: gate.name,
          failurePrompt: gate.failurePrompt ?? undefined,
          timeoutPrompt: resolvedTimeoutPrompt,
          gatesPassed,
          terminal: false,
        };
      }
      gatesPassed.push(gate.name);
      await this.eventEmitter.emit({
        type: "gate.passed",
        entityId,
        gateId: gate.id,
        emittedAt: new Date(),
      });
    }

    // 5. Transition entity
    let updated = await this.entityRepo.transition(entityId, transition.toState, signal, artifacts);

    // Clear gate_failures on successful transition so stale failures don't bleed into future agent prompts
    await this.entityRepo.updateArtifacts(entityId, { gate_failures: [] });
    // Keep the in-memory entity in sync so buildInvocation sees the cleared failures
    updated = { ...updated, artifacts: { ...updated.artifacts, gate_failures: [] } };

    // 6. Emit transition event
    await this.eventEmitter.emit({
      type: "entity.transitioned",
      entityId,
      flowId: flow.id,
      fromState: entity.state,
      toState: transition.toState,
      trigger: signal,
      emittedAt: new Date(),
    });

    const result: ProcessSignalResult = {
      newState: transition.toState,
      gatesPassed,
      gated: false,
      terminal: false,
    };

    // 6b. Execute onEnter hook if defined on the new state
    const newStateDef = flow.states.find((s) => s.name === transition.toState);
    if (newStateDef?.onEnter) {
      const onEnterResult = await executeOnEnter(newStateDef.onEnter, updated, this.entityRepo);
      if (onEnterResult.skipped) {
        await this.eventEmitter.emit({
          type: "onEnter.skipped",
          entityId,
          state: transition.toState,
          emittedAt: new Date(),
        });
      } else if (onEnterResult.error) {
        await this.eventEmitter.emit({
          type: "onEnter.failed",
          entityId,
          state: transition.toState,
          error: onEnterResult.error,
          emittedAt: new Date(),
        });
        await this.transitionLogRepo.record({
          entityId,
          fromState: entity.state,
          toState: transition.toState,
          trigger: signal,
          invocationId: triggeringInvocationId ?? null,
          timestamp: new Date(),
        });
        return {
          newState: transition.toState,
          gatesPassed,
          gated: false,
          onEnterFailed: true,
          gateOutput: onEnterResult.error,
          terminal: false,
        };
      } else {
        await this.eventEmitter.emit({
          type: "onEnter.completed",
          entityId,
          state: transition.toState,
          artifacts: onEnterResult.artifacts ?? {},
          emittedAt: new Date(),
        });
        // Refresh entity so invocation builder sees new artifacts
        const refreshed = await this.entityRepo.get(entityId);
        if (refreshed) {
          updated = refreshed;
        }
      }
    }

    // 7. Create invocation if new state has a prompt template
    if (newStateDef?.promptTemplate) {
      const canCreate = await this.checkConcurrency(flow, entity);
      if (canCreate) {
        const [invocations, gateResults] = await Promise.all([
          this.invocationRepo.findByEntity(updated.id),
          this.gateRepo.resultsFor(updated.id),
        ]);
        const enriched: EnrichedEntity = { ...updated, invocations, gateResults };
        const build = await buildInvocation(newStateDef, enriched, this.adapters, flow, this.logger);
        const invocation = await this.invocationRepo.create(
          entityId,
          transition.toState,
          build.prompt,
          build.mode,
          undefined,
          build.systemPrompt || build.userContent
            ? { systemPrompt: build.systemPrompt, userContent: build.userContent }
            : undefined,
        );
        result.invocationId = invocation.id;
        await this.eventEmitter.emit({
          type: "invocation.created",
          entityId,
          invocationId: invocation.id,
          stage: transition.toState,
          emittedAt: new Date(),
        });
      }
    }

    // 8. Record transition log with the TRIGGERING invocation (the one that reported the signal).
    //    The next invocation (result.invocationId) is already recorded in the invocations table.
    await this.transitionLogRepo.record({
      entityId,
      fromState: entity.state,
      toState: transition.toState,
      trigger: signal,
      invocationId: triggeringInvocationId ?? null,
      timestamp: new Date(),
    });

    // 9. Spawn child flows
    const spawned = await executeSpawn(transition, updated, this.flowRepo, this.entityRepo, this.logger);
    if (spawned) {
      result.spawned = [spawned.id];
      await this.eventEmitter.emit({
        type: "flow.spawned",
        entityId,
        flowId: flow.id,
        spawnedFlowId: spawned.flowId,
        emittedAt: new Date(),
      });
    }

    // 10. Mark terminal — no invocation is created for terminal states (handled above),
    //     but we surface terminality in the result for callers.
    if (isTerminal(flow, transition.toState)) {
      result.terminal = true;
      result.spawned = result.spawned ?? [];
    }

    return result;
  }

  async createEntity(
    flowName: string,
    refs?: Record<string, { adapter: string; id: string; [key: string]: unknown }>,
  ): Promise<Entity> {
    const flow = await this.flowRepo.getByName(flowName);
    if (!flow) throw new Error(`Flow "${flowName}" not found`);

    const entity = await this.entityRepo.create(flow.id, flow.initialState, refs);

    await this.eventEmitter.emit({
      type: "entity.created",
      entityId: entity.id,
      flowId: flow.id,
      payload: { refs: refs ?? null },
      emittedAt: new Date(),
    });

    // Execute onEnter hook if defined on initial state
    const initialState = flow.states.find((s) => s.name === flow.initialState);
    if (initialState?.onEnter) {
      const onEnterResult = await executeOnEnter(initialState.onEnter, entity, this.entityRepo);
      if (onEnterResult.error) {
        await this.eventEmitter.emit({
          type: "onEnter.failed",
          entityId: entity.id,
          state: flow.initialState,
          error: onEnterResult.error,
          emittedAt: new Date(),
        });
        throw new Error(`onEnter failed for entity ${entity.id}: ${onEnterResult.error}`);
      }
      if (onEnterResult.artifacts) {
        await this.eventEmitter.emit({
          type: "onEnter.completed",
          entityId: entity.id,
          state: flow.initialState,
          artifacts: onEnterResult.artifacts,
          emittedAt: new Date(),
        });
        const refreshed = await this.entityRepo.get(entity.id);
        if (refreshed) {
          Object.assign(entity, refreshed);
        }
      }
    }

    // Create invocation if initial state has a prompt template
    if (initialState?.promptTemplate) {
      const [invocations, gateResults] = await Promise.all([
        this.invocationRepo.findByEntity(entity.id),
        this.gateRepo.resultsFor(entity.id),
      ]);
      const enriched: EnrichedEntity = { ...entity, invocations, gateResults };
      const build = await buildInvocation(initialState, enriched, this.adapters, flow, this.logger);
      await this.invocationRepo.create(
        entity.id,
        flow.initialState,
        build.prompt,
        build.mode,
        undefined,
        build.systemPrompt || build.userContent
          ? { systemPrompt: build.systemPrompt, userContent: build.userContent }
          : undefined,
      );
    }

    return entity;
  }

  async claimWork(role: string, flowName?: string, workerId?: string): Promise<ClaimWorkResult | null> {
    let flows: Flow[];
    if (flowName) {
      const flow = await this.flowRepo.getByName(flowName);
      // Validate discipline match — null discipline flows are claimable by any role
      flows = flow && (flow.discipline === null || flow.discipline === role) ? [flow] : [];
    } else {
      const allFlows = await this.flowRepo.listAll();
      flows = allFlows.filter((f) => f.discipline === null || f.discipline === role);
    }

    for (const flow of flows) {
      // Try affinity match first if workerId provided
      if (workerId) {
        const affinityUnclaimed = await this.invocationRepo.findUnclaimedWithAffinity(flow.id, role, workerId);
        for (const pending of affinityUnclaimed) {
          const claimed = await this.entityRepo.claimById(pending.entityId, `agent:${role}`);
          if (!claimed) continue;
          const result = await this.tryClaimInvocation(pending, claimed, flow, role, workerId);
          if (result) return result;
        }
      }

      // Prefer claiming an existing unclaimed invocation created by processSignal
      // to avoid creating a duplicate. Fall back to creating a new one if none exist.
      const unclaimed = await this.invocationRepo.findUnclaimedByFlow(flow.id);
      for (const pending of unclaimed) {
        const claimed = await this.entityRepo.claim(flow.id, pending.stage, `agent:${role}`);
        if (!claimed) continue;
        const result = await this.tryClaimInvocation(pending, claimed, flow, role, workerId);
        if (result) return result;
      }

      // No pre-existing unclaimed invocations — claim entity directly and create invocation
      const claimableStates = flow.states.filter((s) => !!s.promptTemplate);
      for (const state of claimableStates) {
        const claimed = await this.entityRepo.claim(flow.id, state.name, `agent:${role}`);
        if (!claimed) continue;

        await this.setAffinityIfNeeded(claimed.id, flow, role, workerId);
        const build = await this.buildPrompt(state, claimed, flow);
        const invocation = await this.invocationRepo.create(
          claimed.id,
          state.name,
          build.prompt,
          build.mode,
          undefined,
          build.systemPrompt || build.userContent
            ? { systemPrompt: build.systemPrompt, userContent: build.userContent }
            : undefined,
        );
        return this.emitAndReturn(claimed, invocation.id, build, flow, role);
      }
    }

    return null;
  }

  /**
   * Try to claim an existing unclaimed invocation for an already-claimed entity.
   * Handles the race condition where another worker claims the invocation first
   * (releases the entity claim and returns null so the caller can try the next candidate).
   */
  private async tryClaimInvocation(
    pending: { id: string; entityId: string; stage: string; prompt: string },
    claimed: Entity,
    flow: Flow,
    role: string,
    workerId?: string,
  ): Promise<ClaimWorkResult | null> {
    const claimedInvocation = await this.invocationRepo.claim(pending.id, `agent:${role}`);
    if (!claimedInvocation) {
      try {
        await this.entityRepo.release(claimed.id, `agent:${role}`);
      } catch (err) {
        this.logger.error(`release() failed for entity ${claimed.id}:`, err);
      }
      return null;
    }

    await this.setAffinityIfNeeded(claimed.id, flow, role, workerId);

    const state = flow.states.find((s) => s.name === pending.stage);
    const build = state ? await this.buildPrompt(state, claimed, flow) : { prompt: pending.prompt, context: null };

    return this.emitAndReturn(claimed, claimedInvocation.id, build, flow, role);
  }

  private async setAffinityIfNeeded(entityId: string, flow: Flow, role: string, workerId?: string): Promise<void> {
    if (!workerId) return;
    const affinityWindow = flow.affinityWindowMs ?? 300000;
    try {
      await this.entityRepo.setAffinity(entityId, workerId, role, new Date(Date.now() + affinityWindow));
    } catch (err) {
      this.logger.warn(`setAffinity failed for entity ${entityId} worker ${workerId} — continuing:`, err);
    }
  }

  private async buildPrompt(
    state: Flow["states"][number],
    entity: Entity,
    flow: Flow,
  ): Promise<Awaited<ReturnType<typeof buildInvocation>>> {
    const [invocations, gateResults] = await Promise.all([
      this.invocationRepo.findByEntity(entity.id),
      this.gateRepo.resultsFor(entity.id),
    ]);
    const enriched: EnrichedEntity = { ...entity, invocations, gateResults };
    return buildInvocation(state, enriched, this.adapters, flow, this.logger);
  }

  private async emitAndReturn(
    entity: Entity,
    invocationId: string,
    build: { prompt: string; context: Record<string, unknown> | null },
    flow: Flow,
    role: string,
  ): Promise<ClaimWorkResult> {
    await this.eventEmitter.emit({
      type: "entity.claimed",
      entityId: entity.id,
      flowId: flow.id,
      agentId: `agent:${role}`,
      emittedAt: new Date(),
    });
    return {
      entityId: entity.id,
      invocationId,
      prompt: build.prompt,
      context: build.context,
    };
  }

  async getStatus(): Promise<EngineStatus> {
    const allFlows = await this.flowRepo.listAll();
    const statusData: Record<string, Record<string, number>> = {};
    let activeInvocations = 0;
    let pendingClaims = 0;

    for (const flow of allFlows) {
      const stateEntries = await Promise.all(
        flow.states.map(async (state) => {
          const entities = await this.entityRepo.findByFlowAndState(flow.id, state.name);
          return [state.name, entities.length] as [string, number];
        }),
      );
      statusData[flow.id] = Object.fromEntries(stateEntries);

      const [active, pending] = await Promise.all([
        this.invocationRepo.countActiveByFlow(flow.id),
        this.invocationRepo.countPendingByFlow(flow.id),
      ]);
      activeInvocations += active;
      pendingClaims += pending;
    }

    return { flows: statusData, activeInvocations, pendingClaims };
  }

  startReaper(intervalMs: number, entityTtlMs: number = 60_000): () => Promise<void> {
    let tickInFlight = false;
    let stopped = false;

    const tick = async () => {
      const expired = await this.invocationRepo.reapExpired();
      for (const inv of expired) {
        await this.eventEmitter.emit({
          type: "invocation.expired",
          entityId: inv.entityId,
          invocationId: inv.id,
          emittedAt: new Date(),
        });
      }
      await this.entityRepo.reapExpired(entityTtlMs);
      await this.entityRepo.clearExpiredAffinity();
    };

    let currentTickPromise: Promise<void> = Promise.resolve();
    const timer = setInterval(() => {
      if (stopped || tickInFlight) return;
      tickInFlight = true;
      currentTickPromise = tick()
        .catch((err) => {
          this.logger.error("[reaper] error:", err);
        })
        .finally(() => {
          tickInFlight = false;
          // Reset chain head so completed ticks don't accumulate in memory
          currentTickPromise = Promise.resolve();
        });
    }, intervalMs);

    return async () => {
      stopped = true;
      clearInterval(timer);
      await currentTickPromise;
    };
  }

  private async checkConcurrency(flow: Flow, entity: Entity): Promise<boolean> {
    if (flow.maxConcurrent <= 0 && flow.maxConcurrentPerRepo <= 0) return true;

    const allInvocations = await this.invocationRepo.findByFlow(flow.id);
    // Count active AND pending (unclaimed, not yet started) invocations
    const activeOrPending = allInvocations.filter((i) => !i.completedAt && !i.failedAt);

    if (flow.maxConcurrent > 0 && activeOrPending.length >= flow.maxConcurrent) return false;

    if (flow.maxConcurrentPerRepo > 0 && entity.refs) {
      // Identify invocations for entities sharing the same repo ref as this entity.
      // Fetch each unique entity involved in active/pending invocations to compare refs.
      const uniqueEntityIds = [...new Set(activeOrPending.map((i) => i.entityId))];
      const peerEntities = await Promise.all(uniqueEntityIds.map((id) => this.entityRepo.get(id)));
      const repoCount = peerEntities.filter((peer) => {
        if (!peer?.refs || !entity.refs) return false;
        // Two entities share the same repo if any ref adapter+id pair matches
        const peerRefs = peer.refs;
        return Object.values(entity.refs).some((ref) =>
          Object.values(peerRefs).some((peerRef) => peerRef.adapter === ref.adapter && peerRef.id === ref.id),
        );
      }).length;
      if (repoCount >= flow.maxConcurrentPerRepo) return false;
    }

    return true;
  }
}
