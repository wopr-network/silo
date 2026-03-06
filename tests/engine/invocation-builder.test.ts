import { describe, expect, it } from "vitest";
import { buildInvocation, hydrateGateCommand } from "../../src/engine/invocation-builder.js";
import type { Entity, State, Gate } from "../../src/repositories/interfaces.js";

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "e1",
    flowId: "f1",
    state: "review",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date(Date.now() - 10000),
    ...overrides,
  };
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    id: "s1",
    flowId: "f1",
    name: "review",
    agentRole: "reviewer",
    modelTier: "sonnet",
    mode: "passive",
    promptTemplate: "Review {{artifacts.diff}} as {{agent_role}}",
    constraints: null,
    ...overrides,
  };
}

describe("buildInvocation", () => {
  it("hydrates prompt template with artifacts and metadata", async () => {
    const entity = makeEntity({ artifacts: { diff: "file.ts +1 -1" } });
    const state = makeState();
    const result = await buildInvocation(entity, state, new Map());
    expect(result.prompt).toBe("Review file.ts +1 -1 as reviewer");
    expect(result.context.agent_role).toBe("reviewer");
    expect(result.context.artifacts).toEqual({ diff: "file.ts +1 -1" });
  });

  it("returns empty prompt when promptTemplate is null", async () => {
    const entity = makeEntity();
    const state = makeState({ promptTemplate: null });
    const result = await buildInvocation(entity, state, new Map());
    expect(result.prompt).toBe("");
  });

  it("resolves refs via adapters", async () => {
    const entity = makeEntity({
      refs: {
        issue: { adapter: "linear", id: "ISS-1" },
        pr: { adapter: "github", id: "42" },
      },
    });
    const state = makeState({ promptTemplate: "Issue: {{refs.issue.title}}" });
    const adapters = new Map<string, { get: (id: string) => Promise<unknown> }>([
      ["linear", { get: async (id: string) => ({ id, title: "Fix bug" }) }],
      ["github", { get: async (id: string) => ({ id, number: 42 }) }],
    ]);
    const result = await buildInvocation(entity, state, adapters);
    expect(result.prompt).toBe("Issue: Fix bug");
    expect(result.context.refs.issue.title).toBe("Fix bug");
    expect(result.context.refs.pr.number).toBe(42);
  });

  it("skips refs when entity.refs is null", async () => {
    const entity = makeEntity({ refs: null });
    const state = makeState({ promptTemplate: "No refs" });
    const result = await buildInvocation(entity, state, new Map());
    expect(result.prompt).toBe("No refs");
    expect(result.context.refs).toEqual({});
  });

  it("skips ref when adapter not found in map", async () => {
    const entity = makeEntity({
      refs: { issue: { adapter: "missing", id: "1" } },
    });
    const state = makeState({ promptTemplate: "ok" });
    const result = await buildInvocation(entity, state, new Map());
    expect(result.context.refs).toEqual({});
  });

  it("skips ref when adapter.get throws", async () => {
    const entity = makeEntity({
      refs: { issue: { adapter: "broken", id: "1" } },
    });
    const adapters = new Map<string, { get: (id: string) => Promise<unknown> }>([
      ["broken", { get: async () => { throw new Error("fail"); } }],
    ]);
    const state = makeState({ promptTemplate: "ok" });
    const result = await buildInvocation(entity, state, new Map(adapters));
    expect(result.context.refs).toEqual({});
  });

  it("includes pipeline metadata in context", async () => {
    const entity = makeEntity({ artifacts: { spec: "data" } });
    const state = makeState({ agentRole: "coder" });
    const invocations = [
      { stage: "review" },
      { stage: "review" },
      { stage: "build" },
    ];
    const result = await buildInvocation(entity, state, new Map(), invocations);
    expect(result.context.agent_role).toBe("coder");
    expect(result.context.invocation_count).toBe(2); // "review" stage matches state.name
    expect(result.context.total_invocations).toBe(3);
    expect(typeof result.context.time_in_state).toBe("number");
    expect(result.context.time_in_state).toBeGreaterThanOrEqual(9000);
  });

  it("defaults invocations to empty array", async () => {
    const entity = makeEntity();
    const state = makeState();
    const result = await buildInvocation(entity, state, new Map());
    expect(result.context.invocation_count).toBe(0);
    expect(result.context.total_invocations).toBe(0);
  });

  it("includes entity in context for Handlebars helpers", async () => {
    const entity = makeEntity({
      artifacts: { diff: "x" },
    });
    const state = makeState({
      promptTemplate: '{{#if (has_artifact entity "diff")}}HAS_DIFF{{/if}}',
    });
    const result = await buildInvocation(entity, state, new Map());
    expect(result.prompt).toBe("HAS_DIFF");
  });
});

describe("hydrateGateCommand", () => {
  it("hydrates a gate command template with context", () => {
    const gate: Gate = {
      id: "g1",
      name: "lint",
      type: "command",
      command: "cd {{workdir}} && pnpm lint",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    };
    const result = hydrateGateCommand(gate, { workdir: "/tmp/repo" });
    expect(result).toBe("cd /tmp/repo && pnpm lint");
  });

  it("returns empty string when gate.command is null", () => {
    const gate: Gate = {
      id: "g1",
      name: "fn-gate",
      type: "function",
      command: null,
      functionRef: "checkLint",
      apiConfig: null,
      timeoutMs: 30000,
    };
    expect(hydrateGateCommand(gate, {})).toBe("");
  });

  it("leaves template vars unresolved when not in context", () => {
    const gate: Gate = {
      id: "g1",
      name: "test",
      type: "command",
      command: "run {{missing}}",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    };
    expect(hydrateGateCommand(gate, {})).toBe("run ");
  });
});
