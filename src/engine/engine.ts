import { NotFoundError, ValidationError } from "../errors.js";
import { AdapterRegistry } from "../integrations/registry.js";
import type { IIntegrationRepository } from "../integrations/repo.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  Artifacts,
  EnrichedEntity,
  Entity,
  Flow,
  IDomainEventRepository,
  IEntityRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  Invocation,
  ITransitionLogRepository,
} from "../repositories/interfaces.js";
import { DEFAULT_TIMEOUT_PROMPT } from "./constants.js";
import type { IEventBusAdapter } from "./event-types.js";
import { executeSpawn } from "./flow-spawner.js";
import { evaluateGateForAllRepos } from "./gate-evaluator.js";
import { getHandlebars } from "./handlebars.js";
import { buildInvocation } from "./invocation-builder.js";
import { executeOnEnter } from "./on-enter.js";
import { executeOnExit } from "./on-exit.js";
import { findTransition, isTerminal } from "./state-machine.js";

const MERGE_BLOCKED_THRESHOLD = 3;
const MERGE_BLOCKED_STUCK_MESSAGE =
  "PR blocked in merge queue 3+ times — likely branch protection or queue contention issue";

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
  flowName: string;
  stage: string;
  refs: Record<string, unknown> | null;
  artifacts: Record<string, unknown> | null;
}

export interface EngineStatus {
  flows: Record<string, Record<string, number>>;
  activeInvocations: number;
  pendingClaims: number;
  versionDistribution: Record<string, Record<string, number>>;
}

/** Repos bundle used inside a transaction. Created from tx handle via repoFactory. */
export interface TransactionRepos {
  entityRepo: IEntityRepository;
  flowRepo: IFlowRepository;
  invocationRepo: IInvocationRepository;
  gateRepo: IGateRepository;
  transitionLogRepo: ITransitionLogRepository;
  domainEvents?: IDomainEventRepository;
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
  /** Optional transaction wrapper. Receives the Drizzle tx handle so the callback can create tx-bound repos. */
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  withTransaction?: <T>(fn: (tx: any) => T | Promise<T>) => Promise<T>;
  /** Factory to create tenant-scoped repos bound to a transaction handle. Required when withTransaction is provided. */
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  repoFactory?: (txDb: any) => TransactionRepos;
  /** Optional domain event repository. When provided, claimWork uses CAS on the event log to prevent concurrent claim races. */
  domainEvents?: IDomainEventRepository;
  /** Optional integration repository. When provided, primitive gate ops and onEnter ops are resolved through the AdapterRegistry. */
  integrationRepo?: IIntegrationRepository;
  /** Optional pre-built AdapterRegistry. Takes precedence over integrationRepo when both are provided. */
  adapterRegistry?: AdapterRegistry;
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
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  private readonly withTransactionFn: (<T>(fn: (tx: any) => T | Promise<T>) => Promise<T>) | null;
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  private readonly repoFactory: ((txDb: any) => TransactionRepos) | null;
  private readonly domainEventRepo: IDomainEventRepository | null;
  private readonly adapterRegistry: AdapterRegistry | null;
  private drainingWorkers = new Set<string>();

  constructor(deps: EngineDeps) {
    this.entityRepo = deps.entityRepo;
    this.flowRepo = deps.flowRepo;
    this.invocationRepo = deps.invocationRepo;
    this.gateRepo = deps.gateRepo;
    this.transitionLogRepo = deps.transitionLogRepo;
    this.adapters = deps.adapters;
    this.eventEmitter = deps.eventEmitter;
    this.logger = deps.logger ?? consoleLogger;
    this.withTransactionFn = deps.withTransaction ?? null;
    this.repoFactory = deps.repoFactory ?? null;
    this.domainEventRepo = deps.domainEvents ?? null;
    this.adapterRegistry =
      deps.adapterRegistry ?? (deps.integrationRepo ? new AdapterRegistry(deps.integrationRepo) : null);
  }

  drainWorker(workerId: string): void {
    this.drainingWorkers.add(workerId);
  }

  undrainWorker(workerId: string): void {
    this.drainingWorkers.delete(workerId);
  }

  isDraining(workerId: string): boolean {
    return this.drainingWorkers.has(workerId);
  }

  listDrainingWorkers(): string[] {
    return Array.from(this.drainingWorkers);
  }

