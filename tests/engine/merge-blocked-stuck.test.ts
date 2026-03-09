import { describe, it, expect, vi } from "vitest";
import { Engine } from "../../src/engine/engine.js";
import type {
  IEntityRepository,
  IFlowRepository,
  IInvocationRepository,
  IGateRepository,
  ITransitionLogRepository,
  Entity,
  Flow,
  State,
  Invocation,
} from "../../src/repositories/interfaces.js";
import type { IEventBusAdapter, EngineEvent } from "../../src/engine/event-types.js";

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1", flowId: "flow-1", state: "merging",
    refs: null, artifacts: null, claimedBy: null, claimedAt: null,
    flowVersion: 1, priority: 0, createdAt: new Date(), updatedAt: new Date(),
    affinityWorkerId: null, affinityRole: null, affinityExpiresAt: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    id: "s-1", flowId: "flow-1", name: "merging",
    modelTier: null, mode: "active",
    promptTemplate: null, constraints: null,
    ...overrides,
  };
}

function makeMergeFlow(): Flow {
  return {
    id: "flow-1", name: "wopr-changeset", description: null, entitySchema: null,
    initialState: "backlog", maxConcurrent: 0, maxConcurrentPerRepo: 0, affinityWindowMs: 300000,
    version: 1, createdBy: null, discipline: "engineering", createdAt: null, updatedAt: null,
    states: [
      makeState({ id: "s-merging", name: "merging", promptTemplate: "Watch PR" }),
      makeState({ id: "s-reviewing", name: "reviewing", promptTemplate: "Review PR" }),
      makeState({ id: "s-fixing", name: "fixing", promptTemplate: "Fix PR" }),
      makeState({ id: "s-stuck", name: "stuck", promptTemplate: null, mode: "passive" }),
      makeState({ id: "s-done", name: "done", promptTemplate: null, mode: "passive" }),
    ],
    transitions: [
      {
        id: "t-1", flowId: "flow-1", fromState: "merging", toState: "reviewing",
        trigger: "blocked", gateId: null, condition: null, priority: 1,
        spawnFlow: null, spawnTemplate: null, createdAt: null,
      },
      {
        id: "t-2", flowId: "flow-1", fromState: "merging", toState: "done",
        trigger: "merged", gateId: null, condition: null, priority: 0,
        spawnFlow: null, spawnTemplate: null, createdAt: null,
      },
      {
        id: "t-3", flowId: "flow-1", fromState: "reviewing", toState: "fixing",
        trigger: "issues", gateId: null, condition: null, priority: 0,
        spawnFlow: null, spawnTemplate: null, createdAt: null,
      },
      {
        id: "t-4", flowId: "flow-1", fromState: "fixing", toState: "reviewing",
        trigger: "fixes_pushed", gateId: null, condition: null, priority: 0,
        spawnFlow: null, spawnTemplate: null, createdAt: null,
      },
    ],
  };
}

