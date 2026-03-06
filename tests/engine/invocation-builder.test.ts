import { describe, it, expect } from "vitest";
import { buildInvocation } from "../../src/engine/invocation-builder.js";
import type { EnrichedEntity, Entity, State } from "../../src/repositories/interfaces.js";

function makeState(overrides: Partial<State> = {}): State {
  return {
    id: "s-1",
    flowId: "flow-1",
    name: "coding",
    agentRole: "coder",
    modelTier: "sonnet",
    mode: "active",
    promptTemplate: "Implement {{entity.artifacts.task}} for {{entity.refs.github.id}}",
    constraints: null,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "coding",
    refs: { github: { adapter: "github", id: "wopr-network/wopr#123" } },
    artifacts: { task: "add auth middleware" },
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("buildInvocation", () => {
  it("renders Handlebars prompt template with entity context", () => {
    const state = makeState();
    const entity = makeEntity();
    const result = buildInvocation(state, entity);
    expect(result.prompt).toBe("Implement add auth middleware for wopr-network/wopr#123");
    expect(result.agentRole).toBe("coder");
    expect(result.mode).toBe("active");
  });

  it("returns empty prompt when no template is defined", () => {
    const state = makeState({ promptTemplate: null });
    const entity = makeEntity();
    const result = buildInvocation(state, entity);
    expect(result.prompt).toBe("");
  });

  it("includes entity and state in context", () => {
    const state = makeState();
    const entity = makeEntity();
    const result = buildInvocation(state, entity);
    expect(result.context).toHaveProperty("entity");
    expect(result.context).toHaveProperty("state");
  });

  it("passes mode from state", () => {
    const state = makeState({ mode: "passive" });
    const entity = makeEntity();
    const result = buildInvocation(state, entity);
    expect(result.mode).toBe("passive");
  });

  it("renders built-in helpers from shared Handlebars instance", () => {
    const state = makeState({
      promptTemplate: "Count: {{invocation_count entity \"coding\"}}",
    });
    const entity: EnrichedEntity = {
      ...makeEntity(),
      invocations: [
        { id: "i-1", entityId: "ent-1", stage: "coding", agentRole: null, mode: "active", prompt: "", context: null, claimedBy: null, claimedAt: null, startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 0 },
        { id: "i-2", entityId: "ent-1", stage: "coding", agentRole: null, mode: "active", prompt: "", context: null, claimedBy: null, claimedAt: null, startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 0 },
        { id: "i-3", entityId: "ent-1", stage: "review", agentRole: null, mode: "active", prompt: "", context: null, claimedBy: null, claimedAt: null, startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 0 },
      ],
    };
    const result = buildInvocation(state, entity);
    expect(result.prompt).toBe("Count: 2");
  });
});
