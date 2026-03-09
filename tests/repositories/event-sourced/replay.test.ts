import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../src/repositories/interfaces.js";
import { replayEntity, replayInvocation } from "../../../src/repositories/event-sourced/replay.js";

function makeEvent(overrides: Partial<DomainEvent> & { type: string }): DomainEvent {
  return {
    id: "evt-1",
    type: overrides.type,
    entityId: "ent-1",
    payload: {},
    sequence: 1,
    emittedAt: Date.now(),
    ...overrides,
  };
}

describe("replayEntity", () => {
  it("returns null for empty events with no snapshot", () => {
    expect(replayEntity(null, [], "ent-1")).toBeNull();
  });

  it("creates entity from entity.created event", () => {
    const ts = 1700000000000;
    const events = [
      makeEvent({
        type: "entity.created",
        entityId: "ent-1",
        payload: { flowId: "flow-1", initialState: "open", refs: null, flowVersion: 2 },
        emittedAt: ts,
        sequence: 1,
      }),
    ];
    const result = replayEntity(null, events, "ent-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-1");
    expect(result!.flowId).toBe("flow-1");
    expect(result!.state).toBe("open");
    expect(result!.flowVersion).toBe(2);
    expect(result!.claimedBy).toBeNull();
    expect(result!.createdAt).toEqual(new Date(ts));
  });

  it("ignores events for other entities", () => {
    const events = [
      makeEvent({
        type: "entity.created",
        entityId: "ent-other",
        payload: { flowId: "flow-1", initialState: "open" },
        sequence: 1,
      }),
    ];
    expect(replayEntity(null, events, "ent-1")).toBeNull();
  });

  it("applies entity.transitioned", () => {
    const ts = 1700000001000;
    const events = [
      makeEvent({
        type: "entity.created",
        entityId: "ent-1",
        payload: { flowId: "flow-1", initialState: "open" },
        emittedAt: ts - 1000,
        sequence: 1,
      }),
      makeEvent({
        type: "entity.transitioned",
        entityId: "ent-1",
        payload: { toState: "review", artifacts: { pr: "123" } },
        emittedAt: ts,
        sequence: 2,
      }),
    ];
    const result = replayEntity(null, events, "ent-1");
    expect(result!.state).toBe("review");
    expect(result!.artifacts).toEqual({ pr: "123" });
    expect(result!.claimedBy).toBeNull();
  });

  it("applies entity.claimed and entity.released", () => {
    const events = [
      makeEvent({ type: "entity.created", entityId: "ent-1", payload: { flowId: "f", initialState: "s" }, sequence: 1 }),
      makeEvent({ type: "entity.claimed", entityId: "ent-1", payload: { agentId: "agent-42" }, emittedAt: 100, sequence: 2 }),
      makeEvent({ type: "entity.released", entityId: "ent-1", payload: {}, emittedAt: 200, sequence: 3 }),
    ];
    const result = replayEntity(null, events, "ent-1");
    expect(result!.claimedBy).toBeNull();
    expect(result!.claimedAt).toBeNull();
  });

  it("starts from snapshot and applies subsequent events", () => {
    const snap = {
      id: "ent-1",
      flowId: "flow-1",
      state: "open",
      refs: null,
      artifacts: null,
      claimedBy: null,
      claimedAt: null,
      flowVersion: 1,
      priority: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      affinityWorkerId: null,
      affinityRole: null,
      affinityExpiresAt: null,
    };
    const events = [
      makeEvent({
        type: "entity.transitioned",
        entityId: "ent-1",
        payload: { toState: "done" },
        emittedAt: 999,
        sequence: 10,
      }),
    ];
    const result = replayEntity(snap, events, "ent-1");
    expect(result!.state).toBe("done");
  });

  it("merges artifacts on multiple transitions", () => {
    const events = [
      makeEvent({ type: "entity.created", entityId: "ent-1", payload: { flowId: "f", initialState: "s" }, sequence: 1 }),
      makeEvent({ type: "entity.transitioned", entityId: "ent-1", payload: { toState: "b", artifacts: { x: 1 } }, sequence: 2 }),
      makeEvent({ type: "entity.transitioned", entityId: "ent-1", payload: { toState: "c", artifacts: { y: 2 } }, sequence: 3 }),
    ];
    const result = replayEntity(null, events, "ent-1");
    expect(result!.artifacts).toEqual({ x: 1, y: 2 });
  });
});