function makeMockRepos(flow: Flow, entity: Entity) {
  const events: EngineEvent[] = [];
  let currentArtifacts: Record<string, unknown> = { ...(entity.artifacts ?? {}) };

  const entityRepo: IEntityRepository = {
    create: vi.fn().mockResolvedValue(entity),
    get: vi.fn().mockImplementation(async () => ({ ...entity, artifacts: { ...currentArtifacts } })),
    findByFlowAndState: vi.fn().mockResolvedValue([]),
    hasAnyInFlowAndState: vi.fn().mockResolvedValue(false),
    transition: vi.fn().mockImplementation(async (_id: string, toState: string) =>
      ({ ...entity, state: toState, artifacts: { ...currentArtifacts } }),
    ),
    updateArtifacts: vi.fn().mockImplementation(async (_id: string, arts: Record<string, unknown>) => {
      currentArtifacts = { ...currentArtifacts, ...arts };
    }),
    claim: vi.fn().mockResolvedValue(null),
    claimById: vi.fn().mockResolvedValue(null),
    release: vi.fn().mockResolvedValue(undefined),
    reapExpired: vi.fn().mockResolvedValue([]),
    setAffinity: vi.fn().mockResolvedValue(undefined),
    clearExpiredAffinity: vi.fn().mockResolvedValue(undefined),
  } as unknown as IEntityRepository;

  const flowRepo: IFlowRepository = {
    getAtVersion: vi.fn().mockResolvedValue(flow),
    getByName: vi.fn().mockResolvedValue(flow),
    get: vi.fn().mockResolvedValue(flow),
    listAll: vi.fn().mockResolvedValue([flow]),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as IFlowRepository;

  const invocationRepo: IInvocationRepository = {
    create: vi.fn().mockResolvedValue({ id: "inv-1" } as Invocation),
    claim: vi.fn().mockResolvedValue(null),
    findByEntity: vi.fn().mockResolvedValue([]),
    findByFlow: vi.fn().mockResolvedValue([]),
    findUnclaimedByFlow: vi.fn().mockResolvedValue([]),
    findUnclaimedActive: vi.fn().mockResolvedValue([]),
    findUnclaimedWithAffinity: vi.fn().mockResolvedValue([]),
    complete: vi.fn(),
    fail: vi.fn(),
    reapExpired: vi.fn().mockResolvedValue([]),
    countActiveByFlow: vi.fn().mockResolvedValue(0),
    countPendingByFlow: vi.fn().mockResolvedValue(0),
    releaseClaim: vi.fn(),
  } as unknown as IInvocationRepository;

  const gateRepo: IGateRepository = {
    get: vi.fn().mockResolvedValue(null),
    record: vi.fn(),
    resultsFor: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  } as unknown as IGateRepository;

  const transitionLogRepo: ITransitionLogRepository = {
    record: vi.fn().mockResolvedValue(undefined),
    findByEntity: vi.fn().mockResolvedValue([]),
  } as unknown as ITransitionLogRepository;

  const eventEmitter: IEventBusAdapter = {
    emit: vi.fn().mockImplementation(async (event: EngineEvent) => { events.push(event); }),
  };

  return { entityRepo, flowRepo, invocationRepo, gateRepo, transitionLogRepo, eventEmitter, events, getCurrentArtifacts: () => currentArtifacts };
}

describe("merge-blocked stuck detection", () => {
  it("increments merge_blocked_count when blocked signal fires from merging state", async () => {
    const flow = makeMergeFlow();
    const entity = makeEntity({ state: "merging", artifacts: {} });
    const repos = makeMockRepos(flow, entity);
    const engine = new Engine({ ...repos, adapters: new Map() });

    const result = await engine.processSignal("ent-1", "blocked");

    // Should have called updateArtifacts with merge_blocked_count: 1
    const updateCalls = (repos.entityRepo.updateArtifacts as ReturnType<typeof vi.fn>).mock.calls;
    const mergeBlockedUpdate = updateCalls.find(
      (call: unknown[]) => (call[1] as Record<string, unknown>).merge_blocked_count === 1,
    );
    expect(mergeBlockedUpdate).toBeDefined();
    // Should still transition to reviewing (count < 3)
    expect(result.newState).toBe("reviewing");
  });

  it("transitions to stuck when merge_blocked_count reaches threshold (3)", async () => {
    const flow = makeMergeFlow();
    const entity = makeEntity({
      state: "merging",
      artifacts: { merge_blocked_count: 2 },
    });
    const repos = makeMockRepos(flow, entity);
    const engine = new Engine({ ...repos, adapters: new Map() });

    const result = await engine.processSignal("ent-1", "blocked");

    // Count was 2, now 3 — should go to stuck
    expect(result.newState).toBe("stuck");
    // Should store the updated count
    const updateCalls = (repos.entityRepo.updateArtifacts as ReturnType<typeof vi.fn>).mock.calls;
    const mergeBlockedUpdate = updateCalls.find(
      (call: unknown[]) => (call[1] as Record<string, unknown>).merge_blocked_count === 3,
    );
    expect(mergeBlockedUpdate).toBeDefined();
  });

  it("does not interfere with non-blocked signals from merging state", async () => {
    const flow = makeMergeFlow();
    const entity = makeEntity({ state: "merging", artifacts: {} });
    const repos = makeMockRepos(flow, entity);
    const engine = new Engine({ ...repos, adapters: new Map() });

    const result = await engine.processSignal("ent-1", "merged");

    expect(result.newState).toBe("done");
    // merge_blocked_count should NOT be set
    const updateCalls = (repos.entityRepo.updateArtifacts as ReturnType<typeof vi.fn>).mock.calls;
    const mergeBlockedUpdate = updateCalls.find(
      (call: unknown[]) => (call[1] as Record<string, unknown>).merge_blocked_count !== undefined,
    );
    expect(mergeBlockedUpdate).toBeUndefined();
  });

  it("does not interfere with blocked signals from non-merging states", async () => {
    const flow = makeMergeFlow();
    // Add a hypothetical blocked transition from reviewing
    flow.transitions.push({
      id: "t-extra", flowId: "flow-1", fromState: "reviewing", toState: "fixing",
      trigger: "blocked", gateId: null, condition: null, priority: 1,
      spawnFlow: null, spawnTemplate: null, createdAt: null,
    });
    const entity = makeEntity({ state: "reviewing", artifacts: {} });
    const repos = makeMockRepos(flow, entity);
    const engine = new Engine({ ...repos, adapters: new Map() });

    const result = await engine.processSignal("ent-1", "blocked");

    expect(result.newState).toBe("fixing");
    const updateCalls = (repos.entityRepo.updateArtifacts as ReturnType<typeof vi.fn>).mock.calls;
    const mergeBlockedUpdate = updateCalls.find(
      (call: unknown[]) => (call[1] as Record<string, unknown>).merge_blocked_count !== undefined,
    );
    expect(mergeBlockedUpdate).toBeUndefined();
  });

  it("does not override toState and logs warning when threshold reached but no stuck state", async () => {
    const flow = makeMergeFlow();
    // Remove the stuck state from the flow
    flow.states = flow.states.filter((s) => s.name !== "stuck");
    const entity = makeEntity({
      state: "merging",
      artifacts: { merge_blocked_count: 2 },
    });
    const repos = makeMockRepos(flow, entity);
    const warnMock = vi.fn();
    const mockLogger = { info: vi.fn(), warn: warnMock, error: vi.fn(), debug: vi.fn() };
    const engine = new Engine({ ...repos, adapters: new Map(), logger: mockLogger });

    const result = await engine.processSignal("ent-1", "blocked");

    // toState should NOT be overridden to "stuck" — no stuck state exists
    expect(result.newState).not.toBe("stuck");
    // logger.warn should be called with the no-stuck-state message
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("no stuck state"));
  });

  it("stores stuck message in artifacts when transitioning to stuck", async () => {
    const flow = makeMergeFlow();
    const entity = makeEntity({
      state: "merging",
      artifacts: { merge_blocked_count: 2 },
    });
    const repos = makeMockRepos(flow, entity);
    const engine = new Engine({ ...repos, adapters: new Map() });

    await engine.processSignal("ent-1", "blocked");

    const updateCalls = (repos.entityRepo.updateArtifacts as ReturnType<typeof vi.fn>).mock.calls;
    const stuckUpdate = updateCalls.find(
      (call: unknown[]) => (call[1] as Record<string, unknown>).merge_blocked_message !== undefined,
    );
    expect(stuckUpdate).toBeDefined();
    expect((stuckUpdate![1] as Record<string, unknown>).merge_blocked_message).toContain(
      "PR blocked in merge queue 3+ times",
    );
  });
});
