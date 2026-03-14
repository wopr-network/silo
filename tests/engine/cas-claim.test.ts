import { describe, it, expect, vi, beforeEach } from "vitest";
import { Engine } from "../../src/engine/engine.js";
import type {
  IEntityRepository,
  IFlowRepository,
  IInvocationRepository,
  IGateRepository,
  ITransitionLogRepository,
  IDomainEventRepository,
  Entity,
  Flow,
  State,
  Invocation,
  DomainEvent,
} from "../../src/repositories/interfaces.js";
import type { IEventBusAdapter } from "../../src/engine/event-types.js";

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "open",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    affinityWorkerId: null,
    affinityRole: null,
    affinityExpiresAt: null,
    parentEntityId: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    id: "s-1",
    flowId: "flow-1",
    name: "open",
    agentRole: null,
    modelTier: null,
    mode: "active",
    promptTemplate: "Do the thing",
    constraints: null,
    onEnter: null,
    onExit: null,
    retryAfterMs: null,
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
    claimRetryAfterMs: null,
    gateTimeoutMs: null,
    version: 1,
    createdBy: null,
    discipline: null,
    defaultModelTier: null,
    timeoutPrompt: null,
    paused: false,
    createdAt: null,
    updatedAt: null,
    states: [makeState({ name: "open" })],
    transitions: [],
    ...overrides,
  };
}

function makeInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: "inv-1",
    entityId: "ent-1",
    stage: "open",
    agentRole: null,
    mode: "active",
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

describe("Engine CAS claim", () => {
  let engine: Engine;
  let domainEventRepo: IDomainEventRepository;
  let entityRepo: IEntityRepository;
  let invocationRepo: IInvocationRepository;

  beforeEach(() => {
    const flow = makeFlow();
    const entity = makeEntity();
    const invocation = makeInvocation();

    const flowRepo = {
      getByName: vi.fn().mockResolvedValue(flow),
      listAll: vi.fn().mockResolvedValue([flow]),
      getAtVersion: vi.fn().mockResolvedValue(flow),
    } as unknown as IFlowRepository;

    entityRepo = {
      get: vi.fn().mockResolvedValue(entity),
      claimById: vi
        .fn()
        .mockResolvedValue({ ...entity, claimedBy: "agent:engineering" }),
      claim: vi.fn().mockResolvedValue(null),
      release: vi.fn().mockResolvedValue(undefined),
      setAffinity: vi.fn().mockResolvedValue(undefined),
      hasAnyInFlowAndState: vi.fn().mockResolvedValue(false),
    } as unknown as IEntityRepository;

    invocationRepo = {
      findUnclaimedByFlow: vi.fn().mockResolvedValue([invocation]),
      findUnclaimedWithAffinity: vi.fn().mockResolvedValue([]),
      findByEntity: vi.fn().mockResolvedValue([invocation]),
      claim: vi
        .fn()
        .mockResolvedValue({ ...invocation, claimedBy: "agent:engineering" }),
      countActiveByFlow: vi.fn().mockResolvedValue(0),
    } as unknown as IInvocationRepository;

    const casEvent: DomainEvent = {
      id: "de-1",
      type: "invocation.claim_attempted",
      entityId: "ent-1",
      payload: {},
      sequence: 4,
      emittedAt: Date.now(),
    };

    domainEventRepo = {
      getLastSequence: vi.fn().mockResolvedValue(3),
      appendCas: vi.fn().mockResolvedValue(casEvent),
      append: vi.fn().mockResolvedValue(casEvent),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as IDomainEventRepository;

    const eventEmitter: IEventBusAdapter = { emit: vi.fn() };
    const transitionLogRepo = {
      record: vi.fn(),
    } as unknown as ITransitionLogRepository;
    const gateRepo = {
      resultsFor: vi.fn().mockResolvedValue([]),
    } as unknown as IGateRepository;

    engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      transitionLogRepo,
      gateRepo,
      adapters: new Map(),
      eventEmitter,
      domainEvents: domainEventRepo,
    });
  });

  it("calls appendCas before claimById during claim", async () => {
    const result = await engine.claimWork("engineering");
    expect(result).not.toBeNull();
    expect(result).not.toBe("all_claimed");
    // getLastSequence should NOT be called — appendCas handles sequence internally
    expect(domainEventRepo.getLastSequence).not.toHaveBeenCalled();
    expect(domainEventRepo.appendCas).toHaveBeenCalledWith(
      "invocation.claim_attempted",
      "ent-1",
      expect.objectContaining({ agentId: "agent:engineering" }),
    );
  });

  it("skips candidate when appendCas returns null (CAS failure)", async () => {
    (domainEventRepo.appendCas as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await engine.claimWork("engineering");
    // Should have tried CAS but not proceeded to claimById
    expect(domainEventRepo.appendCas).toHaveBeenCalled();
    expect(entityRepo.claimById).not.toHaveBeenCalled();
    // No candidates left, returns null
    expect(result).toBeNull();
  });

  it("falls back gracefully when domainEvents is not provided", async () => {
    // Engine without domainEvents still works — CAS guard is skipped entirely
    const engineNoCas = new Engine({
      entityRepo,
      flowRepo: {
        listAll: vi.fn().mockResolvedValue([makeFlow()]),
        getAtVersion: vi.fn().mockResolvedValue(makeFlow()),
      } as unknown as IFlowRepository,
      invocationRepo,
      transitionLogRepo: { record: vi.fn() } as unknown as ITransitionLogRepository,
      gateRepo: { resultsFor: vi.fn().mockResolvedValue([]) } as unknown as IGateRepository,
      adapters: new Map(),
      eventEmitter: { emit: vi.fn() },
      // no domainEvents
    });

    await engineNoCas.claimWork("engineering");
    // getLastSequence and appendCas should NOT be called when domainEvents is absent
    expect(domainEventRepo.getLastSequence).not.toHaveBeenCalled();
    expect(domainEventRepo.appendCas).not.toHaveBeenCalled();
    // claimById should still be called in the non-CAS path
    expect(entityRepo.claimById).toHaveBeenCalled();
  });
});