describe("replayInvocation", () => {
  it("returns null for empty events", () => {
    expect(replayInvocation("inv-1", [])).toBeNull();
  });

  it("creates invocation from invocation.created event", () => {
    const events = [
      makeEvent({
        type: "invocation.created",
        entityId: "ent-1",
        payload: { invocationId: "inv-1", stage: "run", agentRole: "coder", mode: "active", prompt: "do stuff", ttlMs: 60000 },
        emittedAt: 500,
        sequence: 1,
      }),
    ];
    const result = replayInvocation("inv-1", events);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("inv-1");
    expect(result!.entityId).toBe("ent-1");
    expect(result!.stage).toBe("run");
    expect(result!.agentRole).toBe("coder");
    expect(result!.mode).toBe("active");
    expect(result!.ttlMs).toBe(60000);
    expect(result!.claimedBy).toBeNull();
  });

  it("ignores events for other invocations", () => {
    const events = [
      makeEvent({
        type: "invocation.created",
        payload: { invocationId: "inv-other", stage: "x" },
        sequence: 1,
      }),
    ];
    expect(replayInvocation("inv-1", events)).toBeNull();
  });

  it("applies invocation.claimed", () => {
    const events = [
      makeEvent({ type: "invocation.created", entityId: "ent-1", payload: { invocationId: "inv-1", stage: "s", prompt: "p" }, sequence: 1 }),
      makeEvent({ type: "invocation.claimed", entityId: "ent-1", payload: { invocationId: "inv-1", agentId: "agent-7" }, emittedAt: 1000, sequence: 2 }),
    ];
    const result = replayInvocation("inv-1", events);
    expect(result!.claimedBy).toBe("agent-7");
    expect(result!.startedAt).toEqual(new Date(1000));
  });

  it("applies invocation.completed", () => {
    const events = [
      makeEvent({ type: "invocation.created", entityId: "ent-1", payload: { invocationId: "inv-1", stage: "s", prompt: "p" }, sequence: 1 }),
      makeEvent({ type: "invocation.completed", entityId: "ent-1", payload: { invocationId: "inv-1", signal: "done", artifacts: { pr: "42" } }, emittedAt: 2000, sequence: 2 }),
    ];
    const result = replayInvocation("inv-1", events);
    expect(result!.completedAt).toEqual(new Date(2000));
    expect(result!.signal).toBe("done");
    expect(result!.artifacts).toEqual({ pr: "42" });
  });

  it("applies invocation.failed", () => {
    const events = [
      makeEvent({ type: "invocation.created", entityId: "ent-1", payload: { invocationId: "inv-1", stage: "s", prompt: "p" }, sequence: 1 }),
      makeEvent({ type: "invocation.failed", entityId: "ent-1", payload: { invocationId: "inv-1", error: "boom" }, emittedAt: 3000, sequence: 2 }),
    ];
    const result = replayInvocation("inv-1", events);
    expect(result!.failedAt).toEqual(new Date(3000));
    expect(result!.error).toBe("boom");
  });

  it("applies invocation.expired (clears claim)", () => {
    const events = [
      makeEvent({ type: "invocation.created", entityId: "ent-1", payload: { invocationId: "inv-1", stage: "s", prompt: "p" }, sequence: 1 }),
      makeEvent({ type: "invocation.claimed", entityId: "ent-1", payload: { invocationId: "inv-1", agentId: "ag" }, emittedAt: 100, sequence: 2 }),
      makeEvent({ type: "invocation.expired", entityId: "ent-1", payload: { invocationId: "inv-1" }, sequence: 3 }),
    ];
    const result = replayInvocation("inv-1", events);
    expect(result!.claimedBy).toBeNull();
    expect(result!.claimedAt).toBeNull();
    expect(result!.startedAt).toBeNull();
  });
});
