import { describe, it, expect, beforeEach } from "vitest";
import { createMcpServer } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import type {
  Entity,
  Flow,
  Invocation,
  IEntityRepository,
  IEventRepository,
  IFlowRepository,
  IGateRepository,
  IIntegrationRepository,
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
    agentRole: "coder",
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
    createdAt: null,
    updatedAt: null,
    states: [
      {
        id: "s1",
        flowId: "flow-1",
        name: "draft",
        agentRole: "coder",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Do the work",
        constraints: null,
      },
      {
        id: "s2",
        flowId: "flow-1",
        name: "review",
        agentRole: "reviewer",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Review the work",
        constraints: null,
      },
      {
        id: "s3",
        flowId: "flow-1",
        name: "done",
        agentRole: null,
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
    transition: async (_id, toState) => mockEntity({ state: toState }),
    updateArtifacts: async () => {},
    claim: async () => mockEntity({ claimedBy: "agent-1" }),
    reapExpired: async () => [],
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

  const integrationRepo: IIntegrationRepository = {
    set: async (capability, adapter, config) => ({ capability, adapter, config: config ?? null }),
  };

  return { entities, flows, invocations, gates, transitions, eventRepo, integrationRepo };
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
  });
});

describe("MCP tool handlers", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
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

  it("lists all 19 tools", async () => {
    const result = await listTools();
    expect(result.tools).toHaveLength(19);
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "admin.flow.create",
      "admin.flow.restore",
      "admin.flow.snapshot",
      "admin.flow.update",
      "admin.gate.attach",
      "admin.gate.create",
      "admin.integration.set",
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
      "query.invocations",
    ]);
  });

  it("flow.claim returns invocation when work available", async () => {
    const result = await callTool("flow.claim", { role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("entity_id");
    expect(data).toHaveProperty("invocation_id");
    expect(data).toHaveProperty("prompt");
  });

  it("flow.claim returns null when no work available", async () => {
    deps.invocations.findUnclaimed = async () => [];
    const result = await callTool("flow.claim", { role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toBeNull();
  });

  it("flow.claim returns error for unknown flow", async () => {
    const result = await callTool("flow.claim", {
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
    expect(data.next_action).toBeDefined();
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

  // Finding 1: flow.report must validate transition before completing invocation
  it("flow.report returns error (not completing invocation) when signal has no matching transition", async () => {
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
    expect(completeCalled).toBe(false);
  });

  // Finding 2: flow.claim with no flow searches all flows
  it("flow.claim without flow param searches all flows", async () => {
    const result = await callTool("flow.claim", { role: "coder" });
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
    const inv1 = mockInvocation({ id: "inv-1" });
    const inv2 = mockInvocation({ id: "inv-2" });
    deps.invocations.findUnclaimed = async () => [inv1, inv2];
    let callCount = 0;
    deps.invocations.claim = async (id, role) => {
      callCount++;
      if (id === "inv-1") return null; // lost the race on first candidate
      return mockInvocation({ id, claimedBy: role, claimedAt: new Date() });
    };
    const result = await callTool("flow.claim", { role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-2");
    expect(callCount).toBe(2);
  });

  // Finding 5: gates must not be auto-passed
  it("flow.report returns error when transition has a gate (no auto-pass)", async () => {
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
    deps.gates.get = async () => ({
      id: "g-1",
      name: "lint-gate",
      type: "command",
      command: "pnpm lint",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    });
    let gateRecorded = false;
    deps.gates.record = async (entityId, gateId, passed, output) => {
      gateRecorded = true;
      return { id: "gr-1", entityId, gateId, passed, output, evaluatedAt: new Date() };
    };
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
    const result = await callTool("flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    // Gate block now returns structured JSON (not an error), but still fails invocation
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.gated).toBe(true);
    expect(data.gateName).toBe("lint-gate");
    expect(gateRecorded).toBe(false);
    // Gate blocked BEFORE complete — invocation must be failed (not completed) so entity can be reclaimed
    expect(failCalled).toBe(true);
    expect(completeCalled).toBe(false);
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
      command: "gh pr checks",
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
  });

  // Finding 6: limit param is clamped
  it("query.entities clamps limit to valid range", async () => {
    let capturedLimit = 0;
    const allEntities = Array.from({ length: 300 }, (_, i) => mockEntity({ id: `ent-${i}` }));
    deps.entities.findByFlowAndState = async () => allEntities;
    // Requesting limit=999 should be clamped to 250
    const result = await callTool("query.entities", {
      flow: "test-flow",
      state: "draft",
      limit: 999,
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.length).toBe(100);
  });
});

describe("MCP integration: claim -> report -> verify", () => {
  it("full lifecycle: claim, report, verify state change", async () => {
    let currentState = "draft";

    const deps = createMockDeps();

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
      arguments: { role: "coder", flow: "test-flow" },
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
