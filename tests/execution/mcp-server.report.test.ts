import { describe, it, expect, beforeEach, vi } from "vitest";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import { Engine } from "../../src/engine/engine.js";
import {
  mockEntity,
  mockInvocation,
  mockFlow,
  createMockDeps,
  callTool,
} from "./helpers.js";

describe("flow.report and flow.get_prompt", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];
  });

  it("flow.get_prompt returns prompt and context", async () => {
    const result = await callTool(deps, "flow.get_prompt", { entity_id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("prompt");
    expect(data).toHaveProperty("context");
  });

  it("flow.get_prompt returns error for unknown entity", async () => {
    const result = await callTool(deps, "flow.get_prompt", { entity_id: "nope" });
    expect(result.isError).toBe(true);
  });

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
    const result = await callTool(deps, "flow.get_prompt", { entity_id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.prompt).toBe("Active prompt");
  });

  it("flow.get_prompt rejects missing entity_id", async () => {
    const result = await callTool(deps, "flow.get_prompt", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.report transitions entity and returns new state", async () => {
    const result = await callTool(deps, "flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.new_state).toBe("review");
    expect(["continue", "waiting", "completed", "check_back"]).toContain(data.next_action);
  });

  it("flow.report returns error for missing entity", async () => {
    const result = await callTool(deps, "flow.report", {
      entity_id: "nope",
      signal: "complete",
    });
    expect(result.isError).toBe(true);
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
    const result = await callTool(deps, "flow.report", {
      entity_id: "ent-1",
      signal: "nonexistent-signal",
    });
    expect(result.isError).toBe(true);
    expect(completeCalled).toBe(true);
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
    deps.flows.getAtVersion = async () => flowWithGate;
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
    const result = await callTool(deps, "flow.report", {
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
    deps.flows.getAtVersion = async () => flowWithGate;
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

    const result = await callTool(deps, "flow.report", {
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
    const result = await callTool(deps, "flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    expect(result.isError).toBeUndefined();
    const clearCall = updateArtifactsCalls.find((a) => Array.isArray(a.gate_failures) && (a.gate_failures as unknown[]).length === 0);
    expect(clearCall).toBeDefined();
    expect(clearCall!.gate_failures).toBeInstanceOf(Array);
    expect(clearCall!.gate_failures).toHaveLength(0);
  });

  it("flow.report rejects missing signal", async () => {
    const result = await callTool(deps, "flow.report", { entity_id: "ent-1" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("flow.report rejects empty entity_id", async () => {
    const result = await callTool(deps, "flow.report", { entity_id: "", signal: "done" });
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
    deps.flows.getAtVersion = async () => flowWithGate;
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

    const result = await callTool(deps, "flow.report", {
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

    const result = await callTool(deps, "flow.report", {
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
    const result = await callTool(deps, "flow.report", {
      entity_id: "ent-1",
      signal: "complete",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.new_state).toBe("review");
    expect(["continue", "waiting", "completed"]).toContain(data.next_action);
    expect(data.next_action).not.toBe("check_back");
  });

  it("flow.report returns error when engine is not available", async () => {
    const testDeps: McpServerDeps = { ...deps, engine: undefined as any };
    const result = await callToolHandler(testDeps, "flow.report", {
      entity_id: "ent-1",
      signal: "done",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Engine not available");
  });

  it("flow.report re-queues invocation when processSignal throws", async () => {
    const createMock = vi.fn().mockResolvedValue(mockInvocation());
    const testDeps: McpServerDeps = {
      ...deps,
      invocations: {
        ...deps.invocations,
        findByEntity: async () => [mockInvocation({ claimedAt: new Date(), completedAt: null, failedAt: null })],
        create: createMock,
      } as any,
      entities: {
        ...deps.entities,
        get: async (id: string) => (id === "ent-1" ? mockEntity({ state: "draft" }) : null),
      } as any,
      engine: {
        processSignal: vi.fn().mockRejectedValue(new Error("engine crash")),
      } as any,
    };
    const result = await callToolHandler(testDeps, "flow.report", {
      entity_id: "ent-1",
      signal: "done",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("engine crash");
    expect(createMock).toHaveBeenCalled();
  });

  it("flow.report sets affinity on passive completion with worker_id", async () => {
    const setAffinityMock = vi.fn().mockResolvedValue(undefined);
    const testDeps: McpServerDeps = {
      ...deps,
      entities: {
        ...deps.entities,
        get: async () => mockEntity({ flowId: "flow-1" }),
        setAffinity: setAffinityMock,
      } as any,
      flows: {
        ...deps.flows,
        get: async (id: string) => (id === "flow-1" ? mockFlow({ discipline: "engineering", affinityWindowMs: 600000 }) : null),
      } as any,
      invocations: {
        ...deps.invocations,
        findByEntity: async () => [mockInvocation({ mode: "passive", claimedAt: new Date(), completedAt: null, failedAt: null })],
        complete: async (id: string, signal: string, artifacts: unknown) =>
          mockInvocation({ id, signal, completedAt: new Date() }),
      } as any,
      engine: {
        processSignal: vi.fn().mockResolvedValue({
          gated: false,
          terminal: true,
          newState: "done",
          gatesPassed: [],
        }),
      } as any,
    };
    const result = await callToolHandler(testDeps, "flow.report", {
      entity_id: "ent-1",
      signal: "done",
      worker_id: "worker-42",
    });
    expect(result.isError).toBeUndefined();
    expect(setAffinityMock).toHaveBeenCalledWith(
      "ent-1",
      "worker-42",
      "engineering",
      expect.any(Date),
    );
  });

  it("flow.report affinity set failure is silently caught", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testDeps: McpServerDeps = {
      ...deps,
      entities: {
        ...deps.entities,
        get: async () => mockEntity({ flowId: "flow-1" }),
        setAffinity: async () => { throw new Error("affinity DB error"); },
      } as any,
      flows: {
        ...deps.flows,
        get: async (id: string) => (id === "flow-1" ? mockFlow({ discipline: "engineering" }) : null),
      } as any,
      invocations: {
        ...deps.invocations,
        findByEntity: async () => [mockInvocation({ mode: "passive", claimedAt: new Date(), completedAt: null, failedAt: null })],
        complete: async (id: string, signal: string, artifacts: unknown) =>
          mockInvocation({ id, signal, completedAt: new Date() }),
      } as any,
      engine: {
        processSignal: vi.fn().mockResolvedValue({
          gated: false,
          terminal: true,
          newState: "done",
          gatesPassed: [],
        }),
      } as any,
    };
    const result = await callToolHandler(testDeps, "flow.report", {
      entity_id: "ent-1",
      signal: "done",
      worker_id: "worker-42",
    });
    expect(result.isError).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to set affinity"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
