import { describe, it, expect, vi, beforeEach } from "vitest";
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
  Transition,
  Invocation,
} from "../../src/repositories/interfaces.js";
import type { IEventBusAdapter, EngineEvent } from "../../src/engine/event-types.js";

// --- Test helpers ---

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1", flowId: "flow-1", state: "open",
    refs: null, artifacts: null, claimedBy: null, claimedAt: null,
    flowVersion: 1, priority: 0, createdAt: new Date(), updatedAt: new Date(),
    affinityWorkerId: null, affinityRole: null, affinityExpiresAt: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    id: "s-1", flowId: "flow-1", name: "coding",
    agentRole: "coder", modelTier: null, mode: "active",
    promptTemplate: "Do the thing", constraints: null,
    ...overrides,
  };
}

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "flow-1", name: "test-flow", description: null, entitySchema: null,
    initialState: "open", maxConcurrent: 0, maxConcurrentPerRepo: 0, affinityWindowMs: 300000,
    version: 1, createdBy: null, discipline: "coder", createdAt: null, updatedAt: null,
    states: [
      makeState({ name: "open", agentRole: "planner", promptTemplate: "Plan" }),
      makeState({ name: "coding", agentRole: "coder", promptTemplate: "Code" }),
      makeState({ name: "done", agentRole: null, promptTemplate: null }),
    ],
    transitions: [
      {
        id: "t-1", flowId: "flow-1", fromState: "open", toState: "coding",
        trigger: "start", gateId: null, condition: null, priority: 0,
        spawnFlow: null, spawnTemplate: null, createdAt: null,
      },
      {
        id: "t-2", flowId: "flow-1", fromState: "coding", toState: "done",
        trigger: "complete", gateId: null, condition: null, priority: 0,
        spawnFlow: null, spawnTemplate: null, createdAt: null,
      },
    ],
    ...overrides,
  };
}

function makeMockRepos() {
  const flow = makeFlow();
  const events: EngineEvent[] = [];

  const entityRepo: IEntityRepository = {
    create: vi.fn().mockResolvedValue(makeEntity()),
    get: vi.fn().mockResolvedValue(makeEntity()),
    findByFlowAndState: vi.fn().mockResolvedValue([]),
    hasAnyInFlowAndState: vi.fn().mockResolvedValue(false),
    transition: vi.fn().mockImplementation(async (id: string, toState: string) =>
      makeEntity({ id, state: toState }),
    ),
    updateArtifacts: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(null),
    claimById: vi.fn().mockResolvedValue(null),
    release: vi.fn().mockResolvedValue(undefined),
    reapExpired: vi.fn().mockResolvedValue([]),
    setAffinity: vi.fn().mockResolvedValue(undefined),
    clearExpiredAffinity: vi.fn().mockResolvedValue([]),
    appendSpawnedChild: vi.fn().mockResolvedValue(undefined),
  };
  const flowRepo: IFlowRepository = {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue(flow),
    getByName: vi.fn().mockResolvedValue(flow),
    update: vi.fn(),
    addState: vi.fn(),
    updateState: vi.fn(),
    addTransition: vi.fn(),
    updateTransition: vi.fn(),
    snapshot: vi.fn(),
    restore: vi.fn(),
    listAll: vi.fn().mockResolvedValue([flow]),
  };
  const invocationRepo: IInvocationRepository = {
    create: vi.fn().mockResolvedValue({
      id: "inv-1", entityId: "ent-1", stage: "coding", agentRole: "coder",
      mode: "active", prompt: "Do the thing", context: null,
      claimedBy: null, claimedAt: null, startedAt: null, completedAt: null,
      failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 1800000,
    } satisfies Invocation),
    get: vi.fn(),
    claim: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    findByEntity: vi.fn().mockResolvedValue([]),
    findUnclaimed: vi.fn().mockResolvedValue([]),
    findUnclaimedWithAffinity: vi.fn().mockResolvedValue([]),
    findUnclaimedByFlow: vi.fn().mockResolvedValue([]),
    findUnclaimedActive: vi.fn().mockResolvedValue([]),
    findByFlow: vi.fn().mockResolvedValue([]),
    reapExpired: vi.fn().mockResolvedValue([]),
    countActiveByFlow: vi.fn().mockResolvedValue(0),
    countPendingByFlow: vi.fn().mockResolvedValue(0),
  };
  const gateRepo: IGateRepository = {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    getByName: vi.fn(),
    record: vi.fn().mockResolvedValue({
      id: "gr-1", entityId: "ent-1", gateId: "g-1",
      passed: true, output: "ok", evaluatedAt: new Date(),
    }),
    resultsFor: vi.fn().mockResolvedValue([]),
  };
  const transitionLogRepo: ITransitionLogRepository = {
    record: vi.fn().mockResolvedValue({
      id: "tl-1", entityId: "ent-1", fromState: "open", toState: "coding",
      trigger: "start", invocationId: null, timestamp: new Date(),
    }),
    historyFor: vi.fn().mockResolvedValue([]),
  };
  const eventEmitter: IEventBusAdapter = {
    emit: vi.fn().mockImplementation(async (e: EngineEvent) => { events.push(e); }),
  };

  return { entityRepo, flowRepo, invocationRepo, gateRepo, transitionLogRepo, eventEmitter, events, flow };
}

