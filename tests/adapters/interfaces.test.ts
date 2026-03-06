import { describe, it, expectTypeOf } from "vitest";
import type {
  EngineEvent,
  IIssueTrackerAdapter,
  ICodeHostAdapter,
  IAIProviderAdapter,
  IEventBusAdapter,
} from "../../src/adapters/interfaces.js";

describe("adapter types compile", () => {
  it("EngineEvent has required fields", () => {
    expectTypeOf<EngineEvent>().toHaveProperty("type");
    expectTypeOf<Extract<EngineEvent, { type: "entity.created" }>>().toHaveProperty("payload");
    expectTypeOf<EngineEvent>().toHaveProperty("emittedAt");
  });

  it("EngineEvent type discriminant includes expected values", () => {
    expectTypeOf<"entity.created">().toMatchTypeOf<EngineEvent["type"]>();
    expectTypeOf<"invocation.completed">().toMatchTypeOf<EngineEvent["type"]>();
    expectTypeOf<"gate.passed">().toMatchTypeOf<EngineEvent["type"]>();
    expectTypeOf<"flow.spawned">().toMatchTypeOf<EngineEvent["type"]>();
  });
});

describe("adapter interfaces compile", () => {
  it("IIssueTrackerAdapter has all methods", () => {
    expectTypeOf<IIssueTrackerAdapter>().toHaveProperty("get");
    expectTypeOf<IIssueTrackerAdapter>().toHaveProperty("list");
    expectTypeOf<IIssueTrackerAdapter>().toHaveProperty("create");
    expectTypeOf<IIssueTrackerAdapter>().toHaveProperty("update");
    expectTypeOf<IIssueTrackerAdapter>().toHaveProperty("transition");
    expectTypeOf<IIssueTrackerAdapter>().toHaveProperty("addComment");
  });

  it("ICodeHostAdapter has all methods", () => {
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("getPR");
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("getDiff");
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("getChecks");
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("createPR");
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("mergePR");
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("createWorktree");
    expectTypeOf<ICodeHostAdapter>().toHaveProperty("removeWorktree");
  });

  it("IAIProviderAdapter has invoke method", () => {
    expectTypeOf<IAIProviderAdapter>().toHaveProperty("invoke");
  });

  it("IEventBusAdapter has emit method", () => {
    expectTypeOf<IEventBusAdapter>().toHaveProperty("emit");
  });
});
