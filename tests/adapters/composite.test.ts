import { describe, it, expect, vi } from "vitest";
import { CompositeEventBusAdapter } from "../../src/adapters/composite.js";
import type { EngineEvent, IEventBusAdapter } from "../../src/adapters/interfaces.js";

describe("CompositeEventBusAdapter", () => {
  it("fans out to all child adapters", async () => {
    const a: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };
    const b: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };

    const composite = new CompositeEventBusAdapter([a, b]);
    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date(),
    };

    await composite.emit(event);

    expect(a.emit).toHaveBeenCalledWith(event);
    expect(b.emit).toHaveBeenCalledWith(event);
  });

  it("does not throw if one adapter fails", async () => {
    const a: IEventBusAdapter = { emit: vi.fn().mockRejectedValue(new Error("boom")) };
    const b: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const composite = new CompositeEventBusAdapter([a, b]);
    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date(),
    };

    await expect(composite.emit(event)).resolves.toBeUndefined();
    expect(b.emit).toHaveBeenCalledWith(event);
    consoleSpy.mockRestore();
  });

  it("works with empty adapter list", async () => {
    const composite = new CompositeEventBusAdapter([]);
    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date(),
    };

    await expect(composite.emit(event)).resolves.toBeUndefined();
  });
});