  async emit(event: import("./event-types.js").EngineEvent): Promise<void> {
    await this.eventEmitter.emit(event);
  }

  async processSignal(
    entityId: string,
    signal: string,
    artifacts?: Artifacts,
    triggeringInvocationId?: string,
  ): Promise<ProcessSignalResult> {
    const pendingEvents: import("./event-types.js").EngineEvent[] = [];
    const bufferingEmitter: IEventBusAdapter = {
      emit: async (event) => {
        pendingEvents.push(event);
      },
    };

    if (this.withTransactionFn) {
      // Run DB writes inside a transaction; events are buffered and only
      // flushed to real subscribers after successful COMMIT.
      // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
      const result = await this.withTransactionFn(async (tx: any) => {
        const txRepos = this.repoFactory?.(tx) ?? null;
        return this._processSignalInner(entityId, signal, artifacts, triggeringInvocationId, bufferingEmitter, txRepos);
      });
      for (const event of pendingEvents) {
        await this.eventEmitter.emit(event);
      }
      return result;
    }

    const result = await this._processSignalInner(
      entityId,
      signal,
      artifacts,
      triggeringInvocationId,
      bufferingEmitter,
    );
    for (const event of pendingEvents) {
      await this.eventEmitter.emit(event);
    }
    return result;
  }

