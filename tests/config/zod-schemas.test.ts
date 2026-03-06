import { describe, it, expect } from "vitest";
import {
  FlowDefinitionSchema,
  StateDefinitionSchema,
  GateDefinitionSchema,
  TransitionRuleSchema,
  IntegrationConfigSchema,
  SeedFileSchema,
} from "../../src/config/zod-schemas.js";

// ─── FlowDefinitionSchema ───

describe("FlowDefinitionSchema", () => {
  it("accepts a valid flow", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "pr-review",
      description: "PR review pipeline",
      initialState: "open",
      maxConcurrent: 5,
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const result = FlowDefinitionSchema.parse({
      name: "pr-review",
      initialState: "open",
    });
    expect(result.maxConcurrent).toBe(0);
    expect(result.maxConcurrentPerRepo).toBe(0);
    expect(result.version).toBe(1);
  });

  it("rejects empty name", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "",
      initialState: "open",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing initialState", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "pr-review",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxConcurrent", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "pr-review",
      initialState: "open",
      maxConcurrent: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ─── StateDefinitionSchema ───

describe("StateDefinitionSchema", () => {
  it("accepts a valid state", () => {
    const result = StateDefinitionSchema.safeParse({
      name: "open",
      flowName: "pr-review",
      agentRole: "reviewer",
      modelTier: "sonnet",
      mode: "active",
    });
    expect(result.success).toBe(true);
  });

  it("defaults mode to passive", () => {
    const result = StateDefinitionSchema.parse({
      name: "open",
      flowName: "pr-review",
    });
    expect(result.mode).toBe("passive");
  });

  it("rejects invalid mode", () => {
    const result = StateDefinitionSchema.safeParse({
      name: "open",
      flowName: "pr-review",
      mode: "turbo",
    });
    expect(result.success).toBe(false);
  });
});

// ─── GateDefinitionSchema ───

describe("GateDefinitionSchema", () => {
  it("accepts a command gate", () => {
    const result = GateDefinitionSchema.safeParse({
      name: "lint-check",
      type: "command",
      command: "pnpm lint",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a function gate", () => {
    const result = GateDefinitionSchema.safeParse({
      name: "custom-check",
      type: "function",
      functionRef: "validators.checkCoverage",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an api gate", () => {
    const result = GateDefinitionSchema.safeParse({
      name: "sonar-gate",
      type: "api",
      apiConfig: { url: "https://sonar.example.com/api/check", method: "POST" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects command gate without command field", () => {
    const result = GateDefinitionSchema.safeParse({
      name: "lint-check",
      type: "command",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown gate type", () => {
    const result = GateDefinitionSchema.safeParse({
      name: "x",
      type: "magic",
    });
    expect(result.success).toBe(false);
  });

  it("defaults timeoutMs to 30000", () => {
    const result = GateDefinitionSchema.parse({
      name: "lint-check",
      type: "command",
      command: "pnpm lint",
    });
    expect(result.timeoutMs).toBe(30000);
  });
});

// ─── TransitionRuleSchema ───

describe("TransitionRuleSchema", () => {
  it("accepts a valid transition", () => {
    const result = TransitionRuleSchema.safeParse({
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
      trigger: "claim",
    });
    expect(result.success).toBe(true);
  });

  it("defaults priority to 0", () => {
    const result = TransitionRuleSchema.parse({
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
      trigger: "claim",
    });
    expect(result.priority).toBe(0);
  });

  it("rejects missing trigger", () => {
    const result = TransitionRuleSchema.safeParse({
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
    });
    expect(result.success).toBe(false);
  });
});

// ─── IntegrationConfigSchema ───

describe("IntegrationConfigSchema", () => {
  it("accepts a valid integration", () => {
    const result = IntegrationConfigSchema.safeParse({
      capability: "notifications",
      adapter: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/..." },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing adapter", () => {
    const result = IntegrationConfigSchema.safeParse({
      capability: "notifications",
    });
    expect(result.success).toBe(false);
  });
});

// ─── SeedFileSchema (cross-reference validation) ───

describe("SeedFileSchema", () => {
  const validSeed = {
    flows: [{ name: "pr-review", initialState: "open" }],
    states: [
      { name: "open", flowName: "pr-review" },
      { name: "reviewing", flowName: "pr-review" },
    ],
    gates: [{ name: "lint-pass", type: "command" as const, command: "pnpm lint" }],
    transitions: [
      {
        flowName: "pr-review",
        fromState: "open",
        toState: "reviewing",
        trigger: "claim",
        gateName: "lint-pass",
      },
    ],
  };

  it("accepts a valid seed file", () => {
    const result = SeedFileSchema.safeParse(validSeed);
    expect(result.success).toBe(true);
  });

  it("rejects state referencing unknown flow", () => {
    const seed = {
      ...validSeed,
      states: [
        ...validSeed.states,
        { name: "orphan", flowName: "nonexistent" },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("nonexistent"))).toBe(true);
    }
  });

  it("rejects flow whose initialState is not a defined state", () => {
    const seed = {
      ...validSeed,
      flows: [{ name: "pr-review", initialState: "nonexistent" }],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("initialState"))).toBe(true);
    }
  });

  it("rejects transition referencing unknown flow", () => {
    const seed = {
      ...validSeed,
      transitions: [
        { flowName: "nonexistent", fromState: "a", toState: "b", trigger: "go" },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
  });

  it("rejects transition with fromState not in flow", () => {
    const seed = {
      ...validSeed,
      transitions: [
        {
          flowName: "pr-review",
          fromState: "nonexistent",
          toState: "reviewing",
          trigger: "go",
        },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
  });

  it("rejects transition with toState not in flow", () => {
    const seed = {
      ...validSeed,
      transitions: [
        {
          flowName: "pr-review",
          fromState: "open",
          toState: "nonexistent",
          trigger: "go",
        },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
  });

  it("rejects transition referencing unknown gate", () => {
    const seed = {
      ...validSeed,
      transitions: [
        {
          flowName: "pr-review",
          fromState: "open",
          toState: "reviewing",
          trigger: "go",
          gateName: "nonexistent-gate",
        },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
  });

  it("rejects transition with spawnFlow referencing unknown flow", () => {
    const seed = {
      ...validSeed,
      transitions: [
        {
          flowName: "pr-review",
          fromState: "open",
          toState: "reviewing",
          trigger: "go",
          spawnFlow: "nonexistent-flow",
        },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
  });

  // Bug 1: statesByFlow should not include states from unknown flows
  it("rejects transition fromState when flow is unknown (statesByFlow ordering bug)", () => {
    // State references unknown flow "bad-flow", and a transition also references
    // "bad-flow". Before the fix, the state was added to statesByFlow["bad-flow"]
    // so the transition's fromState/toState checks ran against invalid data instead
    // of being skipped (or erroring on the flow reference alone).
    const seed = {
      flows: [{ name: "pr-review", initialState: "open" }],
      states: [
        { name: "open", flowName: "pr-review" },
        { name: "orphan", flowName: "bad-flow" }, // references unknown flow
      ],
      transitions: [
        {
          flowName: "bad-flow", // also unknown
          fromState: "orphan",  // only exists via the bad state
          toState: "orphan",
          trigger: "go",
        },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      // Must error on the flow reference in the transition
      expect(messages.some((m) => m.includes("bad-flow"))).toBe(true);
    }
  });

  // Bug 2: duplicate flow/gate names must be detected explicitly
  it("rejects duplicate flow names", () => {
    const seed = {
      flows: [
        { name: "pr-review", initialState: "open" },
        { name: "pr-review", initialState: "open" }, // duplicate
      ],
      states: [{ name: "open", flowName: "pr-review" }],
      transitions: [
        { flowName: "pr-review", fromState: "open", toState: "open", trigger: "loop" },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.toLowerCase().includes("duplicate"))).toBe(true);
    }
  });

  it("rejects duplicate gate names", () => {
    const seed = {
      flows: [{ name: "pr-review", initialState: "open" }],
      states: [{ name: "open", flowName: "pr-review" }],
      gates: [
        { name: "lint-pass", type: "command" as const, command: "pnpm lint" },
        { name: "lint-pass", type: "command" as const, command: "pnpm lint" }, // duplicate
      ],
      transitions: [
        { flowName: "pr-review", fromState: "open", toState: "open", trigger: "loop" },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.toLowerCase().includes("duplicate"))).toBe(true);
    }
  });

  // Bug 3: zero-state flow should still error on transition fromState/toState
  it("rejects transition fromState/toState when flow has zero states", () => {
    const seed = {
      flows: [
        { name: "pr-review", initialState: "open" },
        { name: "empty-flow", initialState: "start" }, // flow with no states
      ],
      states: [
        { name: "open", flowName: "pr-review" },
        { name: "reviewing", flowName: "pr-review" },
      ],
      transitions: [
        {
          flowName: "pr-review",
          fromState: "open",
          toState: "reviewing",
          trigger: "claim",
        },
        {
          flowName: "empty-flow", // exists but has zero states
          fromState: "start",     // should be invalid — no states defined
          toState: "done",
          trigger: "finish",
        },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      // Should error on fromState or toState for empty-flow
      expect(
        messages.some((m) => m.includes("start") || m.includes("done") || m.includes("empty-flow"))
      ).toBe(true);
    }
  });

  it("defaults gates and integrations to empty arrays", () => {
    const seed = {
      flows: [{ name: "simple", initialState: "start" }],
      states: [{ name: "start", flowName: "simple" }],
      transitions: [
        { flowName: "simple", fromState: "start", toState: "start", trigger: "loop" },
      ],
    };
    const result = SeedFileSchema.safeParse(seed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gates).toEqual([]);
      expect(result.data.integrations).toEqual([]);
    }
  });
});