describe("Engine", () => {
  describe("processSignal", () => {
    it("transitions entity and creates invocation for next state", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.processSignal("ent-1", "start");

      expect(result.newState).toBe("coding");
      expect(result.gated).toBe(false);
      expect(result.invocationId).toBe("inv-1");
      expect(mocks.entityRepo.transition).toHaveBeenCalledWith("ent-1", "coding", "start", undefined);
      expect(mocks.invocationRepo.create).toHaveBeenCalled();
      expect(mocks.events.some((e) => e.type === "entity.transitioned")).toBe(true);
      expect(mocks.events.some((e) => e.type === "invocation.created")).toBe(true);
    });

    it("throws when entity is not found", async () => {
      const mocks = makeMockRepos();
      (mocks.entityRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await expect(engine.processSignal("missing", "start")).rejects.toThrow("not found");
    });

    it("throws when no transition matches the signal", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await expect(engine.processSignal("ent-1", "nonexistent")).rejects.toThrow();
    });

    it("returns gated result when gate fails", async () => {
      const mocks = makeMockRepos();
      const flowWithGate = makeFlow({
        transitions: [
          {
            id: "t-1", flowId: "flow-1", fromState: "open", toState: "coding",
            trigger: "start", gateId: "gate-1", condition: null, priority: 0,
            spawnFlow: null, spawnTemplate: null, createdAt: null,
          },
        ],
      });
      (mocks.flowRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(flowWithGate);
      (mocks.gateRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "gate-1", name: "lint", type: "command", command: "exit 1",
        functionRef: null, apiConfig: null, timeoutMs: 30000,
      });

      const engine = new Engine({ ...mocks, adapters: new Map() });
      const result = await engine.processSignal("ent-1", "start");

      expect(result.gated).toBe(true);
      expect(result.newState).toBeUndefined();
      expect(mocks.entityRepo.transition).not.toHaveBeenCalled();
    });

    it("persists gate failure to entity artifacts when gate fails", async () => {
      const mocks = makeMockRepos();
      const flowWithGate = makeFlow({
        transitions: [
          {
            id: "t-1", flowId: "flow-1", fromState: "open", toState: "coding",
            trigger: "start", gateId: "gate-1", condition: null, priority: 0,
            spawnFlow: null, spawnTemplate: null, createdAt: null,
          },
        ],
      });
      (mocks.flowRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(flowWithGate);
      (mocks.gateRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "gate-1", name: "lint", type: "command", command: "exit 1",
        functionRef: null, apiConfig: null, timeoutMs: 30000,
      });

      const engine = new Engine({ ...mocks, adapters: new Map() });
      const result = await engine.processSignal("ent-1", "start");

      expect(result.gated).toBe(true);
      expect(result.gateName).toBe("lint");
      expect(mocks.entityRepo.updateArtifacts).toHaveBeenCalledWith("ent-1", {
        gate_failures: [
          expect.objectContaining({
            gateId: "gate-1",
            gateName: "lint",
            output: expect.any(String),
            failedAt: expect.any(String),
          }),
        ],
      });
    });

    it("appends to existing gate_failures array", async () => {
      const mocks = makeMockRepos();
      const existingFailure = { gateId: "gate-0", gateName: "typecheck", output: "type error", failedAt: "2026-01-01T00:00:00.000Z" };
      (mocks.entityRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeEntity({ artifacts: { gate_failures: [existingFailure] } }),
      );
      const flowWithGate = makeFlow({
        transitions: [
          {
            id: "t-1", flowId: "flow-1", fromState: "open", toState: "coding",
            trigger: "start", gateId: "gate-1", condition: null, priority: 0,
            spawnFlow: null, spawnTemplate: null, createdAt: null,
          },
        ],
      });
      (mocks.flowRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(flowWithGate);
      (mocks.gateRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "gate-1", name: "lint", type: "command", command: "exit 1",
        functionRef: null, apiConfig: null, timeoutMs: 30000,
      });

      const engine = new Engine({ ...mocks, adapters: new Map() });
      await engine.processSignal("ent-1", "start");

      expect(mocks.entityRepo.updateArtifacts).toHaveBeenCalledWith("ent-1", {
        gate_failures: [
          existingFailure,
          expect.objectContaining({ gateId: "gate-1", gateName: "lint" }),
        ],
      });
    });

    it("does not create invocation for terminal state", async () => {
      const mocks = makeMockRepos();
      (mocks.entityRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeEntity({ state: "coding" }));
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.processSignal("ent-1", "complete");

      expect(result.newState).toBe("done");
      // "done" state has no agentRole, so no invocation
      expect(mocks.invocationRepo.create).not.toHaveBeenCalled();
    });

    it("sets terminal=true when transitioning to a terminal state", async () => {
      const mocks = makeMockRepos();
      (mocks.entityRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeEntity({ state: "coding" }));
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.processSignal("ent-1", "complete");

      expect(result.terminal).toBe(true);
    });

    it("passes entity with cleared gate_failures to buildInvocation after successful transition", async () => {
      const mocks = makeMockRepos();
      // Entity has stale gate_failures from a prior retry
      const priorFailure = { gateId: "gate-old", gateName: "lint", output: "fail", failedAt: "2026-01-01T00:00:00.000Z" };
      (mocks.entityRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeEntity({ artifacts: { gate_failures: [priorFailure] } }),
      );
      // transition() returns entity without clearing gate_failures (mirrors real DB behaviour)
      (mocks.entityRepo.transition as ReturnType<typeof vi.fn>).mockImplementation(
        async (id: string, toState: string) =>
          makeEntity({ id, state: toState, artifacts: { gate_failures: [priorFailure] } }),
      );

      // Spy on invocationRepo.create to capture the prompt passed to it
      let capturedPrompt: string | undefined;
      (mocks.invocationRepo.create as ReturnType<typeof vi.fn>).mockImplementation(
        async (_entityId: string, _stage: string, prompt: string) => {
          capturedPrompt = prompt;
          return {
            id: "inv-1", entityId: "ent-1", stage: "coding", agentRole: "coder",
            mode: "active", prompt, context: null,
            claimedBy: null, claimedAt: null, startedAt: null, completedAt: null,
            failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 1800000,
          };
        },
      );

      // Use a template that would expose gate_failures if they were still present
      const flowWithTemplate = makeFlow({
        states: [
          makeState({ name: "open", agentRole: "planner", promptTemplate: "Plan" }),
          makeState({ name: "coding", agentRole: "coder", promptTemplate: "Failures: {{entity.artifacts.gate_failures.length}}" }),
          makeState({ name: "done", agentRole: null, promptTemplate: null }),
        ],
      });
      (mocks.flowRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(flowWithTemplate);

      const engine = new Engine({ ...mocks, adapters: new Map() });
      await engine.processSignal("ent-1", "start");

      // gate_failures must be cleared before buildInvocation is called
      expect(capturedPrompt).toBe("Failures: 0");
    });

    it("sets terminal=false when transitioning to a non-terminal state", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.processSignal("ent-1", "start");

      expect(result.terminal).toBe(false);
    });

    it("emits entity.transitioned event", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await engine.processSignal("ent-1", "start");

      const transitioned = mocks.events.find((e) => e.type === "entity.transitioned");
      expect(transitioned).toBeDefined();
      if (transitioned?.type === "entity.transitioned") {
        expect(transitioned.fromState).toBe("open");
        expect(transitioned.toState).toBe("coding");
      }
    });
  });

  describe("createEntity", () => {
    it("creates entity in initial state and emits event", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const entity = await engine.createEntity("test-flow");

      expect(mocks.flowRepo.getByName).toHaveBeenCalledWith("test-flow");
      expect(mocks.entityRepo.create).toHaveBeenCalledWith("flow-1", "open", undefined);
      expect(mocks.events.some((e) => e.type === "entity.created")).toBe(true);
    });

    it("creates invocation if initial state has an agent", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await engine.createEntity("test-flow");

      expect(mocks.invocationRepo.create).toHaveBeenCalled();
    });

    it("throws when flow not found", async () => {
      const mocks = makeMockRepos();
      (mocks.flowRepo.getByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await expect(engine.createEntity("nope")).rejects.toThrow("not found");
    });
  });

  describe("claimWork", () => {
    it("claims an entity and returns invocation details", async () => {
      const mocks = makeMockRepos();
      const claimedEntity = makeEntity({ state: "coding", claimedBy: "agent-1" });
      (mocks.entityRepo.claim as ReturnType<typeof vi.fn>).mockResolvedValue(claimedEntity);
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.claimWork("coder", "test-flow");

      expect(result).not.toBeNull();
      expect(result!.entityId).toBe("ent-1");
      expect(result!.invocationId).toBe("inv-1");
      expect(result!.prompt).toBeTruthy();
    });

    it("returns null when no work is available", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      // entityRepo.claim returns null (default mock)
      const result = await engine.claimWork("coder", "test-flow");

      expect(result).toBeNull();
    });

    it("searches all flows when no flowName provided", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      // entityRepo.claim returns null by default — no work available, but all flows searched
      const result = await engine.claimWork("coder");

      expect(mocks.flowRepo.listAll).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("releases entity claim when invocation claim fails (race window fix)", async () => {
      const mocks = makeMockRepos();
      const claimedEntity = makeEntity({ state: "coding", claimedBy: "agent:coder" });
      const unclaimedInvocation: Invocation = {
        id: "inv-1", entityId: "ent-1", stage: "coding", agentRole: "coder",
        mode: "active", prompt: "Do the thing", context: null,
        claimedBy: null, claimedAt: null, startedAt: null, completedAt: null,
        failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 1800000,
      };

      // findUnclaimedByFlow returns a pending invocation
      (mocks.invocationRepo.findUnclaimedByFlow as ReturnType<typeof vi.fn>).mockResolvedValue([unclaimedInvocation]);
      // Entity claim succeeds on first call (for pre-existing invocation path), then null (for direct-claim path)
      (mocks.entityRepo.claim as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(claimedEntity)
        .mockResolvedValue(null);
      // Invocation claim fails (another agent got it)
      (mocks.invocationRepo.claim as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const engine = new Engine({ ...mocks, adapters: new Map() });
      const result = await engine.claimWork("coder", "test-flow");

      // Should return null since no work was successfully claimed
      expect(result).toBeNull();
      // Entity claim should have been released
      expect(mocks.entityRepo.release).toHaveBeenCalledWith(claimedEntity.id, 'agent:coder');
    });
  });

  describe("concurrency", () => {
    it("respects maxConcurrent by counting pending invocations", async () => {
      const mocks = makeMockRepos();
      const flowWithLimit = makeFlow({ maxConcurrent: 1 });
      (mocks.flowRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(flowWithLimit);
      // Simulate one pending invocation already in the flow
      (mocks.invocationRepo.findByFlow as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "inv-existing", entityId: "ent-other", stage: "coding", agentRole: "coder",
          mode: "active", prompt: "Do thing", context: null, claimedBy: null, claimedAt: null,
          startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 1800000,
        },
      ]);
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.processSignal("ent-1", "start");

      // Concurrency limit hit: no new invocation created
      expect(mocks.invocationRepo.create).not.toHaveBeenCalled();
      expect(result.invocationId).toBeUndefined();
    });

    it("allows invocation when no active/pending invocations exist", async () => {
      const mocks = makeMockRepos();
      const flowWithLimit = makeFlow({ maxConcurrent: 1 });
      (mocks.flowRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(flowWithLimit);
      (mocks.invocationRepo.findByFlow as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const result = await engine.processSignal("ent-1", "start");

      expect(mocks.invocationRepo.create).toHaveBeenCalled();
      expect(result.invocationId).toBe("inv-1");
    });
  });

  describe("enriched entity at buildInvocation call sites", () => {
    it("processSignal fetches invocations and gateResults before buildInvocation", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await engine.processSignal("ent-1", "start");

      expect(mocks.invocationRepo.findByEntity).toHaveBeenCalledWith("ent-1");
      expect(mocks.gateRepo.resultsFor).toHaveBeenCalledWith("ent-1");
    });

    it("createEntity fetches invocations and gateResults before buildInvocation", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await engine.createEntity("test-flow");

      expect(mocks.invocationRepo.findByEntity).toHaveBeenCalledWith("ent-1");
      expect(mocks.gateRepo.resultsFor).toHaveBeenCalledWith("ent-1");
    });

    it("claimWork (fallback path) fetches invocations and gateResults before buildInvocation", async () => {
      const mocks = makeMockRepos();
      const claimedEntity = makeEntity({ state: "coding", claimedBy: "agent:coder" });
      (mocks.entityRepo.claim as ReturnType<typeof vi.fn>).mockResolvedValue(claimedEntity);
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await engine.claimWork("coder", "test-flow");

      expect(mocks.invocationRepo.findByEntity).toHaveBeenCalledWith("ent-1");
      expect(mocks.gateRepo.resultsFor).toHaveBeenCalledWith("ent-1");
    });

    it("processSignal passes adapters to buildInvocation", async () => {
      const mocks = makeMockRepos();
      const mockAdapter = { get: vi.fn().mockResolvedValue({ title: "test" }) };
      const adapters = new Map<string, unknown>([["linear", mockAdapter]]);
      (mocks.entityRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeEntity({ refs: { issue: { adapter: "linear", id: "L-1" } } }),
      );
      (mocks.entityRepo.transition as ReturnType<typeof vi.fn>).mockImplementation(async (id: string, toState: string) =>
        makeEntity({ id, state: toState, refs: { issue: { adapter: "linear", id: "L-1" } } }),
      );
      const engine = new Engine({ ...mocks, adapters });

      await engine.processSignal("ent-1", "start");

      expect(mockAdapter.get).toHaveBeenCalledWith("L-1");
    });

    it("createEntity passes adapters to buildInvocation", async () => {
      const mocks = makeMockRepos();
      const mockAdapter = { get: vi.fn().mockResolvedValue({ title: "test" }) };
      const adapters = new Map<string, unknown>([["linear", mockAdapter]]);
      const refs = { issue: { adapter: "linear", id: "L-2" } };
      (mocks.entityRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeEntity({ refs }),
      );
      const engine = new Engine({ ...mocks, adapters });

      await engine.createEntity("test-flow", refs);

      expect(mockAdapter.get).toHaveBeenCalledWith("L-2");
    });

    it("claimWork passes adapters to buildInvocation", async () => {
      const mocks = makeMockRepos();
      const mockAdapter = { get: vi.fn().mockResolvedValue({ title: "test" }) };
      const adapters = new Map<string, unknown>([["linear", mockAdapter]]);
      const claimedEntity = makeEntity({
        state: "coding", claimedBy: "agent:coder",
        refs: { issue: { adapter: "linear", id: "L-3" } },
      });
      (mocks.entityRepo.claim as ReturnType<typeof vi.fn>).mockResolvedValue(claimedEntity);
      const engine = new Engine({ ...mocks, adapters });

      await engine.claimWork("coder", "test-flow");

      expect(mockAdapter.get).toHaveBeenCalledWith("L-3");
    });

    it("claimWork (unclaimed invocation path) fetches invocations and gateResults before buildInvocation", async () => {
      const mocks = makeMockRepos();
      const pendingInvocation: Invocation = {
        id: "inv-pending", entityId: "ent-1", stage: "coding", agentRole: "coder",
        mode: "active", prompt: "Do the thing", context: null,
        claimedBy: null, claimedAt: null, startedAt: null, completedAt: null,
        failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 1800000,
      };
      const claimedEntity = makeEntity({ state: "coding", claimedBy: "agent:coder" });
      (mocks.invocationRepo.findUnclaimedByFlow as ReturnType<typeof vi.fn>).mockResolvedValue([pendingInvocation]);
      (mocks.entityRepo.claim as ReturnType<typeof vi.fn>).mockResolvedValue(claimedEntity);
      (mocks.invocationRepo.claim as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...pendingInvocation, claimedBy: "agent:coder",
      });
      const engine = new Engine({ ...mocks, adapters: new Map() });

      await engine.claimWork("coder", "test-flow");

      expect(mocks.invocationRepo.findByEntity).toHaveBeenCalledWith("ent-1");
      expect(mocks.gateRepo.resultsFor).toHaveBeenCalledWith("ent-1");
    });
  });

  describe("getStatus", () => {
    it("returns entity counts per flow/state and invocation tallies", async () => {
      const mocks = makeMockRepos();

      // Two entities in "open", one in "coding"
      (mocks.entityRepo.findByFlowAndState as ReturnType<typeof vi.fn>)
        .mockImplementation(async (_flowId: string, state: string) => {
          if (state === "open") return [makeEntity(), makeEntity()];
          if (state === "coding") return [makeEntity({ state: "coding" })];
          return [];
        });

      // One active (claimed, not completed), one pending (unclaimed, not completed)
      (mocks.invocationRepo.countActiveByFlow as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (mocks.invocationRepo.countPendingByFlow as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const engine = new Engine({ ...mocks, adapters: new Map() });
      const status = await engine.getStatus();

      expect(status.flows).toEqual({
        "flow-1": { open: 2, coding: 1, done: 0 },
      });
      expect(status.activeInvocations).toBe(1);
      expect(status.pendingClaims).toBe(1);
    });

    it("returns zeros when no flows exist", async () => {
      const mocks = makeMockRepos();
      (mocks.flowRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const engine = new Engine({ ...mocks, adapters: new Map() });
      const status = await engine.getStatus();

      expect(status).toEqual({ flows: {}, activeInvocations: 0, pendingClaims: 0 });
    });

    it("isolates entity counts per flow and aggregates invocation totals across flows", async () => {
      const mocks = makeMockRepos();

      const flowA = makeFlow({ id: "flow-a", name: "name-a" });
      const flowB = makeFlow({ id: "flow-b", name: "name-b" });
      (mocks.flowRepo.listAll as ReturnType<typeof vi.fn>).mockResolvedValue([flowA, flowB]);

      // flow-a: 1 entity in "open", 0 elsewhere; flow-b: 2 in "coding", 0 elsewhere
      (mocks.entityRepo.findByFlowAndState as ReturnType<typeof vi.fn>)
        .mockImplementation(async (flowId: string, state: string) => {
          if (flowId === "flow-a" && state === "open") return [makeEntity({ flowId: "flow-a" })];
          if (flowId === "flow-b" && state === "coding") return [
            makeEntity({ id: "ent-b1", flowId: "flow-b", state: "coding" }),
            makeEntity({ id: "ent-b2", flowId: "flow-b", state: "coding" }),
          ];
          return [];
        });

      // flow-a: 1 active, 0 pending; flow-b: 0 active, 2 pending
      (mocks.invocationRepo.countActiveByFlow as ReturnType<typeof vi.fn>)
        .mockImplementation(async (flowId: string) => flowId === "flow-a" ? 1 : 0);
      (mocks.invocationRepo.countPendingByFlow as ReturnType<typeof vi.fn>)
        .mockImplementation(async (flowId: string) => flowId === "flow-b" ? 2 : 0);

      const engine = new Engine({ ...mocks, adapters: new Map() });
      const status = await engine.getStatus();

      // Entity counts are isolated per flow
      expect(status.flows["flow-a"]).toEqual({ open: 1, coding: 0, done: 0 });
      expect(status.flows["flow-b"]).toEqual({ open: 0, coding: 2, done: 0 });

      // Invocation totals are summed across both flows
      expect(status.activeInvocations).toBe(1);
      expect(status.pendingClaims).toBe(2);
    });
  });

  describe("startReaper", () => {
    it("calls reapExpired on repos periodically", async () => {
      vi.useFakeTimers();
      try {
        const mocks = makeMockRepos();
        const engine = new Engine({ ...mocks, adapters: new Map() });

        const stop = engine.startReaper(50);
        await vi.advanceTimersByTimeAsync(120);
        await stop();

        expect(mocks.invocationRepo.reapExpired).toHaveBeenCalled();
        expect(mocks.entityRepo.reapExpired).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not crash the process when reaper callback throws", async () => {
      vi.useFakeTimers();
      try {
        const mocks = makeMockRepos();
        (mocks.invocationRepo.reapExpired as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db error"));
        const engine = new Engine({ ...mocks, adapters: new Map() });

        const stop = engine.startReaper(50);
        await vi.advanceTimersByTimeAsync(120);
        await stop();

        // If we reach here without an unhandled rejection crash, the test passes
        expect(true).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stop() prevents new ticks from starting after it is called", async () => {
      vi.useFakeTimers();
      try {
        const mocks = makeMockRepos();
        let ticksStarted = 0;
        (mocks.invocationRepo.reapExpired as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          ticksStarted++;
          return [];
        });

        const engine = new Engine({ ...mocks, adapters: new Map() });
        const stop = engine.startReaper(30);

        // Advance enough for a few ticks
        await vi.advanceTimersByTimeAsync(100);
        await stop();

        // Record count after stop — no further ticks should start
        const countAtStop = ticksStarted;
        await vi.advanceTimersByTimeAsync(100);
        expect(ticksStarted).toBe(countAtStop);
        // 30ms interval over 100ms → exactly 3 ticks (fake timers are deterministic)
        expect(countAtStop).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
