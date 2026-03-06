import { describe, expect, it } from "vitest";
import { evaluateCondition, findTransition, isTerminal, validateFlow } from "../../src/engine/state-machine.js";
import type { Flow, Transition } from "../../src/repositories/interfaces.js";

// ─── evaluateCondition ───

describe("evaluateCondition", () => {
  it("returns true for non-empty truthy result", () => {
    expect(evaluateCondition("yes", {})).toBe(true);
  });

  it("returns false for empty string result", () => {
    expect(evaluateCondition("", {})).toBe(false);
  });

  it("returns false for literal 'false'", () => {
    expect(evaluateCondition("false", {})).toBe(false);
  });

  it("returns false for whitespace-only result", () => {
    expect(evaluateCondition("   ", {})).toBe(false);
  });

  it("evaluates Handlebars expressions against context", () => {
    expect(evaluateCondition("{{name}}", { name: "hello" })).toBe(true);
    expect(evaluateCondition("{{missing}}", {})).toBe(false);
  });

  it("returns false on invalid template", () => {
    expect(evaluateCondition("{{#if}}", {})).toBe(false);
  });

  it("gt helper works", () => {
    expect(evaluateCondition("{{gt count 5}}", { count: 10 })).toBe(true);
    expect(evaluateCondition("{{gt count 5}}", { count: 3 })).toBe(false);
  });

  it("lt helper works", () => {
    expect(evaluateCondition("{{lt count 5}}", { count: 3 })).toBe(true);
    expect(evaluateCondition("{{lt count 5}}", { count: 10 })).toBe(false);
  });

  it("eq helper works", () => {
    expect(evaluateCondition('{{eq status "active"}}', { status: "active" })).toBe(true);
    expect(evaluateCondition('{{eq status "active"}}', { status: "done" })).toBe(false);
  });

  it("invocation_count helper works", () => {
    const ctx = {
      entity: {
        invocations: [{ stage: "review" }, { stage: "review" }, { stage: "build" }],
      },
    };
    expect(evaluateCondition('{{invocation_count entity "review"}}', ctx)).toBe(true);
  });

  it("invocation_count returns 0 is treated as falsy", () => {
    const ctx = {
      entity: {
        invocations: [{ stage: "build" }],
      },
    };
    expect(evaluateCondition('{{invocation_count entity "review"}}', ctx)).toBe(false);
  });

  it("gate_passed helper works", () => {
    const ctx = {
      entity: {
        gateResults: [
          { gate: "lint", passed: true },
          { gate: "test", passed: false },
        ],
      },
    };
    expect(evaluateCondition('{{gate_passed entity "lint"}}', ctx)).toBe(true);
    expect(evaluateCondition('{{gate_passed entity "test"}}', ctx)).toBe(false);
  });

  it("has_artifact helper works", () => {
    const ctx = {
      entity: { artifacts: { diff: "some-diff" } },
    };
    expect(evaluateCondition('{{has_artifact entity "diff"}}', ctx)).toBe(true);
    expect(evaluateCondition('{{has_artifact entity "missing"}}', ctx)).toBe(false);
  });

  it("time_in_state helper returns a number", () => {
    const ctx = {
      entity: { updatedAt: new Date(Date.now() - 60000).toISOString() },
    };
    expect(evaluateCondition("{{time_in_state entity}}", ctx)).toBe(true);
  });
});

// ─── findTransition ───

function makeFlow(
  overrides: {
    states?: { name: string }[];
    transitions?: Partial<Transition>[];
    initialState?: string;
  } = {},
): Flow {
  const states = (overrides.states ?? [{ name: "open" }, { name: "closed" }]).map((s, i) => ({
    id: `s${i}`,
    flowId: "f1",
    name: s.name,
    agentRole: null,
    modelTier: null,
    mode: "passive" as const,
    promptTemplate: null,
    constraints: null,
  }));
  const transitions = (overrides.transitions ?? []).map((t, i) => ({
    id: `t${i}`,
    flowId: "f1",
    fromState: t.fromState ?? "open",
    toState: t.toState ?? "closed",
    trigger: t.trigger ?? "done",
    gateId: t.gateId ?? null,
    condition: t.condition ?? null,
    priority: t.priority ?? 0,
    spawnFlow: t.spawnFlow ?? null,
    spawnTemplate: t.spawnTemplate ?? null,
    createdAt: null,
  }));
  return {
    id: "f1",
    name: "test-flow",
    description: null,
    entitySchema: null,
    initialState: overrides.initialState ?? "open",
    maxConcurrent: 0,
    maxConcurrentPerRepo: 0,
    version: 1,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    states,
    transitions,
  };
}

