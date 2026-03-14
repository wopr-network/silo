import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMcpServer, callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import { Engine } from "../../src/engine/engine.js";
import {
  mockEntity,
  mockInvocation,
  mockFlow,
  createMockDeps,
  callTool,
} from "./helpers.js";

describe("flow.claim", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];
  });

  it("flow.claim returns invocation when work available", async () => {
    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test", role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("entity_id");
    expect(data).toHaveProperty("invocation_id");
    expect(data).toHaveProperty("state");
    expect(data).toHaveProperty("refs");
    expect(data).toHaveProperty("artifacts");
  });

  it("flow.claim returns structured check_back when no work available (empty backlog)", async () => {
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.findByFlowAndState = async () => [];
    deps.entities.hasAnyInFlowAndState = async () => false;
    deps.entities.claim = async () => null; // no fallback entity either
    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test", role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000);
    expect(data.message).toContain("No work available");
  });

  it("flow.claim returns check_back for unknown flow", async () => {
    const result = await callTool(deps, "flow.claim", {
      worker_id: "wkr_test",
      role: "coder",
      flow: "nonexistent",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).toBe(true);
    expect(content[0].text).toContain("not found");
  });

  it("flow.claim without flow param searches all flows", async () => {
    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test", role: "coder" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    // Should find work via list() rather than returning an error
    expect(result.isError).toBeUndefined();
    expect(data).toHaveProperty("entity_id");
  });

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
    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test", role: "coder", flow: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).not.toBeNull();
    expect(data.invocation_id).toBe("inv-2");
    expect(callCount).toBe(2);
  });

  it("flow.claim accepts missing workerId (affinity is best-effort)", async () => {
    const result = await callTool(deps, "flow.claim", { role: "coder", flow: "test-flow" });
    expect(result.isError).toBeFalsy();
  });

  it("flow.claim rejects empty role", async () => {
    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test", role: "" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.claim rejects missing role", async () => {
    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.claim continues to next candidate when claim throws", async () => {
    let callCount = 0;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testInvocations = {
      ...deps.invocations,
      findUnclaimedByFlow: async () => [
        mockInvocation({ id: "inv-1" }),
        mockInvocation({ id: "inv-2" }),
      ],
      claim: async (id: string) => {
        callCount++;
        if (callCount === 1) throw new Error("DB error");
        return mockInvocation({ id, claimedBy: "coder", claimedAt: new Date() });
      },
    } as any;
    const testEngine = new Engine({
      entityRepo: deps.entities,
      flowRepo: deps.flows,
      invocationRepo: testInvocations,
      gateRepo: deps.gates,
      transitionLogRepo: deps.transitions,
      adapters: new Map(),
      eventEmitter: { emit: async () => {} },
    });
    const testDeps: McpServerDeps = { ...deps, invocations: testInvocations, engine: testEngine };
    const result = await callToolHandler(testDeps, "flow.claim", { role: "coder" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.invocation_id).toBe("inv-2");
    errorSpy.mockRestore();
  });

  it("flow.claim releases entity when invocationRepo.claim returns null (race)", async () => {
    const releaseEntityMock = vi.fn().mockResolvedValue(undefined);
    const testEntities = {
      ...deps.entities,
      claimById: async (id: string) => mockEntity({ id, claimedBy: "agent:coder" }),
      get: async () => mockEntity(),
      release: releaseEntityMock,
    } as any;
    const testInvocations = {
      ...deps.invocations,
      findUnclaimedByFlow: async () => [mockInvocation({ id: "inv-1" })],
      claim: async () => null,
    } as any;
    const testEngine = new Engine({
      entityRepo: testEntities,
      flowRepo: deps.flows,
      invocationRepo: testInvocations,
      gateRepo: deps.gates,
      transitionLogRepo: deps.transitions,
      adapters: new Map(),
      eventEmitter: { emit: async () => {} },
    });
    const testDeps: McpServerDeps = { ...deps, entities: testEntities, invocations: testInvocations, engine: testEngine };
    await callToolHandler(testDeps, "flow.claim", { role: "coder" });
    expect(releaseEntityMock).toHaveBeenCalled();
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
    expect(claimData).toHaveProperty("state");
    expect(claimData).toHaveProperty("refs");
    expect(claimData).toHaveProperty("artifacts");

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

    const result = await callTool(deps, "flow.claim", { worker_id: "wkr_test", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(data).not.toBeNull();
    expect(queriedFlowIds).toContain("flow-eng");
    expect(queriedFlowIds).not.toContain("flow-ops");
  });

  it("engineering worker cannot claim devops flow entities", async () => {
    const devopsFlow = mockFlow({ id: "flow-ops", name: "deploy", discipline: "devops" });
    deps.flows.list = async () => [devopsFlow];
    deps.flows.listAll = async () => [devopsFlow];
    deps.invocations.findUnclaimedByFlow = async () => [mockInvocation()];

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_eng", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
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

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
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

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
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

    // Engine uses findUnclaimedWithAffinity for affinity detection
    deps.invocations.findUnclaimedWithAffinity = async (flowId, _role, _workerId) => {
      if (flowId === "flow-1") return [mockInvocation({ id: "inv-affinity", entityId: "ent-affinity" })];
      return [];
    };

    deps.invocations.claim = async (id) =>
      mockInvocation({ id, entityId: id === "inv-affinity" ? "ent-affinity" : "ent-high", claimedBy: "wkr_test", claimedAt: new Date() });

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
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

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
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
    deps.entities.claim = async () => null;

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000);
  });

  it("flow param validates discipline match and returns check_back on mismatch", async () => {
    const devopsFlow = mockFlow({ id: "flow-ops", name: "deploy", discipline: "devops" });
    deps.flows.getByName = async (name) => (name === "deploy" ? devopsFlow : null);

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_eng", role: "engineering", flow: "deploy" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(300000);
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  it("returns check_back with short retry when entities exist but are all claimed", async () => {
    // Use role "coder" to match the default mockFlow state agentRole
    const flow1 = mockFlow({ id: "flow-1", name: "coder-flow", discipline: null });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.claim = async () => null; // all entities already claimed
    deps.entities.claimById = async () => null;
    deps.entities.hasAnyInFlowAndState = async () => true; // entities exist but all claimed

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "coder" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBe(30000); // short retry: work exists but all busy
  });

  it("returns check_back when all entities are in terminal states", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "test-flow", discipline: null });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.claim = async () => null; // no claimable entities
    deps.entities.claimById = async () => null;

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_test", role: "coder" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(data.next_action).toBe("check_back");
  });

  it("returns check_back when discipline-filtered flow has no claimable entities", async () => {
    const flow1 = mockFlow({ id: "flow-1", name: "eng-flow", discipline: "engineering" });
    deps.flows.list = async () => [flow1];
    deps.flows.listAll = async () => [flow1];
    deps.invocations.findUnclaimedByFlow = async () => [];
    deps.entities.claim = async () => null; // all claimed by others
    deps.entities.claimById = async () => null;

    const result = await callTool(deps, "flow.claim",{ worker_id: "wkr_eng", role: "engineering" });
    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(data.next_action).toBe("check_back");
  });
});
