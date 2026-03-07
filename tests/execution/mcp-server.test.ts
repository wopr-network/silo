import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMcpServer } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import { Engine } from "../../src/engine/engine.js";
import type {
  Entity,
  Flow,
  Invocation,
  IEntityRepository,
  IEventRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "../../src/repositories/interfaces.js";

// ─── Mock helpers ───

function mockEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "draft",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: "inv-1",
    entityId: "ent-1",
    stage: "draft",
    mode: "passive",
    prompt: "Implement the feature",
    context: { repo: "wopr" },
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

function mockFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "flow-1",
    name: "test-flow",
    description: null,
    entitySchema: null,
    initialState: "draft",
    maxConcurrent: 0,
    maxConcurrentPerRepo: 0,
    version: 1,
    createdBy: null,
    discipline: null,
    createdAt: null,
    updatedAt: null,
    states: [
      {
        id: "s1",
        flowId: "flow-1",
        name: "draft",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Do the work",
        constraints: null,
      },
      {
        id: "s2",
        flowId: "flow-1",
        name: "review",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Review the work",
        constraints: null,
      },
      {
        id: "s3",
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
        id: "t1",
        flowId: "flow-1",
        fromState: "draft",
        toState: "review",
        trigger: "complete",
        gateId: null,
        condition: null,
        priority: 0,
        spawnFlow: null,
        spawnTemplate: null,
        createdAt: null,
      },
      {
        id: "t2",
        flowId: "flow-1",
        fromState: "review",
        toState: "done",
        trigger: "approve",
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

function createMockDeps(): McpServerDeps {
  const entities: IEntityRepository = {
    create: async () => mockEntity(),
    get: async (id) => (id === "ent-1" ? mockEntity() : null),
    findByFlowAndState: async () => [mockEntity()],
    hasAnyInFlowAndState: async () => true,
    transition: async (_id, toState) => mockEntity({ state: toState }),
    updateArtifacts: async () => {},
    claim: async () => mockEntity({ claimedBy: "agent-1" }),
    claimById: async (id) => mockEntity({ id, claimedBy: "agent-1" }),
    reapExpired: async () => [],
    release: async () => {},
    setAffinity: async () => {},
    clearExpiredAffinity: async () => [],
    appendSpawnedChild: async () => {},
  };

  const flows: IFlowRepository = {
    create: async () => mockFlow(),
    get: async (id) => (id === "flow-1" ? mockFlow() : null),
    getByName: async (name) => (name === "test-flow" ? mockFlow() : null),
    list: async () => [mockFlow()],
    update: async () => mockFlow(),
    addState: async () => mockFlow().states[0],
    updateState: async () => mockFlow().states[0],
    addTransition: async () => mockFlow().transitions[0],
    updateTransition: async () => mockFlow().transitions[0],
    snapshot: async () => ({
      id: "fv-1",
      flowId: "flow-1",
      version: 1,
      snapshot: {},
      changedBy: null,
      changeReason: null,
      createdAt: null,
    }),
    restore: async () => {},
    listAll: async () => [mockFlow()],
  };

  const invocations: IInvocationRepository = {
    create: async () => mockInvocation(),
    get: async () => mockInvocation(),
    claim: async (id) =>
      mockInvocation({ id, claimedBy: "coder", claimedAt: new Date() }),
    complete: async (id, signal, artifacts) =>
      mockInvocation({
        id,
        signal,
        artifacts: artifacts ?? null,
        completedAt: new Date(),
      }),
    fail: async (id, error) => mockInvocation({ id, error, failedAt: new Date() }),
    findByEntity: async () => [
      mockInvocation({ claimedBy: "coder", claimedAt: new Date() }),
    ],
    findUnclaimed: async () => [mockInvocation()],
    findUnclaimedByFlow: async () => [mockInvocation()],
    findByFlow: async () => [],
    findUnclaimedActive: async () => [],
    reapExpired: async () => [],
  };

  const gates: IGateRepository = {
    create: async () => ({
      id: "g-1",
      name: "lint",
      type: "command",
      command: "pnpm lint",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    }),
    get: async () => null,
    getByName: async () => null,
    listAll: async () => [],
    record: async (entityId, gateId, passed, output) => ({
      id: "gr-1",
      entityId,
      gateId,
      passed,
      output,
      evaluatedAt: new Date(),
    }),
    resultsFor: async () => [],
  };

  const transitions: ITransitionLogRepository = {
    record: async (log) => ({ id: "tl-1", ...log }),
    historyFor: async () => [],
  };

  const eventRepo: IEventRepository = {
    emitDefinitionChanged: async () => {},
  };

  const noopEventEmitter = { emit: async () => {} };

  const engine = new Engine({
    entityRepo: entities,
    flowRepo: flows,
    invocationRepo: invocations,
    gateRepo: gates,
    transitionLogRepo: transitions,
    adapters: new Map(),
    eventEmitter: noopEventEmitter,
  });

  return { entities, flows, invocations, gates, transitions, eventRepo, engine };
}

// ─── Tests ───

describe("MCP server", () => {
  it("should export createMcpServer function", () => {
    expect(typeof createMcpServer).toBe("function");
  });

  it("should create a server instance", () => {
    const deps = createMockDeps();
    const server = createMcpServer(deps);
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});

describe("MCP tool handlers", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    // Default flow for existing tests has discipline "coder" so flow.claim with role "coder" works
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];
  });

  async function callTool(toolName: string, args: Record<string, unknown>) {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );

    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const result = await client.callTool({ name: toolName, arguments: args });
    await client.close();
    await server.close();
    return result;
  }

  async function listTools() {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );

    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const result = await client.listTools();
    await client.close();
    await server.close();
    return result;
  }

  it("lists all 20 tools", async () => {
    const result = await listTools();
    expect(result.tools).toHaveLength(20);
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "admin.entity.create",
      "admin.flow.create",
      "admin.flow.restore",
      "admin.flow.snapshot",
      "admin.flow.update",
      "admin.gate.attach",
      "admin.gate.create",
      "admin.state.create",
      "admin.state.update",
      "admin.transition.create",
      "admin.transition.update",
      "flow.claim",
      "flow.fail",
      "flow.get_prompt",
      "flow.report",
      "query.entities",
      "query.entity",
      "query.flow",
      "query.flows",
      "query.invocations",
    ]);
  });

  it("flow.claim returns invocation when work available", async () => {
    const result = await callTool("flow.claim", { worker_id: "wkr_test", role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("entity_id");
    expect(data).toHaveProperty("invocation_id");
    expect(data).toHaveProperty("prompt");
  });

  it("flow.claim returns structured check_back when no work available (empty backlog)", async () => {
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.findByFlowAndState = async () => [];
    deps.entities.hasAnyInFlowAndState = async () => false;
    const result = await callTool("flow.claim", { worker_id: "wkr_test", role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000);
    expect(data.message).toContain("No work available");
  });

  it("flow.claim returns error for unknown flow", async () => {
    const result = await callTool("flow.claim", {
      worker_id: "wkr_test",
      role: "coder",
      flow: "nonexistent",
    });
    expect(result.isError).toBe(true);
  });

  it("flow.get_prompt returns prompt and context", async () => {
    const result = await callTool("flow.get_prompt", { entity_id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("prompt");
    expect(data).toHaveProperty("context");
  });

  it("flow.get_prompt returns error for unknown entity", async () => {
    const result = await callTool("flow.get_prompt", { entity_id: "nope" });
    expect(result.isError).toBe(true);
  });

  it("flow.report transitions entity and returns new state", async () => {
    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.new_state).toBe("review");
    expect(["continue", "waiting", "completed", "check_back"]).toContain(data.next_action);
  });

  it("flow.report returns error for missing entity", async () => {
    const result = await callTool("flow.report", {
      entity_id: "nope",
      signal: "complete",
    });
    expect(result.isError).toBe(true);
  });

  it("flow.fail marks invocation as failed", async () => {
    const result = await callTool("flow.fail", {
      entity_id: "ent-1",
      error: "build failed",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.acknowledged).toBe(true);
  });

  it("query.entity returns entity with history", async () => {
    const result = await callTool("query.entity", { id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("id", "ent-1");
    expect(data).toHaveProperty("history");
  });

  it("query.entities returns matching entities", async () => {
    const result = await callTool("query.entities", {
      flow: "test-flow",
      state: "draft",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("query.invocations returns invocations for entity", async () => {
    const result = await callTool("query.invocations", { entity_id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
  });

  it("query.flow returns flow definition", async () => {
    const result = await callTool("query.flow", { name: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("name", "test-flow");
    expect(data).toHaveProperty("states");
    expect(data).toHaveProperty("transitions");
  });

  it("query.flow returns error for unknown flow", async () => {
    const result = await callTool("query.flow", { name: "nonexistent" });
    expect(result.isError).toBe(true);
  });

  it("query.flows returns all flow definitions without promptTemplate", async () => {
    const result = await callTool("query.flows", {});
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0]).toHaveProperty("name", "test-flow");
    expect(data[0]).toHaveProperty("states");
    expect(data[0]).toHaveProperty("transitions");
    // promptTemplate must not be exposed in list responses
    for (const state of data[0].states) {
      expect(state).not.toHaveProperty("promptTemplate");
    }
  });

  it("query.flows returns empty array when no flows exist", async () => {
    const freshDeps = { ...deps, flows: { ...deps.flows, list: vi.fn(async () => []) } };
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(freshDeps, "query.flows", {});
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("query.flows requires workerToken when configured", async () => {
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(
      deps,
      "query.flows",
      {},
      { workerToken: "secret-token", callerToken: "wrong-token" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  // Finding 1: flow.report completes the invocation before delegating to the engine
  // (so the concurrency check doesn't count it as active). If the signal has no
  // matching transition the engine throws and the invocation is already completed.
  it("flow.report returns error when signal has no matching transition", async () => {
    let completeCalled = false;
    deps.invocations.complete = async (id, signal, artifacts) => {
      completeCalled = true;
      return mockInvocation({ id, signal, artifacts: artifacts ?? null, completedAt: new Date() });
    };
    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "nonexistent-signal",
    });
    expect(result.isError).toBe(true);
    expect(completeCalled).toBe(true);
  });

  // Finding 2: flow.claim with no flow searches all flows
  it("flow.claim without flow param searches all flows", async () => {
    const result = await callTool("flow.claim", { worker_id: "wkr_test", role: "coder" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    // Should find work via list() rather than returning an error
    expect(result.isError).toBeUndefined();
    expect(data).toHaveProperty("entity_id");
  });

  // Finding 3: flow.get_prompt returns active (uncompleted) invocation, not last by insertion order
  it("flow.get_prompt returns active invocation not stale completed one", async () => {
    const completedInv = mockInvocation({
      id: "inv-old",
      prompt: "Old completed prompt",
      claimedAt: new Date(Date.now() - 10000),
      completedAt: new Date(Date.now() - 5000),
    });
    const activeInv = mockInvocation({
      id: "inv-active",
      prompt: "Active prompt",
      claimedAt: new Date(),
      completedAt: null,
    });
    // Return completed first, then active — array order should not determine result
    deps.invocations.findByEntity = async () => [completedInv, activeInv];
    const result = await callTool("flow.get_prompt", { entity_id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.prompt).toBe("Active prompt");
  });

  // Finding 4: flow.claim iterates candidates on race condition (claim() returns null for first)
  it("flow.claim tries next candidate when first claim fails (race condition)", async () => {
    const inv1 = mockInvocation({ id: "inv-1", entityId: "ent-1" });
    const inv2 = mockInvocation({ id: "inv-2", entityId: "ent-2" });
    deps.invocations.findUnclaimedByFlow = async () => [inv1, inv2];
    deps.entities.get = async (id) => mockEntity({ id, flowId: "flow-1" });
    let callCount = 0;
    deps.invocations.claim = async (id, _role) => {
      callCount++;
      if (id === "inv-1") return null; // lost the race on first candidate
      return mockInvocation({ id, entityId: "ent-2", claimedBy: _role, claimedAt: new Date() });
    };
    const result = await callTool("flow.claim", { worker_id: "wkr_test", role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-2");
    expect(callCount).toBe(2);
  });

  // Finding 5: gates must not be auto-passed — engine evaluates gate and blocks if it fails
  it("flow.report returns gated result when gate fails", async () => {
    const flowWithGate = mockFlow({
      transitions: [
        {
          id: "t-gate",
          flowId: "flow-1",
          fromState: "draft",
          toState: "review",
          trigger: "complete",
          gateId: "g-1",
          condition: null,
          priority: 0,
          spawnFlow: null,
          spawnTemplate: null,
          createdAt: null,
        },
      ],
    });
    deps.flows.get = async () => flowWithGate;
    deps.flows.getByName = async () => flowWithGate;
    deps.gates.get = async () => ({
      id: "g-1",
      name: "lint-gate",
      type: "command",
      command: "false",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    });
    deps.gates.resultsFor = async () => [];
    let failCalled = false;
    deps.invocations.fail = async (id, error) => {
      failCalled = true;
      return mockInvocation({ id, error, failedAt: new Date() });
    };
    let completeCalled = false;
    deps.invocations.complete = async (id, signal, artifacts) => {
      completeCalled = true;
      return mockInvocation({ id, signal, artifacts: artifacts ?? null, completedAt: new Date() });
    };
    // Rebuild engine with updated deps
    const noopEventEmitter = { emit: async () => {} };
    deps.engine = new Engine({
      entityRepo: deps.entities,
      flowRepo: deps.flows,
      invocationRepo: deps.invocations,
      gateRepo: deps.gates,
      transitionLogRepo: deps.transitions,
      adapters: new Map(),
      eventEmitter: noopEventEmitter,
    });
    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    // Gate blocked — invocation completed (so concurrency count is correct),
    // and a replacement unclaimed invocation is created so entity can be reclaimed.
    expect(data.gated).toBe(true);
    expect(failCalled).toBe(false);
    expect(completeCalled).toBe(true);
  });

  it("flow.report returns structured gate info (gated, gateName) when gate blocks", async () => {
    const flowWithGate = mockFlow({
      transitions: [
        {
          id: "t-gate2",
          flowId: "flow-1",
          fromState: "draft",
          toState: "review",
          trigger: "complete",
          gateId: "g-2",
          condition: null,
          priority: 0,
          spawnFlow: null,
          spawnTemplate: null,
          createdAt: null,
        },
      ],
    });
    deps.flows.get = async () => flowWithGate;
    deps.gates.get = async () => ({
      id: "g-2",
      name: "ci_passes",
      type: "command",
      command: "false",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    });
    deps.gates.resultsFor = async () => [];
    deps.invocations.fail = async (id, error) => mockInvocation({ id, error, failedAt: new Date() });

    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.gated).toBe(true);
    expect(data.gateName).toBe("ci_passes");
  });

  // Finding 1 (round 4): flow.report must clear gate_failures on successful transition
  it("flow.report clears gate_failures after successful transition", async () => {
    deps.entities.get = async () =>
      mockEntity({ artifacts: { gate_failures: [{ gateId: "g-1", failedAt: "2024-01-01" }], other: "preserved" } });
    const updateArtifactsCalls: Array<Record<string, unknown>> = [];
    deps.entities.updateArtifacts = async (_id, artifacts) => {
      updateArtifactsCalls.push(artifacts as Record<string, unknown>);
    };
    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    expect(result.isError).toBeUndefined();
    const clearCall = updateArtifactsCalls.find((a) => Array.isArray(a.gate_failures) && (a.gate_failures as unknown[]).length === 0);
    expect(clearCall).toBeDefined();
    expect(clearCall!.gate_failures).toBeInstanceOf(Array);
    expect(clearCall!.gate_failures).toHaveLength(0);
  });

  // Zod validation tests
  it("flow.claim rejects empty role", async () => {
    const result = await callTool("flow.claim", { worker_id: "wkr_test", role: "" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.claim rejects missing role", async () => {
    const result = await callTool("flow.claim", { worker_id: "wkr_test" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.claim accepts missing workerId (affinity is best-effort)", async () => {
    const result = await callTool("flow.claim", { role: "coder", flow: "test-flow" });
    expect(result.isError).toBeFalsy();
  });

  it("flow.get_prompt rejects missing entity_id", async () => {
    const result = await callTool("flow.get_prompt", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.report rejects missing signal", async () => {
    const result = await callTool("flow.report", { entity_id: "ent-1" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.report rejects empty entity_id", async () => {
    const result = await callTool("flow.report", { entity_id: "", signal: "done" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.fail rejects missing error", async () => {
    const result = await callTool("flow.fail", { entity_id: "ent-1" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.entity rejects missing id", async () => {
    const result = await callTool("query.entity", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.entities rejects missing flow", async () => {
    const result = await callTool("query.entities", { state: "draft" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.entities rejects invalid limit", async () => {
    const result = await callTool("query.entities", { flow: "test-flow", state: "draft", limit: 999 });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.invocations rejects missing entity_id", async () => {
    const result = await callTool("query.invocations", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.flow rejects missing name", async () => {
    const result = await callTool("query.flow", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  // WOP-1884: three distinct flow.report outcomes — continue, waiting, check_back

  it("flow.report returns next_action waiting when gate fails (not timeout)", async () => {
    const flowWithGate = mockFlow({
      transitions: [
        {
          id: "t-gate-fail",
          flowId: "flow-1",
          fromState: "draft",
          toState: "review",
          trigger: "complete",
          gateId: "g-fail",
          condition: null,
          priority: 0,
          spawnFlow: null,
          spawnTemplate: null,
          createdAt: null,
        },
      ],
    });
    deps.flows.get = async () => flowWithGate;
    deps.flows.getByName = async () => flowWithGate;
    deps.gates.get = async () => ({
      id: "g-fail",
      name: "always-fail",
      type: "command",
      command: "false",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    });
    deps.gates.resultsFor = async () => [];
    const noopEventEmitter = { emit: async () => {} };
    deps.engine = new Engine({
      entityRepo: deps.entities,
      flowRepo: deps.flows,
      invocationRepo: deps.invocations,
      gateRepo: deps.gates,
      transitionLogRepo: deps.transitions,
      adapters: new Map(),
      eventEmitter: noopEventEmitter,
    });

    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.next_action).toBe("waiting");
    expect(data.gated).toBe(true);
    expect(data.next_action).not.toBe("check_back");
  });

  it("flow.report returns next_action check_back when gate times out", async () => {
    // Mock engine.processSignal to simulate gate timeout
    const mockEngine = {
      processSignal: async () => ({
        gated: true,
        gateTimedOut: true,
        gateOutput: "Function gate timed out after 30000ms",
        gateName: "slow-gate",
        gatesPassed: [],
        terminal: false,
      }),
    } as unknown as Engine;
    deps.engine = mockEngine;

    let replacementCreated = false;
    deps.invocations.create = async () => {
      replacementCreated = true;
      return mockInvocation();
    };

    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(30000);
    expect(data.message).toContain("not an error");
    expect(data.message).toContain("flow.report");
    expect(replacementCreated).toBe(true);
    expect(data.gated).toBeUndefined();
  });

  it("flow.report returns next_action continue when gate passes (no gate on transition)", async () => {
    // Default mock has no gate — gate passes implicitly, entity transitions to review
    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.new_state).toBe("review");
    expect(["continue", "waiting", "completed"]).toContain(data.next_action);
    expect(data.next_action).not.toBe("check_back");
  });
});

describe("MCP integration: claim -> report -> verify", () => {
  it("full lifecycle: claim, report, verify state change", async () => {
    let currentState = "draft";

    const deps = createMockDeps();

    // Set up a flow with discipline "coder" for the integration test
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];

    deps.entities.get = async (id) => {
      if (id !== "ent-1") return null;
      return mockEntity({ state: currentState });
    };

    deps.entities.transition = async (_id, toState) => {
      currentState = toState;
      return mockEntity({ state: toState });
    };

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );

    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    // Step 1: Claim work
    const claimResult = await client.callTool({
      name: "flow.claim",
      arguments: { worker_id: "wkr_test", role: "coder", flow: "test-flow" },
    });
    const claimData = JSON.parse(
      (claimResult.content as Array<{ text: string }>)[0].text,
    );
    expect(claimData).toHaveProperty("entity_id");
    expect(claimData).toHaveProperty("prompt");

    // Step 2: Report completion
    const reportResult = await client.callTool({
      name: "flow.report",
      arguments: { entity_id: "ent-1", signal: "complete" },
    });
    const reportData = JSON.parse(
      (reportResult.content as Array<{ text: string }>)[0].text,
    );
    expect(reportData.new_state).toBe("review");

    // Step 3: Verify state changed
    expect(currentState).toBe("review");

    // Step 4: Query to confirm
    const queryResult = await client.callTool({
      name: "query.entity",
      arguments: { id: "ent-1" },
    });
    const queryData = JSON.parse(
      (queryResult.content as Array<{ text: string }>)[0].text,
    );
    expect(queryData.state).toBe("review");

    await client.close();
    await server.close();
  });
});

describe("flow.claim discipline routing (WOP-1890)", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  async function callClaim(args: Record<string, unknown>) {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: "flow.claim", arguments: args });
    await client.close();
    await server.close();
    return result;
  }

  function parseResult(result: { content: Array<{ text: string }> }) {
    return JSON.parse(result.content[0].text);
  }

  it("filters flows by discipline matching role", async () => {
    const engFlow = mockFlow({ id: "flow-eng", name: "feature-dev", discipline: "engineering" });
    const devopsFlow = mockFlow({ id: "flow-ops", name: "deploy", discipline: "devops" });
    deps.flows.list = async () => [engFlow, devopsFlow];
    deps.flows.listAll = async () => [engFlow, devopsFlow];
    const queriedFlowIds: string[] = [];
    deps.invocations.findUnclaimedByFlow = async (flowId) => {
      queriedFlowIds.push(flowId);
      if (flowId === "flow-eng") return [mockInvocation({ id: "inv-eng", entityId: "ent-eng" })];
      return [];
    };
    deps.entities.get = async (id) => mockEntity({ id, flowId: "flow-eng" });
    deps.invocations.claim = async (id) =>
      mockInvocation({ id, entityId: "ent-eng", claimedBy: "wkr_test", claimedAt: new Date() });

    const result = await callClaim({ worker_id: "wkr_test", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });

    expect(data).not.toBeNull();
    expect(queriedFlowIds).toContain("flow-eng");
    expect(queriedFlowIds).not.toContain("flow-ops");
  });

  it("engineering worker cannot claim devops flow entities", async () => {
    const devopsFlow = mockFlow({ id: "flow-ops", name: "deploy", discipline: "devops" });
    deps.flows.list = async () => [devopsFlow];
    deps.flows.listAll = async () => [devopsFlow];
    deps.invocations.findUnclaimedByFlow = async () => [mockInvocation()];

    const result = await callClaim({ worker_id: "wkr_eng", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data.next_action).toBe("check_back");
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  it("claims across all matching-discipline flows when flow param omitted", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "bugs", discipline: "engineering" });
    const flow2 = mockFlow({ id: "flow-2", name: "features", discipline: "engineering" });
    deps.flows.list = async () => [flow1, flow2];
    deps.flows.listAll = async () => [flow1, flow2];
    deps.invocations.findUnclaimedByFlow = async (flowId) => {
      if (flowId === "flow-2") return [mockInvocation({ id: "inv-f2", entityId: "ent-f2" })];
      return [];
    };
    deps.entities.get = async (id) => mockEntity({ id, flowId: "flow-2" });
    deps.invocations.claim = async (id) =>
      mockInvocation({ id, entityId: "ent-f2", claimedBy: "wkr_test", claimedAt: new Date() });

    const result = await callClaim({ worker_id: "wkr_test", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-f2");
  });

  it("selects higher-priority entity over lower-priority", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "eng-flow", discipline: "engineering" });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];

    const lowPriInv = mockInvocation({ id: "inv-low", entityId: "ent-low" });
    const highPriInv = mockInvocation({ id: "inv-high", entityId: "ent-high" });
    deps.invocations.findUnclaimedByFlow = async () => [lowPriInv, highPriInv];

    deps.entities.get = async (id) => {
      if (id === "ent-low") return mockEntity({ id: "ent-low", flowId: "flow-1", priority: 1 });
      if (id === "ent-high") return mockEntity({ id: "ent-high", flowId: "flow-1", priority: 5 });
      return null;
    };
    deps.invocations.claim = async (id) =>
      mockInvocation({ id, entityId: id === "inv-high" ? "ent-high" : "ent-low", claimedBy: "wkr_test", claimedAt: new Date() });

    const result = await callClaim({ worker_id: "wkr_test", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-high");
  });

  it("prefers entity with worker affinity over higher-priority entity", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "eng-flow", discipline: "engineering" });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];

    const affinityInv = mockInvocation({ id: "inv-affinity", entityId: "ent-affinity" });
    const highPriInv = mockInvocation({ id: "inv-high", entityId: "ent-high" });
    deps.invocations.findUnclaimedByFlow = async () => [affinityInv, highPriInv];

    deps.entities.get = async (id) => {
      if (id === "ent-affinity") return mockEntity({ id: "ent-affinity", flowId: "flow-1", priority: 1, updatedAt: new Date() });
      if (id === "ent-high") return mockEntity({ id: "ent-high", flowId: "flow-1", priority: 10, updatedAt: new Date() });
      return null;
    };

    deps.invocations.findByEntity = async (entityId) => {
      if (entityId === "ent-affinity") {
        return [mockInvocation({
          entityId: "ent-affinity",
          claimedBy: "wkr_test",
          completedAt: new Date(Date.now() - 60 * 1000), // 1 minute ago — within default 5-min affinity window
        })];
      }
      return [];
    };

    deps.invocations.claim = async (id) =>
      mockInvocation({ id, entityId: "ent-affinity", claimedBy: "wkr_test", claimedAt: new Date() });

    const result = await callClaim({ worker_id: "wkr_test", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-affinity");
  });

  it("selects entity waiting longest when priorities are equal", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "eng-flow", discipline: "engineering" });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];

    const recentInv = mockInvocation({ id: "inv-recent", entityId: "ent-recent" });
    const oldInv = mockInvocation({ id: "inv-old", entityId: "ent-old" });
    deps.invocations.findUnclaimedByFlow = async () => [recentInv, oldInv];

    deps.entities.get = async (id) => {
      if (id === "ent-recent") return mockEntity({ id: "ent-recent", flowId: "flow-1", priority: 3, createdAt: new Date(Date.now() - 5 * 60 * 1000), updatedAt: new Date(Date.now() - 5 * 60 * 1000) });
      if (id === "ent-old") return mockEntity({ id: "ent-old", flowId: "flow-1", priority: 3, createdAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date(Date.now() - 60 * 60 * 1000) });
      return null;
    };

    deps.invocations.claim = async (id) =>
      mockInvocation({ id, entityId: id === "inv-old" ? "ent-old" : "ent-recent", claimedBy: "wkr_test", claimedAt: new Date() });

    const result = await callClaim({ worker_id: "wkr_test", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-old");
  });

  it("returns check_back when no entities available for discipline", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "eng-flow", discipline: "engineering" });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.findByFlowAndState = async () => [];
    deps.entities.hasAnyInFlowAndState = async () => false;

    const result = await callClaim({ worker_id: "wkr_test", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000);
  });

  it("flow param validates discipline match and returns check_back on mismatch", async () => {
    const devopsFlow = mockFlow({ id: "flow-ops", name: "deploy", discipline: "devops" });
    deps.flows.getByName = async (name) => (name === "deploy" ? devopsFlow : null);

    const result = await callClaim({ worker_id: "wkr_eng", role: "engineering", flow: "deploy" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000);
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  it("returns check_back with 30s retry when entities exist but are all claimed", async () => {
    // Use role "coder" to match the default mockFlow state agentRole
    const flow1 = mockFlow({ id: "flow-1", name: "coder-flow", discipline: null });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    // Entities exist in the "draft" state whose agentRole is "coder"
    deps.entities.findByFlowAndState = async (_flowId, stateName) => {
      if (stateName === "draft") return [mockEntity({ id: "ent-claimed", claimedBy: "wkr_other" })];
      return [];
    };
    deps.entities.hasAnyInFlowAndState = async () => true;

    const result = await callClaim({ worker_id: "wkr_test", role: "coder" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(30000);
  });

  it("returns check_back with 300s retry when all entities are in terminal states (agentRole=null)", async () => {
    // Flow has a "done" state with agentRole=null. All entities are in that terminal state.
    // hasAnyInFlowAndState should only be called with claimable state names, not "done".
    // If terminal states were included, hasAnyInFlowAndState would return true → wrongly 30s retry.
    const flow1 = mockFlow({ id: "flow-1", name: "test-flow", discipline: null });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.findByFlowAndState = async () => [];
    // hasAnyInFlowAndState returns true only if "done" (terminal) is passed — should NOT be called with it
    deps.entities.hasAnyInFlowAndState = async (_flowId, stateNames) => {
      if (stateNames.includes("done")) return true; // would trigger wrong 30s if terminal states leak through
      return false;
    };

    const result = await callClaim({ worker_id: "wkr_test", role: "coder" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000); // 300s = empty backlog, not 30s
  });

  it("returns check_back with 30s retry when discipline-filtered flow has entities but discipline !== agentRole", async () => {
    // discipline "engineering" matches the flow; state.agentRole is "coder" (different from discipline)
    // The old code filtered states by agentRole === role, wrongly excluding all states → 300s
    // The correct code checks all states in candidateFlows → finds entities → 30s
    const flow1 = mockFlow({ id: "flow-1", name: "eng-flow", discipline: "engineering" });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.findByFlowAndState = async (_flowId, stateName) => {
      if (stateName === "draft") return [mockEntity({ id: "ent-eng", claimedBy: "wkr_other" })];
      return [];
    };
    deps.entities.hasAnyInFlowAndState = async () => true;

    const result = await callClaim({ worker_id: "wkr_eng", role: "engineering" });
    const data = parseResult(result as { content: Array<{ text: string }> });
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(30000);
  });
});

describe("admin.entity.create", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("creates an entity via engine.createEntity", async () => {
    const createdEntity = mockEntity({ id: "ent-new", state: "draft" });
    const mockEngine = {
      createEntity: async () => createdEntity,
    } as unknown as Engine;

    const testDeps: McpServerDeps = { ...deps, engine: mockEngine };
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "test-flow" });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe("ent-new");
    expect(data.flowId).toBe(createdEntity.flowId);
    expect(data.state).toBe("draft");
    // invocation_id included when an active invocation exists
    expect(data.invocation_id).toBe("inv-1");
  });

  it("passes refs to engine.createEntity", async () => {
    const createdEntity = mockEntity({ id: "ent-ref", state: "draft" });
    const refs = { linear: { adapter: "linear", id: "WOP-123" } };
    let capturedRefs: unknown;
    const mockEngine = {
      createEntity: async (_flowName: string, r: unknown) => {
        capturedRefs = r;
        return createdEntity;
      },
    } as unknown as Engine;

    const testDeps: McpServerDeps = { ...deps, engine: mockEngine };
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "test-flow", refs });

    expect(result.isError).toBeUndefined();
    expect(capturedRefs).toEqual(refs);
  });

  it("returns error when engine is not available", async () => {
    const testDeps: McpServerDeps = { ...deps, engine: undefined };
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "test-flow" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Engine not available");
  });

  it("returns error when flow does not exist", async () => {
    const mockEngine = {
      createEntity: async () => { throw new Error('Flow "nope" not found'); },
    } as unknown as Engine;

    const testDeps: McpServerDeps = { ...deps, engine: mockEngine };
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "nope" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns validation error when flow is missing", async () => {
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(deps, "admin.entity.create", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("requires admin token when configured", async () => {
    const { callToolHandler } = await import("../../src/execution/mcp-server.js");
    const result = await callToolHandler(
      deps,
      "admin.entity.create",
      { flow: "test-flow" },
      { adminToken: "secret-token", callerToken: "wrong-token" },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });
});
