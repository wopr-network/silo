import { describe, it, expectTypeOf } from "vitest";
import type {
  EngineEventType,
  EngineEvent,
  IIssueTrackerAdapter,
  ICodeHostAdapter,
  IAIProviderAdapter,
  IEventBusAdapter,
} from "../../src/adapters/interfaces.js";

describe("adapter types compile", () => {
  it("EngineEvent has required fields", () => {
    expectTypeOf<EngineEvent>().toHaveProperty("type");
    expectTypeOf<EngineEvent>().toHaveProperty("payload");
    expectTypeOf<EngineEvent>().toHaveProperty("emittedAt");
  });

  it("EngineEventType includes expected values", () => {
    expectTypeOf<"entity.created">().toMatchTypeOf<EngineEventType>();
    expectTypeOf<"invocation.completed">().toMatchTypeOf<EngineEventType>();
    expectTypeOf<"gate.passed">().toMatchTypeOf<EngineEventType>();
    expectTypeOf<"flow.spawned">().toMatchTypeOf<EngineEventType>();
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
