import { describe, expect, it, vi } from "vitest";
import type { EngineEvent, IEventBusAdapter } from "../../src/adapters/interfaces.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";

function makeEvent(): EngineEvent {
  return {
    type: "entity.created",
    entityId: "ent-1",
    flowId: "flow-1",
    payload: {},
    emittedAt: new Date(),
  };
}

describe("EventEmitter", () => {
  it("broadcasts event to all registered adapters", async () => {
    const emitter = new EventEmitter();
    const adapter1: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };
    const adapter2: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };
    emitter.register(adapter1);
    emitter.register(adapter2);

    const event = makeEvent();
    await emitter.emit(event);

    expect(adapter1.emit).toHaveBeenCalledWith(event);
    expect(adapter2.emit).toHaveBeenCalledWith(event);
  });

  it("calls adapters in parallel via Promise.allSettled", async () => {
    const emitter = new EventEmitter();
    const order: string[] = [];
    const slow: IEventBusAdapter = {
      emit: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push("slow");
      }),
    };
    const fast: IEventBusAdapter = {
      emit: vi.fn().mockImplementation(async () => {
        order.push("fast");
      }),
    };
    emitter.register(slow);
    emitter.register(fast);

    await emitter.emit(makeEvent());

    expect(order).toEqual(["fast", "slow"]);
  });

  it("does not throw when an adapter fails", async () => {
    const emitter = new EventEmitter();
    const failing: IEventBusAdapter = {
      emit: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const healthy: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };
    emitter.register(failing);
    emitter.register(healthy);

    await expect(emitter.emit(makeEvent())).resolves.toBeUndefined();
    expect(healthy.emit).toHaveBeenCalled();
  });

  it("logs adapter errors to console.error", async () => {
    const emitter = new EventEmitter();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: IEventBusAdapter = {
      emit: vi.fn().mockRejectedValue(new Error("boom")),
    };
    emitter.register(failing);

    await emitter.emit(makeEvent());

    expect(spy).toHaveBeenCalledWith("[EventEmitter] adapter error:", expect.any(Error));
    spy.mockRestore();
  });

  it("resolves immediately with zero adapters", async () => {
    const emitter = new EventEmitter();
    await expect(emitter.emit(makeEvent())).resolves.toBeUndefined();
  });

  it("does not throw when an adapter throws synchronously", async () => {
    const emitter = new EventEmitter();
    const syncThrowing: IEventBusAdapter = {
      emit: vi.fn().mockImplementation(() => {
        throw new Error("sync boom");
      }),
    };
    const healthy: IEventBusAdapter = { emit: vi.fn().mockResolvedValue(undefined) };
    emitter.register(syncThrowing);
    emitter.register(healthy);

    await expect(emitter.emit(makeEvent())).resolves.toBeUndefined();
    expect(healthy.emit).toHaveBeenCalled();
  });
});
