import { describe, it, expectTypeOf } from "vitest";
import type {
  Refs,
  Artifacts,
  Mode,
  Entity,
  Invocation,
  GateResult,
  TransitionLog,
  State,
  Transition,
  Gate,
  Flow,
  FlowVersion,
  CreateFlowInput,
  CreateStateInput,
  CreateTransitionInput,
  CreateGateInput,
  IEntityRepository,
  IFlowRepository,
  IInvocationRepository,
  IGateRepository,
} from "../../src/repositories/interfaces.js";

describe("repository types compile", () => {
  it("Entity has all required fields", () => {
    expectTypeOf<Entity>().toHaveProperty("id");
    expectTypeOf<Entity>().toHaveProperty("flowId");
    expectTypeOf<Entity>().toHaveProperty("state");
    expectTypeOf<Entity>().toHaveProperty("refs");
    expectTypeOf<Entity>().toHaveProperty("artifacts");
    expectTypeOf<Entity>().toHaveProperty("claimedBy");
    expectTypeOf<Entity>().toHaveProperty("claimedAt");
    expectTypeOf<Entity>().toHaveProperty("flowVersion");
    expectTypeOf<Entity>().toHaveProperty("createdAt");
    expectTypeOf<Entity>().toHaveProperty("updatedAt");
  });

  it("Invocation has all required fields", () => {
    expectTypeOf<Invocation>().toHaveProperty("id");
    expectTypeOf<Invocation>().toHaveProperty("entityId");
    expectTypeOf<Invocation>().toHaveProperty("mode");
    expectTypeOf<Invocation>().toHaveProperty("prompt");
    expectTypeOf<Invocation>().toHaveProperty("ttlMs");
  });

  it("Mode is a string union", () => {
    expectTypeOf<Mode>().toEqualTypeOf<"active" | "passive">();
  });

  it("GateResult has passed as boolean", () => {
    expectTypeOf<GateResult["passed"]>().toEqualTypeOf<boolean>();
  });

  it("Flow includes states and transitions arrays", () => {
    expectTypeOf<Flow["states"]>().toEqualTypeOf<State[]>();
    expectTypeOf<Flow["transitions"]>().toEqualTypeOf<Transition[]>();
  });
});

describe("repository interfaces compile", () => {
  it("IEntityRepository has all methods", () => {
    expectTypeOf<IEntityRepository>().toHaveProperty("create");
    expectTypeOf<IEntityRepository>().toHaveProperty("get");
    expectTypeOf<IEntityRepository>().toHaveProperty("findByFlowAndState");
    expectTypeOf<IEntityRepository>().toHaveProperty("hasAnyInFlowAndState");
    expectTypeOf<IEntityRepository>().toHaveProperty("transition");
    expectTypeOf<IEntityRepository>().toHaveProperty("updateArtifacts");
    expectTypeOf<IEntityRepository>().toHaveProperty("claim");
    expectTypeOf<IEntityRepository>().toHaveProperty("reapExpired");
  });

  it("IFlowRepository has all methods", () => {
    expectTypeOf<IFlowRepository>().toHaveProperty("create");
    expectTypeOf<IFlowRepository>().toHaveProperty("get");
    expectTypeOf<IFlowRepository>().toHaveProperty("getByName");
    expectTypeOf<IFlowRepository>().toHaveProperty("update");
    expectTypeOf<IFlowRepository>().toHaveProperty("addState");
    expectTypeOf<IFlowRepository>().toHaveProperty("updateState");
    expectTypeOf<IFlowRepository>().toHaveProperty("addTransition");
    expectTypeOf<IFlowRepository>().toHaveProperty("updateTransition");
    expectTypeOf<IFlowRepository>().toHaveProperty("snapshot");
    expectTypeOf<IFlowRepository>().toHaveProperty("restore");
  });

  it("IInvocationRepository has all methods", () => {
    expectTypeOf<IInvocationRepository>().toHaveProperty("create");
    expectTypeOf<IInvocationRepository>().toHaveProperty("get");
    expectTypeOf<IInvocationRepository>().toHaveProperty("claim");
    expectTypeOf<IInvocationRepository>().toHaveProperty("complete");
    expectTypeOf<IInvocationRepository>().toHaveProperty("fail");
    expectTypeOf<IInvocationRepository>().toHaveProperty("findByEntity");
    expectTypeOf<IInvocationRepository>().toHaveProperty("findUnclaimed");
    expectTypeOf<IInvocationRepository>().toHaveProperty("reapExpired");
    expectTypeOf<IInvocationRepository>().toHaveProperty("countActiveByFlow");
    expectTypeOf<IInvocationRepository>().toHaveProperty("countPendingByFlow");
  });

  it("IGateRepository has all methods", () => {
    expectTypeOf<IGateRepository>().toHaveProperty("create");
    expectTypeOf<IGateRepository>().toHaveProperty("get");
    expectTypeOf<IGateRepository>().toHaveProperty("getByName");
    expectTypeOf<IGateRepository>().toHaveProperty("record");
    expectTypeOf<IGateRepository>().toHaveProperty("resultsFor");
  });
});