  private async _processSignalInner(
    entityId: string,
    signal: string,
    artifacts?: Artifacts,
    triggeringInvocationId?: string,
    emitter: IEventBusAdapter = this.eventEmitter,
    txRepos?: TransactionRepos | null,
  ): Promise<ProcessSignalResult> {
    // When running inside a transaction, use tx-bound repos; otherwise use instance repos.
    const entityRepo = txRepos?.entityRepo ?? this.entityRepo;
    const flowRepo = txRepos?.flowRepo ?? this.flowRepo;
    const invocationRepo = txRepos?.invocationRepo ?? this.invocationRepo;
    const gateRepo = txRepos?.gateRepo ?? this.gateRepo;
    const transitionLogRepo = txRepos?.transitionLogRepo ?? this.transitionLogRepo;

    // 1. Load entity
    let entity = await entityRepo.get(entityId);
    if (!entity) throw new NotFoundError(`Entity "${entityId}" not found`);

    if (entity.state === "cancelled") {
      throw new ValidationError(`Entity "${entityId}" is cancelled and cannot be transitioned`);
    }

    // 2. Load flow at entity's pinned version
    const flow = await flowRepo.getAtVersion(entity.flowId, entity.flowVersion);
    if (!flow) throw new NotFoundError(`Flow "${entity.flowId}" version ${entity.flowVersion} not found`);

    // 3. Find transition
    const transition = findTransition(flow, entity.state, signal, { entity }, true, this.logger);
    if (!transition)
      throw new ValidationError(`No transition from "${entity.state}" on signal "${signal}" in flow "${flow.name}"`);

    // 3b. Persist signal artifacts BEFORE gate evaluation so gate templates
    //     (e.g. {{entity.artifacts.prNumber}}) can reference them.
    if (artifacts && Object.keys(artifacts).length > 0) {
      await this.entityRepo.updateArtifacts(entityId, artifacts);
      const refreshed = await this.entityRepo.get(entityId);
      if (!refreshed) throw new NotFoundError(`Entity "${entityId}" not found after artifact update`);
      entity = refreshed;
    }

    // 4. Evaluate gate — returns a routing decision or a block result to return immediately.
    const routing = transition.gateId
      ? await this.resolveGate(transition.gateId, entity, flow, txRepos)
      : { kind: "proceed" as const, gatesPassed: [] as string[] };

    if (routing.kind === "block") {
      return { gated: true, ...routing, terminal: false };
    }

    // Gate passed or redirected — determine the actual destination.
    let toState = routing.kind === "redirect" ? routing.toState : transition.toState;
    const trigger = routing.kind === "redirect" ? routing.trigger : signal;
    const spawnFlow = routing.kind === "redirect" ? null : transition.spawnFlow;
    const { gatesPassed } = routing;

    // 4a. Merge-blocked loop detection: if the watcher sends "blocked" from
    // "merging", increment a counter. After MERGE_BLOCKED_THRESHOLD cycles,
    // override the destination to "stuck" to break the loop.
    if (signal === "blocked" && entity.state === "merging") {
      const prevCount = (
        typeof entity.artifacts?.merge_blocked_count === "number" ? entity.artifacts.merge_blocked_count : 0
      ) as number;
      const newCount = prevCount + 1;
      await entityRepo.updateArtifacts(entityId, { merge_blocked_count: newCount });
      if (newCount >= MERGE_BLOCKED_THRESHOLD) {
        const stuckState = flow.states.find((s) => s.name === "stuck");
        if (stuckState) {
          toState = "stuck";
          await entityRepo.updateArtifacts(entityId, {
            merge_blocked_message: MERGE_BLOCKED_STUCK_MESSAGE,
          });
          this.logger.warn(`[engine] Entity ${entityId} merge-blocked ${newCount} times, transitioning to stuck`);
        } else {
          this.logger.warn(
            `merge_blocked_count >= threshold but no stuck state in flow ${flow.name} — entity ${entityId} will continue looping`,
          );
        }
      }
    }

    // 4b. Execute onExit hook on the DEPARTING state (before transition)
    const departingStateDef = flow.states.find((s) => s.name === entity.state);
    if (departingStateDef?.onExit) {
      const onExitResult = await executeOnExit(departingStateDef.onExit, entity, flow, this.adapterRegistry);
      if (onExitResult.error) {
        this.logger.warn(`[engine] onExit failed for entity ${entityId} state ${entity.state}: ${onExitResult.error}`);
        await emitter.emit({
          type: "onExit.failed",
          entityId,
          state: entity.state,
          error: onExitResult.error,
          emittedAt: new Date(),
        });
      } else {
        await emitter.emit({
          type: "onExit.completed",
          entityId,
          state: entity.state,
          emittedAt: new Date(),
        });
      }
    }

    // 5. Transition entity
    let updated = await entityRepo.transition(entityId, toState, trigger, artifacts);

    // Clear gate_failures on successful transition so stale failures don't bleed into future agent prompts
    await entityRepo.updateArtifacts(entityId, { gate_failures: [] });
    // Keep the in-memory entity in sync so buildInvocation sees the cleared failures
    updated = { ...updated, artifacts: { ...updated.artifacts, gate_failures: [] } };

    // 6. Emit transition event
    await emitter.emit({
      type: "entity.transitioned",
      entityId,
      flowId: flow.id,
      fromState: entity.state,
      toState,
      trigger,
      emittedAt: new Date(),
    });

    const result: ProcessSignalResult = {
      newState: toState,
      gatesPassed,
      gated: false,
      terminal: false,
    };

    // 6b. Execute onEnter hook if defined on the new state
    const newStateDef = flow.states.find((s) => s.name === toState);
    if (newStateDef?.onEnter) {
      // Clear stale onEnter artifact keys so the hook re-runs on state re-entry.
      // Only the keys belonging to THIS state's onEnter are removed; other artifacts are preserved.
      const keysToRemove = [...newStateDef.onEnter.artifacts, "onEnter_error"];
      const currentArtifacts = updated.artifacts ?? {};
      const hasStaleKeys = keysToRemove.some((k) => currentArtifacts[k] !== undefined);
      if (hasStaleKeys) {
        await entityRepo.removeArtifactKeys(entityId, keysToRemove);
        // Refresh in-memory entity so executeOnEnter sees cleared artifacts
        const refreshed = await entityRepo.get(entityId);
        if (refreshed) updated = refreshed;
      }

      const onEnterResult = await executeOnEnter(newStateDef.onEnter, updated, entityRepo, flow, this.adapterRegistry);
      if (onEnterResult.skipped) {
        await emitter.emit({
          type: "onEnter.skipped",
          entityId,
          state: toState,
          emittedAt: new Date(),
        });
      } else if (onEnterResult.error) {
        await emitter.emit({
          type: "onEnter.failed",
          entityId,
          state: toState,
          error: onEnterResult.error,
          emittedAt: new Date(),
        });
        await transitionLogRepo.record({
          entityId,
          fromState: entity.state,
          toState,
          trigger,
          invocationId: triggeringInvocationId ?? null,
          timestamp: new Date(),
        });
        return {
          newState: toState,
          gatesPassed,
          gated: false,
          onEnterFailed: true,
          gateOutput: onEnterResult.error,
          terminal: false,
        };
      } else {
        await emitter.emit({
          type: "onEnter.completed",
          entityId,
          state: toState,
          artifacts: onEnterResult.artifacts ?? {},
          emittedAt: new Date(),
        });
        // Refresh entity so invocation builder sees new artifacts
        const refreshed = await entityRepo.get(entityId);
        if (refreshed) {
          updated = refreshed;
        }
      }
    }

    // 7. Create invocation if new state has a prompt template
    if (newStateDef?.promptTemplate) {
      const canCreate = await this.checkConcurrency(flow, entity, txRepos);
      if (canCreate) {
        const [invs, gResults] = await Promise.all([
          invocationRepo.findByEntity(updated.id),
          gateRepo.resultsFor(updated.id),
        ]);
        const enriched: EnrichedEntity = { ...updated, invocations: invs, gateResults: gResults };
        const build = await buildInvocation(newStateDef, enriched, this.adapters, flow, this.logger);
        const invocation = await invocationRepo.create(
          entityId,
          toState,
          build.prompt,
          build.mode,
          undefined,
          build.systemPrompt || build.userContent
            ? { systemPrompt: build.systemPrompt, userContent: build.userContent }
            : undefined,
          newStateDef.agentRole ?? null,
        );
        result.invocationId = invocation.id;
        await emitter.emit({
          type: "invocation.created",
          entityId,
          invocationId: invocation.id,
          stage: toState,
          emittedAt: new Date(),
        });
      }
    }

    // 8. Record transition log with the TRIGGERING invocation (the one that reported the signal).
    //    The next invocation (result.invocationId) is already recorded in the invocations table.
    await transitionLogRepo.record({
      entityId,
      fromState: entity.state,
      toState,
      trigger,
      invocationId: triggeringInvocationId ?? null,
      timestamp: new Date(),
    });

    // 9. Spawn child flows
    const spawned = await executeSpawn(
      { spawnFlow },
      updated,
      txRepos?.flowRepo ?? this.flowRepo,
      txRepos?.entityRepo ?? this.entityRepo,
      this.logger,
    );
    if (spawned) {
      result.spawned = [spawned.id];
      await emitter.emit({
        type: "flow.spawned",
        entityId,
        flowId: flow.id,
        spawnedFlowId: spawned.flowId,
        emittedAt: new Date(),
      });
    }

    // 10. Mark terminal
    if (isTerminal(flow, toState)) {
      result.terminal = true;
      result.spawned = result.spawned ?? [];
    }

    return result;
  }