describe("findTransition", () => {
  it("matches state + signal", () => {
    const flow = makeFlow({
      transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
    });
    const result = findTransition(flow, "open", "done", {});
    expect(result).not.toBeNull();
    expect(result!.toState).toBe("closed");
  });

  it("returns null when no match", () => {
    const flow = makeFlow({
      transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
    });
    expect(findTransition(flow, "open", "unknown_signal", {})).toBeNull();
    expect(findTransition(flow, "wrong_state", "done", {})).toBeNull();
  });

  it("respects priority ordering (higher first)", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "fast" }, { name: "slow" }],
      transitions: [
        { fromState: "open", toState: "slow", trigger: "go", priority: 1 },
        { fromState: "open", toState: "fast", trigger: "go", priority: 10 },
      ],
    });
    const result = findTransition(flow, "open", "go", {});
    expect(result!.toState).toBe("fast");
  });

  it("evaluates conditions — picks first truthy", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "a" }, { name: "b" }],
      transitions: [
        { fromState: "open", toState: "a", trigger: "go", priority: 10, condition: '{{eq status "ready"}}' },
        { fromState: "open", toState: "b", trigger: "go", priority: 5 },
      ],
    });
    expect(findTransition(flow, "open", "go", { status: "ready" })!.toState).toBe("a");
    expect(findTransition(flow, "open", "go", { status: "nope" })!.toState).toBe("b");
  });

  it("null condition means unconditional", () => {
    const flow = makeFlow({
      transitions: [{ fromState: "open", toState: "closed", trigger: "done", condition: null }],
    });
    expect(findTransition(flow, "open", "done", {})!.toState).toBe("closed");
  });

  it("skips transition if gateId is set and gate has not passed", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "gated" }, { name: "fallback" }],
      transitions: [
        { fromState: "open", toState: "gated", trigger: "go", priority: 10, gateId: "lint" },
        { fromState: "open", toState: "fallback", trigger: "go", priority: 0 },
      ],
    });
    const ctxNoGate = { entity: { gateResults: [] } };
    expect(findTransition(flow, "open", "go", ctxNoGate)!.toState).toBe("fallback");

    const ctxGatePassed = { entity: { gateResults: [{ gate: "lint", passed: true }] } };
    expect(findTransition(flow, "open", "go", ctxGatePassed)!.toState).toBe("gated");
  });

  it("stuck detection pattern — invocation_count > 3", () => {
    const flow = makeFlow({
      states: [{ name: "review" }, { name: "done" }, { name: "stuck" }],
      transitions: [
        {
          fromState: "review",
          toState: "stuck",
          trigger: "signal",
          priority: 10,
          condition: '{{#if (gt (invocation_count entity "review") 3)}}true{{/if}}',
        },
        { fromState: "review", toState: "done", trigger: "signal", priority: 0 },
      ],
    });
    const ctxOk = { entity: { invocations: [{ stage: "review" }, { stage: "review" }] } };
    expect(findTransition(flow, "review", "signal", ctxOk)!.toState).toBe("done");

    const ctxStuck = {
      entity: {
        invocations: [
          { stage: "review" },
          { stage: "review" },
          { stage: "review" },
          { stage: "review" },
        ],
      },
    };
    expect(findTransition(flow, "review", "signal", ctxStuck)!.toState).toBe("stuck");
  });
});

// ─── validateFlow ───

describe("validateFlow", () => {
  it("returns no errors for a valid flow", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "closed" }],
      transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
      initialState: "open",
    });
    expect(validateFlow(flow)).toEqual([]);
  });

  it("errors if initialState is not in states array", () => {
    const flow = makeFlow({
      states: [{ name: "open" }],
      transitions: [],
      initialState: "nonexistent",
    });
    const errors = validateFlow(flow);
    expect(errors.some((e) => e.message.includes("initialState"))).toBe(true);
  });

  it("errors for transitions to non-existent states", () => {
    const flow = makeFlow({
      states: [{ name: "open" }],
      transitions: [{ fromState: "open", toState: "ghost", trigger: "go" }],
      initialState: "open",
    });
    const errors = validateFlow(flow);
    expect(errors.some((e) => e.message.includes("ghost"))).toBe(true);
  });

  it("errors for transitions from non-existent states", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "closed" }],
      transitions: [{ fromState: "ghost", toState: "closed", trigger: "go" }],
      initialState: "open",
    });
    const errors = validateFlow(flow);
    expect(errors.some((e) => e.message.includes("ghost"))).toBe(true);
  });

  it("errors for unreachable states", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "closed" }, { name: "island" }],
      transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
      initialState: "open",
    });
    const errors = validateFlow(flow);
    expect(errors.some((e) => e.message.includes("island") && e.message.includes("unreachable"))).toBe(true);
  });
});

describe("isTerminal", () => {
  it("returns true when no outgoing transitions exist", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "closed" }],
      transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
    });
    expect(isTerminal(flow, "closed")).toBe(true);
  });

  it("returns false when outgoing transitions exist", () => {
    const flow = makeFlow({
      states: [{ name: "open" }, { name: "closed" }],
      transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
    });
    expect(isTerminal(flow, "open")).toBe(false);
  });
});
