import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine/engine.js";
import type {
  Entity,
  Flow,
  IGateRepository,
  IEntityRepository,
  IEventRepository,
  IFlowRepository,
  IInvocationRepository,
  ITransitionLogRepository,
  Invocation,
} from "../../src/repositories/interfaces.js";
import type { IEventBusAdapter } from "../../src/engine/event-types.js";

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "coding",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    affinityWorkerId: null,
    affinityRole: null,
    affinityExpiresAt: null,
    ...overrides,
  };
}

function makeInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: "inv-1",
    entityId: "ent-1",
    stage: "coding",
    mode: "passive",
    prompt: "Do work",
    context: null,
    claimedBy: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    signal: null,
    artifacts: null,
    error: null,
    ttlMs: 1800000,
    ...overrides,
  };
}

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "flow-1",
    name: "test-flow",
    description: null,
    entitySchema: null,
    initialState: "open",
    maxConcurrent: 0,
    maxConcurrentPerRepo: 0,
    affinityWindowMs: 300000,
    discipline: null,
    version: 1,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    states: [
      {
        id: "s-1",
        flowId: "flow-1",
        name: "coding",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Code it",
        constraints: null,
      },
      {
        id: "s-2",
        flowId: "flow-1",
        name: "done",
        modelTier: null,
        mode: "passive",
        promptTemplate: null,
        constraints: null,
      },
    ],
    transitions: [
      {
        id: "t-1",
        flowId: "flow-1",
        fromState: "coding",
        toState: "done",
        trigger: "complete",
        gateId: null,
        condition: null,
        priority: 0,
        spawnFlow: null,
        spawnTemplate: null,
        createdAt: null,
      },
    ],
    ...overrides,
  };
}

function makeEntityRepo(overrides: Partial<IEntityRepository> = {}): IEntityRepository {
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue(makeEntity()),
    findByFlowAndState: vi.fn().mockResolvedValue([]),
    hasAnyInFlowAndState: vi.fn().mockResolvedValue(false),
    transition: vi.fn(),
    updateArtifacts: vi.fn(),
    claim: vi.fn().mockResolvedValue(null),
    claimById: vi.fn().mockResolvedValue(null),
    release: vi.fn(),
    reapExpired: vi.fn().mockResolvedValue([]),
    setAffinity: vi.fn().mockResolvedValue(undefined),
    clearExpiredAffinity: vi.fn().mockResolvedValue([]),
    appendSpawnedChild: vi.fn(),
    ...overrides,
  } as unknown as IEntityRepository;
}