  /**
   * Evaluate a gate and return a routing decision:
   * - `proceed`  — gate passed, continue to transition.toState
   * - `redirect` — gate outcome maps to a different toState
   * - `block`    — gate failed or timed out; caller should return this as the signal result
   */
  private async resolveGate(
    gateId: string,
    entity: Entity,
    flow: Flow,
    txRepos?: TransactionRepos | null,
  ): Promise<
    | { kind: "proceed"; gatesPassed: string[] }
    | { kind: "redirect"; toState: string; trigger: string; gatesPassed: string[] }
    | {
        kind: "block";
        gateTimedOut: boolean;
        gateOutput: string;
        gateName: string;
        failurePrompt?: string;
        timeoutPrompt?: string;
        gatesPassed: string[];
      }
  > {
    const gateRepo = txRepos?.gateRepo ?? this.gateRepo;
    const entityRepo = txRepos?.entityRepo ?? this.entityRepo;

    const gate = await gateRepo.get(gateId);
    if (!gate) throw new NotFoundError(`Gate "${gateId}" not found`);

    this.logger.info(`[engine] evaluating gate "${gate.name}" for entity ${entity.id}`, {
      gateId,
      gateName: gate.name,
      gateType: gate.type,
      entityState: entity.state,
      entityArtifactKeys: Object.keys(entity.artifacts ?? {}),
    });

    const gateResult = await evaluateGateForAllRepos(
      gate,
      entity,
      gateRepo,
      flow.gateTimeoutMs,
      flow,
      this.adapterRegistry,
    );

    this.logger.debug(`[engine] gate "${gate.name}" result`, {
      entityId: entity.id,
      passed: gateResult.passed,
      timedOut: gateResult.timedOut,
      outcome: gateResult.outcome,
      message: gateResult.message,
    });
    const namedOutcome = gateResult.outcome && gate.outcomes ? gate.outcomes[gateResult.outcome] : undefined;

    this.logger.debug(`[engine] gate "${gate.name}" routing`, {
      entityId: entity.id,
      outcome: gateResult.outcome ?? "(none)",
      hasOutcomesMap: !!gate.outcomes,
      availableOutcomes: gate.outcomes ? Object.keys(gate.outcomes) : [],
      matchedOutcome: namedOutcome ? JSON.stringify(namedOutcome) : "(no match)",
      passed: gateResult.passed,
    });

    if (namedOutcome?.toState) {
      const outcomeLabel = gateResult.outcome ?? gate.name;
      this.logger.info(`[engine] gate "${gate.name}" REDIRECT → ${namedOutcome.toState}`, {
        entityId: entity.id,
        outcome: outcomeLabel,
        toState: namedOutcome.toState,
      });
      await this.eventEmitter.emit({
        type: "gate.redirected",
        entityId: entity.id,
        gateId: gate.id,
        outcome: outcomeLabel,
        toState: namedOutcome.toState,
        emittedAt: new Date(),
      });
      return {
        kind: "redirect",
        toState: namedOutcome.toState,
        trigger: `gate:${gate.name}:${outcomeLabel}`,
        gatesPassed: [gate.name],
      };
    }

    if (namedOutcome?.proceed || (!namedOutcome && gateResult.passed)) {
      this.logger.info(`[engine] gate "${gate.name}" PASSED → proceed`, { entityId: entity.id });
      await this.eventEmitter.emit({
        type: "gate.passed",
        entityId: entity.id,
        gateId: gate.id,
        emittedAt: new Date(),
      });
      return { kind: "proceed", gatesPassed: [gate.name] };
    }

    // Gate failed — persist failure context and emit event
    const priorFailures = Array.isArray(entity.artifacts?.gate_failures)
      ? (entity.artifacts.gate_failures as Array<Record<string, unknown>>)
      : [];
    await entityRepo.updateArtifacts(entity.id, {
      gate_failures: [
        ...priorFailures,
        { gateId: gate.id, gateName: gate.name, output: gateResult.output, failedAt: new Date().toISOString() },
      ],
    });
    await this.eventEmitter.emit({
      type: gateResult.timedOut ? "gate.timedOut" : "gate.failed",
      entityId: entity.id,
      gateId: gate.id,
      emittedAt: new Date(),
    });

    let timeoutPrompt: string | undefined;
    if (gateResult.timedOut) {
      const rawTemplate = gate.timeoutPrompt ?? flow.timeoutPrompt ?? DEFAULT_TIMEOUT_PROMPT;
      try {
        const hbs = getHandlebars();
        timeoutPrompt = hbs.compile(rawTemplate)({
          entity,
          flow,
          gate: { name: gate.name, output: gateResult.output },
        });
      } catch (err) {
        this.logger.error("[engine] Failed to render timeoutPrompt template:", err);
        timeoutPrompt = DEFAULT_TIMEOUT_PROMPT;
      }
    }

    return {
      kind: "block",
      gateTimedOut: gateResult.timedOut,
      gateOutput: gateResult.output,
      gateName: gate.name,
      failurePrompt: gate.failurePrompt ?? undefined,
      timeoutPrompt,
      gatesPassed: [],
    };
  }

