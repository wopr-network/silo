import { describe, expect, it, vi } from "vitest";
import type { EngineEvent } from "../../src/adapters/interfaces.js";
import { StdoutAdapter } from "../../src/adapters/stdout.js";

describe("StdoutAdapter", () => {
  it("logs event with emoji, timestamp, type, and JSON payload", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = new StdoutAdapter();

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: { refs: null },
      emittedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    await adapter.emit(event);

    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0];
    expect(call[0]).toMatch(/🆕/);
    expect(call[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(call[0]).toContain("entity.created");
    expect(call[1]).toContain('"entityId": "ent-1"');
    spy.mockRestore();
  });

  it("uses correct emoji for each known event type", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = new StdoutAdapter();

    const cases: Array<{ type: EngineEvent["type"]; emoji: string }> = [
      { type: "entity.transitioned", emoji: "➡️" },
      { type: "invocation.created", emoji: "📝" },
      { type: "invocation.claimed", emoji: "🤖" },
      { type: "invocation.completed", emoji: "✔️" },
      { type: "invocation.failed", emoji: "❌" },
      { type: "gate.passed", emoji: "🟢" },
      { type: "gate.failed", emoji: "🔴" },
      { type: "flow.spawned", emoji: "🌱" },
    ];

    for (const { type, emoji } of cases) {
      spy.mockClear();
      let event: EngineEvent;
      switch (type) {
        case "entity.transitioned":
          event = { type, entityId: "e", flowId: "f", fromState: "a", toState: "b", trigger: "t", emittedAt: new Date() };
          break;
        case "invocation.created":
          event = { type, entityId: "e", invocationId: "i", stage: "s", emittedAt: new Date() };
          break;
        case "invocation.claimed":
          event = { type, entityId: "e", invocationId: "i", agentId: "a", emittedAt: new Date() };
          break;
        case "invocation.completed":
          event = { type, entityId: "e", invocationId: "i", signal: "done", emittedAt: new Date() };
          break;
        case "invocation.failed":
          event = { type, entityId: "e", invocationId: "i", error: "err", emittedAt: new Date() };
          break;
        case "gate.passed":
          event = { type, entityId: "e", gateId: "g", emittedAt: new Date() };
          break;
        case "gate.failed":
          event = { type, entityId: "e", gateId: "g", emittedAt: new Date() };
          break;
        case "flow.spawned":
          event = { type, entityId: "e", flowId: "f", spawnedFlowId: "sf", emittedAt: new Date() };
          break;
        default:
          throw new Error(`unhandled type: ${type}`);
      }
      await adapter.emit(event);
      expect(spy.mock.calls[0][0]).toContain(emoji);
    }
    spy.mockRestore();
  });

  it("uses fallback emoji for unknown event types", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = new StdoutAdapter();

    const event = { type: "unknown.event", entityId: "e", emittedAt: new Date() } as unknown as EngineEvent;
    await adapter.emit(event);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("📋");
    spy.mockRestore();
  });

  it("redacts sensitive fields from event payload", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = new StdoutAdapter();

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "e1",
      flowId: "f1",
      payload: { apiKey: "sk-ant-secret123", name: "test" },
      emittedAt: new Date("2025-01-01"),
    };

    await adapter.emit(event);

    const loggedString = spy.mock.calls[0][1] as string;
    expect(loggedString).not.toContain("sk-ant-secret123");
    expect(loggedString).toContain("[REDACTED]");
    expect(loggedString).toContain("test");
    spy.mockRestore();
  });

  it("truncates long description fields in payload", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = new StdoutAdapter();
    const longDesc = "x".repeat(200);

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "e1",
      flowId: "f1",
      payload: { description: longDesc },
      emittedAt: new Date("2025-01-01"),
    };

    await adapter.emit(event);

    const loggedString = spy.mock.calls[0][1] as string;
    expect(loggedString).not.toContain(longDesc);
    expect(loggedString).toContain("...");
    spy.mockRestore();
  });
});
