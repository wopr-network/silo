import type { IEventBusAdapter } from "../adapters/interfaces.js";
import type {
  Artifacts,
  Entity,
  Flow,
  IEntityRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "../repositories/interfaces.js";
import { executeSpawn } from "./flow-spawner.js";
import { evaluateGate } from "./gate-evaluator.js";
import { buildInvocation } from "./invocation-builder.js";
import { findTransition, isTerminal } from "./state-machine.js";

export interface ProcessSignalResult {
  newState?: string;
  gatesPassed: string[];
  gated: boolean;
  gateOutput?: string;
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
}

export class Engine {
  private entityRepo: IEntityRepository;
  private flowRepo: IFlowRepository;
  private invocationRepo: IInvocationRepository;
  private gateRepo: IGateRepository;
  private transitionLogRepo: ITransitionLogRepository;
  readonly adapters: Map<string, unknown>;
  private eventEmitter: IEventBusAdapter;

  constructor(deps: EngineDeps) {
    this.entityRepo = deps.entityRepo;
    this.flowRepo = deps.flowRepo;
    this.invocationRepo = deps.invocationRepo;
    this.gateRepo = deps.gateRepo;
    this.transitionLogRepo = deps.transitionLogRepo;
    this.adapters = deps.adapters;
    this.eventEmitter = deps.eventEmitter;
  }

  async processSignal(entityId: string, signal: string, artifacts?: Artifacts): Promise<ProcessSignalResult> {
    // 1. Load entity
    const entity = await this.entityRepo.get(entityId);
    if (!entity) throw new Error(`Entity "${entityId}" not found`);

    // 2. Load flow
    const flow = await this.flowRepo.get(entity.flowId);
    if (!flow) throw new Error(`Flow "${entity.flowId}" not found`);

    // 3. Find transition
    const transition = findTransition(flow, entity.state, signal);
    if (!transition)
      throw new Error(`No transition from "${entity.state}" on signal "${signal}" in flow "${flow.name}"`);

    // 4. Evaluate gate if present
    const gatesPassed: string[] = [];
    if (transition.gateId) {
      const gate = await this.gateRepo.get(transition.gateId);
      if (!gate) throw new Error(`Gate "${transition.gateId}" not found`);

      const gateResult = await evaluateGate(gate, entity, this.gateRepo);
      if (!gateResult.passed) {
        await this.eventEmitter.emit({
          type: "gate.failed",
          entityId,
          gateId: gate.id,
          emittedAt: new Date(),
        });
        return { gated: true, gateOutput: gateResult.output, gatesPassed, terminal: false };
      }
      gatesPassed.push(gate.id);
      await this.eventEmitter.emit({
        type: "gate.passed",
        entityId,
        gateId: gate.id,
        emittedAt: new Date(),
      });
    }

    // 5. Transition entity
    const updated = await this.entityRepo.transition(entityId, transition.toState, signal, artifacts);

    // 6. Record transition log
    await this.transitionLogRepo.record({
      entityId,
      fromState: entity.state,
      toState: transition.toState,
      trigger: signal,
      invocationId: null,
      timestamp: new Date(),
    });

    // 7. Emit transition event
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

    // 8. Create invocation if new state has an agent role
    const newStateDef = flow.states.find((s) => s.name === transition.toState);
    if (newStateDef?.agentRole) {
      const canCreate = await this.checkConcurrency(flow, entity);
      if (canCreate) {
        const build = buildInvocation(newStateDef, updated);
        const invocation = await this.invocationRepo.create(
          entityId,
          transition.toState,
          build.prompt,
          build.mode,
          build.agentRole ?? undefined,
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

    // 9. Spawn child flows
    const spawned = await executeSpawn(transition, updated, this.flowRepo, this.entityRepo);
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

    // Create invocation if initial state has an agent role
    const initialState = flow.states.find((s) => s.name === flow.initialState);
    if (initialState?.agentRole) {
      const build = buildInvocation(initialState, entity);
      await this.invocationRepo.create(
        entity.id,
        flow.initialState,
        build.prompt,
        build.mode,
        build.agentRole ?? undefined,
      );
    }

    return entity;
  }

  async claimWork(role: string, flowName?: string): Promise<ClaimWorkResult | null> {
    let flows: Flow[];
    if (flowName) {
      const flow = await this.flowRepo.getByName(flowName);
      flows = flow ? [flow] : [];
    } else {
      flows = await this.flowRepo.listAll();
    }

    for (const flow of flows) {
      const claimableStates = flow.states.filter((s) => s.agentRole === role);

      for (const state of claimableStates) {
        const claimed = await this.entityRepo.claim(flow.id, state.name, `agent:${role}`);
        if (claimed) {
          const build = buildInvocation(state, claimed);
          const invocation = await this.invocationRepo.create(
            claimed.id,
            state.name,
            build.prompt,
            build.mode,
            build.agentRole ?? undefined,
          );
          await this.eventEmitter.emit({
            type: "entity.claimed",
            entityId: claimed.id,
            flowId: flow.id,
            agentId: `agent:${role}`,
            emittedAt: new Date(),
          });
          return {
            entityId: claimed.id,
            invocationId: invocation.id,
            prompt: build.prompt,
            context: build.context,
          };
        }
      }
    }

    return null;
  }

  async getStatus(): Promise<EngineStatus> {
    return {
      flows: {},
      activeInvocations: 0,
      pendingClaims: 0,
    };
  }

  startReaper(intervalMs: number): () => void {
    const timer = setInterval(() => {
      (async () => {
        const expired = await this.invocationRepo.reapExpired();
        for (const inv of expired) {
          await this.eventEmitter.emit({
            type: "invocation.expired",
            entityId: inv.entityId,
            invocationId: inv.id,
            emittedAt: new Date(),
          });
        }
        await this.entityRepo.reapExpired(intervalMs);
      })().catch((err) => {
        console.error("[reaper] error:", err);
      });
    }, intervalMs);

    return () => clearInterval(timer);
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
