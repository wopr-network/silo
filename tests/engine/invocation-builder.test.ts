import { describe, it, expect, vi } from "vitest";
import { buildInvocation } from "../../src/engine/invocation-builder.js";
import type { EnrichedEntity, Entity, Flow, State } from "../../src/repositories/interfaces.js";

function makeState(overrides: Partial<State> = {}): State {
  return {
    id: "s-1",
    flowId: "flow-1",
    name: "coding",
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
  it("renders Handlebars prompt template with entity context", async () => {
    const state = makeState();
    const entity = makeEntity();
    const result = await buildInvocation(state, entity);
    expect(result.prompt).toBe("Implement add auth middleware for wopr-network/wopr#123");
    expect(result.mode).toBe("active");
  });

  it("returns empty prompt when no template is defined", async () => {
    const state = makeState({ promptTemplate: null });
    const entity = makeEntity();
    const result = await buildInvocation(state, entity);
    expect(result.prompt).toBe("");
  });

  it("includes entity and state in context", async () => {
    const state = makeState();
    const entity = makeEntity();
    const result = await buildInvocation(state, entity);
    expect(result.context).toHaveProperty("entity");
    expect(result.context).toHaveProperty("state");
  });

  it("passes mode from state", async () => {
    const state = makeState({ mode: "passive" });
    const entity = makeEntity();
    const result = await buildInvocation(state, entity);
    expect(result.mode).toBe("passive");
  });

  it("renders built-in helpers from shared Handlebars instance", async () => {
    const state = makeState({
      promptTemplate: "Count: {{invocation_count entity \"coding\"}}",
    });
    const entity: EnrichedEntity = {
      ...makeEntity(),
      invocations: [
        { id: "i-1", entityId: "ent-1", stage: "coding", mode: "active", prompt: "", context: null, claimedBy: null, claimedAt: null, startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 0 },
        { id: "i-2", entityId: "ent-1", stage: "coding", mode: "active", prompt: "", context: null, claimedBy: null, claimedAt: null, startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 0 },
        { id: "i-3", entityId: "ent-1", stage: "review", mode: "active", prompt: "", context: null, claimedBy: null, claimedAt: null, startedAt: null, completedAt: null, failedAt: null, signal: null, artifacts: null, error: null, ttlMs: 0 },
      ],
    };
    const result = await buildInvocation(state, entity);
    expect(result.prompt).toBe("Count: 2");
  });

  it("resolves refs through adapters and includes them in template context", async () => {
    const state = makeState({
      promptTemplate: "Issue: {{refs.issue.title}} PR: {{refs.pr.key}}",
    });
    const entity = makeEntity({
      refs: {
        issue: { adapter: "linear", id: "ISS-1" },
        pr: { adapter: "linear", id: "ISS-2" },
      },
    });
    const mockLinear = {
      get: vi.fn()
        .mockResolvedValueOnce({ title: "Fix login bug", id: "ISS-1" })
        .mockResolvedValueOnce({ key: "WOP-42", id: "ISS-2" }),
    };
    const adapters = new Map<string, unknown>([["linear", mockLinear]]);

    const result = await buildInvocation(state, entity, adapters);

    expect(result.prompt).toBe("Issue: Fix login bug PR: WOP-42");
    expect(result.context.refs).toEqual({
      issue: { title: "Fix login bug", id: "ISS-1" },
      pr: { key: "WOP-42", id: "ISS-2" },
    });
    expect(mockLinear.get).toHaveBeenCalledWith("ISS-1");
    expect(mockLinear.get).toHaveBeenCalledWith("ISS-2");
  });

  it("skips refs when adapter is not in the map", async () => {
    const state = makeState({
      promptTemplate: "Hello {{entity.id}}",
    });
    const entity = makeEntity({
      refs: { issue: { adapter: "jira", id: "J-1" } },
    });
    const adapters = new Map<string, unknown>(); // no jira adapter

    const result = await buildInvocation(state, entity, adapters);

    expect(result.prompt).toBe("Hello ent-1");
    expect(result.context.refs).toEqual({});
  });

  it("skips refs when adapter has no get method", async () => {
    const state = makeState({
      promptTemplate: "Hello {{entity.id}}",
    });
    const entity = makeEntity({
      refs: { issue: { adapter: "noop", id: "X-1" } },
    });
    const adapters = new Map<string, unknown>([["noop", { emit: vi.fn() }]]);

    const result = await buildInvocation(state, entity, adapters);

    expect(result.prompt).toBe("Hello ent-1");
    expect(result.context.refs).toEqual({});
  });

  it("skips ref when adapter.get throws", async () => {
    const state = makeState({
      promptTemplate: "Hello {{entity.id}}",
    });
    const entity = makeEntity({
      refs: { issue: { adapter: "linear", id: "BAD-1" } },
    });
    const mockLinear = {
      get: vi.fn().mockRejectedValue(new Error("API down")),
    };
    const adapters = new Map<string, unknown>([["linear", mockLinear]]);

    const result = await buildInvocation(state, entity, adapters);

    expect(result.prompt).toBe("Hello ent-1");
    expect(result.context.refs).toEqual({});
  });

  it("works with no adapters argument (backward compat)", async () => {
    const state = makeState();
    const entity = makeEntity();
    const result = await buildInvocation(state, entity);
    expect(result.prompt).toBe("Implement add auth middleware for wopr-network/wopr#123");
    expect(result.context.refs).toEqual({});
  });

  it("works when entity.refs is null", async () => {
    const state = makeState({ promptTemplate: "No refs" });
    const entity = makeEntity({ refs: null });
    const adapters = new Map<string, unknown>();

    const result = await buildInvocation(state, entity, adapters);

    expect(result.prompt).toBe("No refs");
    expect(result.context.refs).toEqual({});
  });

  it("renders activityHistory from entity artifacts in prompt template", async () => {
    const state = makeState({
      promptTemplate:
        "Fix the code.{{#if entity.artifacts.activityHistory}}\n## Prior Attempt\n{{entity.artifacts.activityHistory}}{{/if}}",
    });
    const entity = makeEntity({
      artifacts: {
        task: "fix auth",
        activityHistory:
          "Prior work on this entity:\n\nAttempt 1:\n  - Called tool: Edit({file: 'src/auth.ts'})\n  - Ended: success (cost: $0.0042)",
      },
    });
    const result = await buildInvocation(state, entity);
    expect(result.prompt).toContain("## Prior Attempt");
    expect(result.prompt).toContain("Called tool: Edit");
    expect(result.prompt).toContain("cost: $0.0042");
  });

  it("omits activityHistory section when artifact is not present", async () => {
    const state = makeState({
      promptTemplate:
        "Fix the code.{{#if entity.artifacts.activityHistory}}\n## Prior Attempt\n{{entity.artifacts.activityHistory}}{{/if}}",
    });
    const entity = makeEntity({
      artifacts: { task: "fix auth" },
    });
    const result = await buildInvocation(state, entity);
    expect(result.prompt).toBe("Fix the code.");
    expect(result.prompt).not.toContain("Prior Attempt");
  });

  it("renders {{flow.name}} when flow is passed", async () => {
    const state = makeState({ promptTemplate: "You are on the {{flow.name}} team." });
    const entity = makeEntity();
    const flow: Flow = {
      id: "flow-1",
      name: "wopr-incident",
      description: null,
      entitySchema: null,
      initialState: "coding",
      maxConcurrent: 1,
      maxConcurrentPerRepo: 1,
      affinityWindowMs: 300000,
      version: 1,
      createdBy: null,
      discipline: null,
      createdAt: null,
      updatedAt: null,
      states: [],
      transitions: [],
    };

    const result = await buildInvocation(state, entity, undefined, flow);

    expect(result.prompt).toBe("You are on the wopr-incident team.");
    expect(result.context).toHaveProperty("flow");
  });

});
