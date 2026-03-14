import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMcpServer, callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import { Engine } from "../../src/engine/engine.js";
import {
  mockEntity,
  mockFlow,
  createMockDeps,
  listTools,
} from "./helpers.js";

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

describe("MCP tool listing", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];
  });

  it("lists all 34 tools", async () => {
    const result = await listTools(deps);
    expect(result.tools).toHaveLength(34);
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "admin.entity.cancel",
      "admin.entity.create",
      "admin.entity.migrate",
      "admin.entity.reset",
      "admin.events.list",
      "admin.flow.create",
      "admin.flow.pause",
      "admin.flow.restore",
      "admin.flow.resume",
      "admin.flow.snapshot",
      "admin.flow.update",
      "admin.gate.attach",
      "admin.gate.create",
      "admin.gate.rerun",
      "admin.integration.create",
      "admin.integration.delete",
      "admin.integration.get",
      "admin.integration.list",
      "admin.integration.update",
      "admin.state.create",
      "admin.state.update",
      "admin.transition.create",
      "admin.transition.update",
      "admin.worker.drain",
      "admin.worker.undrain",
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
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "test-flow", refs });

    expect(result.isError).toBeUndefined();
    expect(capturedRefs).toEqual(refs);
  });

  it("returns error when engine is not available", async () => {
    const testDeps: McpServerDeps = { ...deps, engine: undefined };
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "test-flow" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Engine not available");
  });

  it("returns error when flow does not exist", async () => {
    const mockEngine = {
      createEntity: async () => { throw new Error('Flow "nope" not found'); },
    } as unknown as Engine;

    const testDeps: McpServerDeps = { ...deps, engine: mockEngine };
    const result = await callToolHandler(testDeps, "admin.entity.create", { flow: "nope" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns validation error when flow is missing", async () => {
    const result = await callToolHandler(deps, "admin.entity.create", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("requires admin token when configured", async () => {
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

describe("admin tool handlers — direct callToolHandler", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("returns error for unknown tool name", async () => {
    const result = await callToolHandler(deps, "nonexistent.tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool: nonexistent.tool");
  });

  // admin.flow.create
  it("admin.flow.create creates flow with matching initialState", async () => {
    const createSpy = vi.spyOn(deps.flows, "create");
    const result = await callToolHandler(deps, "admin.flow.create", {
      name: "new-flow",
      initialState: "draft",
      states: [{ name: "draft", mode: "passive", promptTemplate: "do work" }, { name: "done", mode: "passive" }],
    });
    expect(result.isError).not.toBe(true);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "new-flow", initialState: "draft" }));
  });

  it("admin.flow.create rejects when initialState not in states", async () => {
    const result = await callToolHandler(deps, "admin.flow.create", {
      name: "new-flow",
      initialState: "missing",
      states: [{ name: "draft", mode: "passive", promptTemplate: "do work" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("initialState 'missing' must be included");
  });

  // admin.flow.update
  it("admin.flow.update updates flow metadata", async () => {
    const result = await callToolHandler(deps, "admin.flow.update", {
      flow_name: "test-flow",
      description: "updated description",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.flow.update returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.flow.update", {
      flow_name: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  // admin.state.create
  it("admin.state.create adds state to flow", async () => {
    const result = await callToolHandler(deps, "admin.state.create", {
      flow_name: "test-flow",
      name: "new-state",
      mode: "passive",
      promptTemplate: "do stuff",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.state.create returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.state.create", {
      flow_name: "nonexistent",
      name: "s1",
      mode: "passive",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  // admin.state.update
  it("admin.state.update updates existing state", async () => {
    const result = await callToolHandler(deps, "admin.state.update", {
      flow_name: "test-flow",
      state_name: "draft",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.state.update returns error for unknown state", async () => {
    const result = await callToolHandler(deps, "admin.state.update", {
      flow_name: "test-flow",
      state_name: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("State not found");
  });

  it("admin.state.update returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.state.update", {
      flow_name: "nonexistent",
      state_name: "draft",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  // admin.transition.create
  it("admin.transition.create adds transition between valid states", async () => {
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "draft",
      toState: "review",
      trigger: "submit",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.transition.create with gateName resolves gate", async () => {
    deps.gates = {
      ...deps.gates,
      getByName: async () => ({
        id: "g-lint",
        name: "lint",
        type: "command",
        command: "pnpm lint",
        functionRef: null,
        apiConfig: null,
        timeoutMs: 30000,
      }),
    } as any;
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "draft",
      toState: "review",
      trigger: "submit",
      gateName: "lint",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.transition.create returns error for unknown fromState", async () => {
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "nonexistent",
      toState: "review",
      trigger: "submit",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("State not found: 'nonexistent'");
  });

  it("admin.transition.create returns error for unknown toState", async () => {
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "draft",
      toState: "nonexistent",
      trigger: "submit",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("State not found: 'nonexistent'");
  });

  it("admin.transition.create returns error for unknown gate", async () => {
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "draft",
      toState: "review",
      trigger: "submit",
      gateName: "nonexistent-gate",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Gate not found: nonexistent-gate");
  });

  it("admin.transition.create returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "nonexistent",
      fromState: "draft",
      toState: "review",
      trigger: "submit",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  // admin.transition.update
  it("admin.transition.update updates transition", async () => {
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "t1",
      trigger: "new-trigger",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.transition.update returns error for unknown transition", async () => {
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Transition not found");
  });

  it("admin.transition.update returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "nonexistent",
      transition_id: "t1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  it("admin.transition.update validates fromState exists", async () => {
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "t1",
      fromState: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("State not found: 'nonexistent'");
  });

  it("admin.transition.update validates toState exists", async () => {
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "t1",
      toState: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("State not found: 'nonexistent'");
  });

  it("admin.transition.update with gateName resolves gate id", async () => {
    deps.gates = {
      ...deps.gates,
      getByName: async () => ({
        id: "g-lint",
        name: "lint",
        type: "command",
        command: "pnpm lint",
        functionRef: null,
        apiConfig: null,
        timeoutMs: 30000,
      }),
    } as any;
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "t1",
      gateName: "lint",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.transition.update with no gateName passes through unchanged", async () => {
    const updateTransitionSpy = vi.fn().mockResolvedValue(mockFlow().transitions[0]);
    deps.flows = { ...deps.flows, updateTransition: updateTransitionSpy } as any;
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "t1",
    });
    expect(result.isError).toBeUndefined();
    expect(updateTransitionSpy).toHaveBeenCalledWith("t1", {});
  });

  it("admin.transition.update with unknown gateName returns error", async () => {
    const result = await callToolHandler(deps, "admin.transition.update", {
      flow_name: "test-flow",
      transition_id: "t1",
      gateName: "nonexistent-gate",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Gate not found: nonexistent-gate");
  });

  // admin.gate.create
  it("admin.gate.create creates a gate", async () => {
    const result = await callToolHandler(deps, "admin.gate.create", {
      name: "ci-check",
      type: "command",
      command: "gates/ci-check.sh",
    });
    expect(result.isError).toBeUndefined();
  });

  // admin.gate.attach
  it("admin.gate.attach attaches gate to transition", async () => {
    deps.gates = {
      ...deps.gates,
      getByName: async () => ({
        id: "g-lint",
        name: "lint",
        type: "command",
        command: "pnpm lint",
        functionRef: null,
        apiConfig: null,
        timeoutMs: 30000,
      }),
    } as any;
    const result = await callToolHandler(deps, "admin.gate.attach", {
      flow_name: "test-flow",
      transition_id: "t1",
      gate_name: "lint",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.gate.attach returns error for unknown transition", async () => {
    deps.gates = {
      ...deps.gates,
      getByName: async () => ({
        id: "g-lint",
        name: "lint",
        type: "command",
        command: "pnpm lint",
        functionRef: null,
        apiConfig: null,
        timeoutMs: 30000,
      }),
    } as any;
    const result = await callToolHandler(deps, "admin.gate.attach", {
      flow_name: "test-flow",
      transition_id: "nonexistent",
      gate_name: "lint",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Transition not found");
  });

  it("admin.gate.attach returns error for unknown gate", async () => {
    const result = await callToolHandler(deps, "admin.gate.attach", {
      flow_name: "test-flow",
      transition_id: "t1",
      gate_name: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Gate not found: nonexistent");
  });

  it("admin.gate.attach returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.gate.attach", {
      flow_name: "nonexistent",
      transition_id: "t1",
      gate_name: "lint",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  // admin.flow.snapshot
  it("admin.flow.snapshot creates snapshot", async () => {
    const result = await callToolHandler(deps, "admin.flow.snapshot", {
      flow_name: "test-flow",
    });
    expect(result.isError).toBeUndefined();
  });

  it("admin.flow.snapshot returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.flow.snapshot", {
      flow_name: "nonexistent",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });

  // admin.flow.restore
  it("admin.flow.restore restores to version", async () => {
    deps.invocations = { ...deps.invocations, countActiveByFlow: async () => 0 } as any;
    const result = await callToolHandler(deps, "admin.flow.restore", {
      flow_name: "test-flow",
      version: 1,
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.restored).toBe(true);
    expect(data.version).toBe(1);
  });

  it("admin.flow.restore returns error for unknown flow", async () => {
    const result = await callToolHandler(deps, "admin.flow.restore", {
      flow_name: "nonexistent",
      version: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Flow not found: nonexistent");
  });
});