  async createEntity(
    flowName: string,
    refs?: Record<string, { adapter: string; id: string; [key: string]: unknown }>,
    payload?: Record<string, unknown>,
  ): Promise<Entity> {
    const flow = await this.flowRepo.getByName(flowName);
    if (!flow) throw new NotFoundError(`Flow "${flowName}" not found`);

    let entity = await this.entityRepo.create(flow.id, flow.initialState, refs, flow.version);

    // Store any caller-supplied payload as initial artifacts so prompt templates
    // can access refs like {{entity.artifacts.refs.linear.id}}.
    if (payload && Object.keys(payload).length > 0) {
      await this.entityRepo.updateArtifacts(entity.id, payload);
      const refreshed = await this.entityRepo.get(entity.id);
      if (refreshed) entity = refreshed;
    }

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
      const onEnterResult = await executeOnEnter(
        initialState.onEnter,
        entity,
        this.entityRepo,
        flow,
        this.adapterRegistry,
      );
      if (onEnterResult.error) {
        await this.eventEmitter.emit({
          type: "onEnter.failed",
          entityId: entity.id,
          state: flow.initialState,
          error: onEnterResult.error,
          emittedAt: new Date(),
        });
        throw new ValidationError(`onEnter failed for entity ${entity.id}: ${onEnterResult.error}`);
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
        initialState.agentRole ?? null,
      );
    }

