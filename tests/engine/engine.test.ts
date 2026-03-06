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
  GateResult,
} from "../../src/repositories/interfaces.js";
import type { IEventBusAdapter, EngineEvent } from "../../src/adapters/interfaces.js";

// --- Test helpers ---

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1", flowId: "flow-1", state: "open",
    refs: null, artifacts: null, claimedBy: null, claimedAt: null,
    flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
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
    initialState: "open", maxConcurrent: 0, maxConcurrentPerRepo: 0,
    version: 1, createdBy: null, createdAt: null, updatedAt: null,
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
    transition: vi.fn().mockImplementation(async (id: string, toState: string) =>
      makeEntity({ id, state: toState }),
    ),
    updateArtifacts: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(null),
    reapExpired: vi.fn().mockResolvedValue([]),
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
    findByFlow: vi.fn().mockResolvedValue([]),
    reapExpired: vi.fn().mockResolvedValue([]),
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

    it("claimWork (unclaimed invocation path) fetches invocations and gateResults before buildInvocation", async () => {
      const mocks = makeMockRepos();
      const pendingInvocation: Invocation = {
        id: "inv-pending", entityId: "ent-1", stage: "coding", agentRole: "coder",
        mode: "active", prompt: "Do the thing", context: null,
        claimedBy: null, claimedAt: null, startedAt: null, completedAt: null,
        failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 1800000,
      };
      const claimedEntity = makeEntity({ state: "coding", claimedBy: "agent:coder" });
      (mocks.invocationRepo.findUnclaimed as ReturnType<typeof vi.fn>).mockResolvedValue([pendingInvocation]);
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
    it("returns flow/state counts", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const status = await engine.getStatus();

      expect(status).toHaveProperty("flows");
      expect(status).toHaveProperty("activeInvocations");
    });
  });

  describe("startReaper", () => {
    it("calls reapExpired on repos periodically", async () => {
      const mocks = makeMockRepos();
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const stop = engine.startReaper(50);
      await new Promise((r) => setTimeout(r, 120));
      stop();

      expect(mocks.invocationRepo.reapExpired).toHaveBeenCalled();
      expect(mocks.entityRepo.reapExpired).toHaveBeenCalled();
    });

    it("does not crash the process when reaper callback throws", async () => {
      const mocks = makeMockRepos();
      (mocks.invocationRepo.reapExpired as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db error"));
      const engine = new Engine({ ...mocks, adapters: new Map() });

      const stop = engine.startReaper(50);
      // Wait long enough for the timer to fire at least once
      await new Promise((r) => setTimeout(r, 120));
      stop();

      // If we reach here without an unhandled rejection crash, the test passes
      expect(true).toBe(true);
    });
  });
});