function makeInvocationRepo(overrides: Partial<IInvocationRepository> = {}): IInvocationRepository {
  return {
    create: vi.fn(),
    get: vi.fn(),
    claim: vi.fn().mockResolvedValue(null),
    complete: vi.fn(),
    fail: vi.fn(),
    findByEntity: vi.fn().mockResolvedValue([]),
    findUnclaimed: vi.fn().mockResolvedValue([]),
    findUnclaimedByFlow: vi.fn().mockResolvedValue([]),
    findUnclaimedWithAffinity: vi.fn().mockResolvedValue([]),
    findByFlow: vi.fn().mockResolvedValue([]),
    reapExpired: vi.fn().mockResolvedValue([]),
    findUnclaimedActive: vi.fn().mockResolvedValue([]),
    countActiveByFlow: vi.fn().mockResolvedValue(0),
    countPendingByFlow: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as IInvocationRepository;
}

function makeFlowRepo(flow: Flow): IFlowRepository {
  return {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue([flow]),
    get: vi.fn().mockResolvedValue(flow),
    getByName: vi.fn().mockResolvedValue(flow),
    getAtVersion: vi.fn().mockResolvedValue(flow),
    update: vi.fn(),
    addState: vi.fn(),
    updateState: vi.fn(),
    addTransition: vi.fn(),
    updateTransition: vi.fn(),
    snapshot: vi.fn(),
    restore: vi.fn(),
    listAll: vi.fn().mockResolvedValue([flow]),
  } as unknown as IFlowRepository;
}

function makeEngine(
  entityRepo: IEntityRepository,
  flowRepo: IFlowRepository,
  invocationRepo: IInvocationRepository,
) {
  const gateRepo: IGateRepository = {
    create: vi.fn(),
    get: vi.fn(),
    getByName: vi.fn(),
    listAll: vi.fn(),
    record: vi.fn(),
    resultsFor: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  } as unknown as IGateRepository;
  const transitionLogRepo: ITransitionLogRepository = {
    record: vi.fn(),
    historyFor: vi.fn(),
  } as unknown as ITransitionLogRepository;
  const eventEmitter: IEventBusAdapter = { emit: vi.fn() };

  return new Engine({
    entityRepo,
    flowRepo,
    invocationRepo,
    gateRepo,
    transitionLogRepo,
    adapters: new Map(),
    eventEmitter,
  });
}

describe("worker affinity — Entity interface", () => {
  it("Entity type has affinity fields", () => {
    const entity = makeEntity({
      affinityWorkerId: "wkr-1",
      affinityRole: "engineering",
      affinityExpiresAt: new Date(Date.now() + 300000),
    });
    expect(entity.affinityWorkerId).toBe("wkr-1");
    expect(entity.affinityRole).toBe("engineering");
    expect(entity.affinityExpiresAt).toBeInstanceOf(Date);
  });

  it("Flow type has affinityWindowMs", () => {
    const flow = makeFlow({ affinityWindowMs: 300000 });
    expect(flow.affinityWindowMs).toBe(300000);
  });
});

describe("worker affinity — claim priority", () => {
  it("affinity worker gets entity back after idle + reclaim within window", async () => {
    const affinityEntity = makeEntity({
      id: "ent-affinity",
      affinityWorkerId: "wkr-A",
      affinityRole: "engineering",
      affinityExpiresAt: new Date(Date.now() + 300000),
    });
    const affinityInv = makeInvocation({ id: "inv-affinity", entityId: "ent-affinity" });
    const flow = makeFlow();

    const invocationRepo = makeInvocationRepo({
      findUnclaimedWithAffinity: vi.fn().mockResolvedValue([affinityInv]),
      findUnclaimed: vi.fn().mockResolvedValue([]),
      claim: vi.fn().mockResolvedValue(affinityInv),
    });

    const entityRepo = makeEntityRepo({
      claimById: vi.fn().mockResolvedValue(affinityEntity),
      get: vi.fn().mockResolvedValue(affinityEntity),
    });

    const flowRepo = makeFlowRepo(flow);
    const engine = makeEngine(entityRepo, flowRepo, invocationRepo);

    const result = await engine.claimWork("engineering", "test-flow", "wkr-A");

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe("ent-affinity");
    expect(invocationRepo.findUnclaimedWithAffinity).toHaveBeenCalledWith("flow-1", "engineering", "wkr-A");
    expect(entityRepo.setAffinity).toHaveBeenCalledWith("ent-affinity", "wkr-A", "engineering", expect.any(Date));
  });

  it("expired affinity releases entity to open pool", async () => {
    const inv = makeInvocation({ id: "inv-regular", entityId: "ent-1" });
    const entity = makeEntity();
    const flow = makeFlow();

    const invocationRepo = makeInvocationRepo({
      findUnclaimedWithAffinity: vi.fn().mockResolvedValue([]), // expired — no match
      findUnclaimedByFlow: vi.fn().mockResolvedValue([inv]),
      claim: vi.fn().mockResolvedValue(inv),
    });

    const entityRepo = makeEntityRepo({
      claimById: vi.fn().mockResolvedValue(entity),
      get: vi.fn().mockResolvedValue(entity),
    });

    const flowRepo = makeFlowRepo(flow);
    const engine = makeEngine(entityRepo, flowRepo, invocationRepo);

    const result = await engine.claimWork("engineering", "test-flow", "wkr-A");

    expect(result).not.toBeNull();
    // Affinity query returned empty; fell through to open pool
    expect(invocationRepo.findUnclaimedWithAffinity).toHaveBeenCalled();
    expect(invocationRepo.findUnclaimedByFlow).toHaveBeenCalled();
  });

  it("discipline boundary handoff records new affinity worker", async () => {
    const entity = makeEntity({
      state: "deploy",
      affinityWorkerId: "wkr-eng-1",
      affinityRole: "engineering",
      affinityExpiresAt: new Date(Date.now() + 300000),
    });
    const inv = makeInvocation({ stage: "deploy" });
    const flow = makeFlow({
      states: [
        {
          id: "s-1",
          flowId: "flow-1",
          name: "deploy",
          modelTier: null,
          mode: "passive",
          promptTemplate: "Deploy it",
          constraints: null,
        },
        {
          id: "s-2",
          flowId: "flow-1",
          name: "done",
          modelTier: null,
          mode: "passive",
          promptTemplate: null,
          constraints: null,
        },
      ],
    });

    const invocationRepo = makeInvocationRepo({
      findUnclaimedWithAffinity: vi.fn().mockResolvedValue([]),
      findUnclaimedByFlow: vi.fn().mockResolvedValue([inv]),
      claim: vi.fn().mockResolvedValue(inv),
    });

    const entityRepo = makeEntityRepo({
      claimById: vi.fn().mockResolvedValue(entity),
      get: vi.fn().mockResolvedValue(entity),
    });

    const flowRepo = makeFlowRepo(flow);
    const engine = makeEngine(entityRepo, flowRepo, invocationRepo);

    await engine.claimWork("devops", "test-flow", "wkr-devops-1");

    // setAffinity called with the devops worker, overwriting engineering affinity
    expect(entityRepo.setAffinity).toHaveBeenCalledWith(entity.id, "wkr-devops-1", "devops", expect.any(Date));
  });

  it("affinity skipped when no worker_id provided", async () => {
    const inv = makeInvocation();
    const entity = makeEntity();
    const flow = makeFlow();

    const invocationRepo = makeInvocationRepo({
      findUnclaimedByFlow: vi.fn().mockResolvedValue([inv]),
      claim: vi.fn().mockResolvedValue(inv),
    });

    const entityRepo = makeEntityRepo({
      claimById: vi.fn().mockResolvedValue(entity),
      get: vi.fn().mockResolvedValue(entity),
    });

    const flowRepo = makeFlowRepo(flow);
    const engine = makeEngine(entityRepo, flowRepo, invocationRepo);

    await engine.claimWork("engineering", "test-flow"); // no workerId

    expect(invocationRepo.findUnclaimedWithAffinity).not.toHaveBeenCalled();
    expect(entityRepo.setAffinity).not.toHaveBeenCalled();
  });
});