    return entity;
  }

  async claimWork(
    role: string,
    flowName?: string,
    worker_id?: string,
  ): Promise<ClaimWorkResult | "all_claimed" | null> {
    // Skip draining workers entirely
    if (worker_id && this.drainingWorkers.has(worker_id)) {
      return "all_claimed";
    }

    // 1. Find candidate flows filtered by discipline
    let flows: Flow[];
    if (flowName) {
      const flow = await this.flowRepo.getByName(flowName);
      if (!flow) throw new Error(`Flow "${flowName}" not found`);
      flows = flow.discipline === null || flow.discipline === role ? [flow] : [];
    } else {
      const allFlows = await this.flowRepo.listAll();
      flows = allFlows.filter((f) => f.discipline === null || f.discipline === role);
    }

    // Filter out paused flows
    flows = flows.filter((f) => !f.paused);

    if (flows.length === 0) return null;

    // 2. Gather all unclaimed invocations across matching flows
    type Candidate = { invocation: Invocation; flow: Flow };
    const candidates: Candidate[] = [];
    const affinityInvocationIds = new Set<string>();
    for (const flow of flows) {
      // Affinity candidates first (if worker_id provided); capture IDs for step 4
      if (worker_id) {
        const affinityUnclaimed = await this.invocationRepo.findUnclaimedWithAffinity(flow.id, role, worker_id);
        for (const inv of affinityUnclaimed) {
          candidates.push({ invocation: inv, flow });
          affinityInvocationIds.add(inv.id);
        }
      }
      const unclaimed = await this.invocationRepo.findUnclaimedByFlow(flow.id);
      for (const inv of unclaimed) candidates.push({ invocation: inv, flow });
    }

    // 3. Load entities for priority sorting + dedup candidates
    const entityMap = new Map<string, Entity>();
    const uniqueEntityIds = [...new Set(candidates.map((c) => c.invocation.entityId))];
    await Promise.all(
      uniqueEntityIds.map(async (eid) => {
        const entity = await this.entityRepo.get(eid);
        if (entity) entityMap.set(eid, entity);
      }),
    );

    // 4. Build affinity set for priority sorting using IDs already collected in step 2 (no re-query)
    const affinitySet = new Set<string>();
    if (worker_id) {
      for (const c of candidates) {
        if (affinityInvocationIds.has(c.invocation.id)) {
          affinitySet.add(c.invocation.entityId);
        }
      }
    }

    // 5. Sort: affinity → entity priority → time in state (oldest first)
    const now = Date.now();
    candidates.sort((a, b) => {
      const affinityA = affinitySet.has(a.invocation.entityId) ? 1 : 0;
      const affinityB = affinitySet.has(b.invocation.entityId) ? 1 : 0;
      if (affinityA !== affinityB) return affinityB - affinityA;

      const entityA = entityMap.get(a.invocation.entityId);
      const entityB = entityMap.get(b.invocation.entityId);
      const priA = entityA?.priority ?? 0;
      const priB = entityB?.priority ?? 0;
      if (priA !== priB) return priB - priA;

      const timeA = entityA?.createdAt?.getTime() ?? now;
      const timeB = entityB?.createdAt?.getTime() ?? now;
      return timeA - timeB;
    });

    // 6. Dedup: only try each invocation once (affinity candidates may overlap with unclaimed)
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (seen.has(c.invocation.id)) return false;
      seen.add(c.invocation.id);
      return true;
    });

    // 7. Try claiming in priority order (entity-first for safe locking)
    for (const { invocation: pending, flow } of deduped) {
      const entity = entityMap.get(pending.entityId);
      if (!entity) continue;
      if (entity.state === "cancelled") continue;
      // Guard: entity state must still match the invocation's stage — if another worker
      // transitioned the entity between candidate fetch and now, skip this candidate.
      if (entity.state !== pending.stage) continue;
      const entityClaimToken = worker_id ?? `agent:${role}`;

      // CAS guard: atomically append an invocation.claimed event using optimistic concurrency.
      // Only one writer wins the unique (entityId, sequence) constraint — losers move to the next candidate.
      if (this.domainEventRepo) {
        const lastSeq = await this.domainEventRepo.getLastSequence(entity.id);
        const casResult = await this.domainEventRepo.appendCas(
          "invocation.claim_attempted",
          entity.id,
          { agentId: entityClaimToken, invocationId: pending.id, stage: pending.stage },
          lastSeq,
        );
        if (!casResult) continue; // Another agent won the race
      }

      const claimed = await this.entityRepo.claimById(entity.id, entityClaimToken);
      if (!claimed) {
        // claimById failed after CAS success — record rollback event for observability
        if (this.domainEventRepo) {
          try {
            await this.domainEventRepo.append("invocation.claim_released", entity.id, {
              agentId: entityClaimToken,
              reason: "claimById_failed",
            });
          } catch (err) {
            this.logger.warn("[engine] CAS claim rollback event failed", { err });
          }
        }
        continue;
      }

      // Post-claim state validation — entity may have transitioned between guard check and claim
      if (claimed.state !== pending.stage) {
        try {
          await this.entityRepo.release(claimed.id, entityClaimToken);
        } catch (releaseErr) {
          this.logger.error(`[engine] release() failed for entity ${claimed.id} after state mismatch:`, releaseErr);
        }
        continue;
      }

      let claimedInvocation: Invocation | null;
      try {
        claimedInvocation = await this.invocationRepo.claim(pending.id, worker_id ?? `agent:${role}`);
      } catch (err) {
        this.logger.error(`[engine] invocationRepo.claim() failed for invocation ${pending.id}:`, err);
        try {
          await this.entityRepo.release(claimed.id, entityClaimToken);
        } catch (releaseErr) {
          this.logger.error(`[engine] release() failed for entity ${claimed.id}:`, releaseErr);
        }
        continue;
      }
      if (!claimedInvocation) {
        try {
          await this.entityRepo.release(claimed.id, entityClaimToken);
        } catch (err) {
          this.logger.error(`[engine] release() failed for entity ${claimed.id}:`, err);
        }
        continue;
      }

      if (worker_id) {
        const windowMs = flow.affinityWindowMs ?? 300000;
        try {
          await this.entityRepo.setAffinity(claimed.id, worker_id, role, new Date(Date.now() + windowMs));
        } catch (err) {
          this.logger.warn(
            `[engine] setAffinity failed for entity ${claimed.id} worker ${worker_id} — continuing:`,
            err,
          );
        }
      }

      await this.eventEmitter.emit({
        type: "entity.claimed",
        entityId: claimed.id,
        flowId: flow.id,
        agentId: worker_id ?? `agent:${role}`,
        emittedAt: new Date(),
      });
      return {
        entityId: claimed.id,
        invocationId: claimedInvocation.id,
        flowName: flow.name,
        stage: pending.stage,
        refs: claimed.refs ?? null,
        artifacts: claimed.artifacts ?? null,
      };
    }

    // 8. Fallback: no unclaimed invocations — claim entity directly and create invocation
    for (const flow of flows) {
      const claimableStates = flow.states.filter((s) => !!s.promptTemplate);
      for (const state of claimableStates) {
        const claimed = await this.entityRepo.claim(flow.id, state.name, worker_id ?? `agent:${role}`);
        if (!claimed) continue;

        if (claimed.state === "cancelled") {
          await this.entityRepo.release(claimed.id, worker_id ?? `agent:${role}`);
          continue;
        }

        const claimedVersionedFlow = await this.flowRepo.getAtVersion(claimed.flowId, claimed.flowVersion);
        const claimedEffectiveFlow = claimedVersionedFlow ?? flow;
        const canCreate = await this.checkConcurrency(claimedEffectiveFlow, claimed);
        if (!canCreate) {
          await this.entityRepo.release(claimed.id, worker_id ?? `agent:${role}`);
          continue;
        }

        const build = await this.buildPromptForEntity(state, claimed, claimedEffectiveFlow);
        const invocation = await this.invocationRepo.create(
          claimed.id,
          state.name,
          build.prompt,
          build.mode,
          undefined,
          build.systemPrompt || build.userContent
            ? { systemPrompt: build.systemPrompt, userContent: build.userContent }
            : undefined,
          state.agentRole ?? null,
        );

        const entityClaimToken = worker_id ?? `agent:${role}`;
        let claimedInvocation: Invocation | null;
        try {
          claimedInvocation = await this.invocationRepo.claim(invocation.id, entityClaimToken);
        } catch (err) {
          this.logger.error(`[engine] invocationRepo.claim() failed for invocation ${invocation.id}:`, err);
          try {
            await this.invocationRepo.fail(invocation.id, err instanceof Error ? err.message : String(err));
          } catch (failErr) {
            this.logger.error(
              `[engine] invocationRepo.fail() cleanup failed for invocation ${invocation.id}:`,
              failErr,
            );
          }
          try {
            await this.entityRepo.release(claimed.id, entityClaimToken);
          } catch (releaseErr) {
            this.logger.error(`[engine] release() failed for entity ${claimed.id}:`, releaseErr);
          }
          continue;
        }
        if (!claimedInvocation) {
          // Another worker won the race and claimed this invocation — it is healthy.
          // Do NOT call fail(); just release our entity lock and move on.
          try {
            await this.entityRepo.release(claimed.id, entityClaimToken);
          } catch (err) {
            this.logger.error(`[engine] release() failed for entity ${claimed.id}:`, err);
          }
          continue;
        }

        if (worker_id) {
          const windowMs = flow.affinityWindowMs ?? 300000;
          try {
            await this.entityRepo.setAffinity(claimed.id, worker_id, role, new Date(Date.now() + windowMs));
          } catch (err) {
            this.logger.warn(
              `[engine] setAffinity failed for entity ${claimed.id} worker ${worker_id} — continuing:`,
              err,
            );
          }
        }

        await this.eventEmitter.emit({
          type: "entity.claimed",
          entityId: claimed.id,
          flowId: flow.id,
          agentId: worker_id ?? `agent:${role}`,
          emittedAt: new Date(),
        });
        return {
          entityId: claimed.id,
          invocationId: claimedInvocation.id,
          flowName: flow.name,
          stage: state.name,
          refs: claimed.refs ?? null,
          artifacts: claimed.artifacts ?? null,
        };
      }
    }

    // 9. No work claimed — distinguish "all entities busy" (short retry) from "empty backlog" (long retry)
    for (const flow of flows) {
      const claimableStateNames = flow.states.filter((s) => !!s.promptTemplate).map((s) => s.name);
      if (claimableStateNames.length > 0) {
        const hasAny = await this.entityRepo.hasAnyInFlowAndState(flow.id, claimableStateNames);
        if (hasAny) return "all_claimed";
      }
    }
    return null;
  }

  private async buildPromptForEntity(
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

    const versionDistribution: Record<string, Record<string, number>> = {};
    for (const flow of allFlows) {
      const versionCounts: Record<string, number> = {};
      for (const state of flow.states) {
        const stateEntities = await this.entityRepo.findByFlowAndState(flow.id, state.name);
        for (const e of stateEntities) {
          const vKey = String(e.flowVersion);
          versionCounts[vKey] = (versionCounts[vKey] ?? 0) + 1;
        }
      }
      if (Object.keys(versionCounts).length > 0) {
        versionDistribution[flow.id] = versionCounts;
      }
    }

    return { flows: statusData, activeInvocations, pendingClaims, versionDistribution };
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

  private async checkConcurrency(flow: Flow, entity: Entity, txRepos?: TransactionRepos | null): Promise<boolean> {
    if (flow.maxConcurrent <= 0 && flow.maxConcurrentPerRepo <= 0) return true;
    const invocationRepo = txRepos?.invocationRepo ?? this.invocationRepo;
    const entityRepo = txRepos?.entityRepo ?? this.entityRepo;

    const allInvocations = await invocationRepo.findByFlow(flow.id);
    // Count active AND pending (unclaimed, not yet started) invocations
    const activeOrPending = allInvocations.filter((i) => !i.completedAt && !i.failedAt);

    if (flow.maxConcurrent > 0 && activeOrPending.length >= flow.maxConcurrent) return false;

    if (flow.maxConcurrentPerRepo > 0 && entity.refs) {
      // Identify invocations for entities sharing the same repo ref as this entity.
      // Fetch each unique entity involved in active/pending invocations to compare refs.
      const uniqueEntityIds = [...new Set(activeOrPending.map((i) => i.entityId))];
      const peerEntities = await Promise.all(uniqueEntityIds.map((id) => entityRepo.get(id)));
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
