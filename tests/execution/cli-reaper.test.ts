import { beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/engine/engine.js";

describe("reaper integration", () => {
  it("Engine.startReaper returns a stop function", () => {
    const reapExpired = vi.fn().mockResolvedValue([]);
    const reapExpiredEntity = vi.fn().mockResolvedValue(undefined);
    const engine = new Engine({
      entityRepo: { reapExpired: reapExpiredEntity, clearExpiredAffinity: vi.fn().mockResolvedValue([]) } as any,
      flowRepo: {} as any,
      invocationRepo: { reapExpired } as any,
      gateRepo: {} as any,
      transitionLogRepo: {} as any,
      adapters: new Map(),
      eventEmitter: { emit: vi.fn() } as any,
    });

    const stop = engine.startReaper(60000, 300000);
    expect(typeof stop).toBe("function");
    stop();
  });
});

describe("reaper lifecycle", () => {
  it("reaper calls reapExpired on interval", async () => {
    vi.useFakeTimers();
    const reapExpired = vi.fn().mockResolvedValue([]);
    const reapExpiredEntity = vi.fn().mockResolvedValue(undefined);
    const engine = new Engine({
      entityRepo: { reapExpired: reapExpiredEntity, clearExpiredAffinity: vi.fn().mockResolvedValue([]) } as any,
      flowRepo: {} as any,
      invocationRepo: { reapExpired } as any,
      gateRepo: {} as any,
      transitionLogRepo: {} as any,
      adapters: new Map(),
      eventEmitter: { emit: vi.fn() } as any,
    });

    const stop = engine.startReaper(100, 5000);

    expect(reapExpired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(reapExpired).toHaveBeenCalledTimes(1);
    expect(reapExpiredEntity).toHaveBeenCalledWith(5000);

    await vi.advanceTimersByTimeAsync(100);
    expect(reapExpired).toHaveBeenCalledTimes(2);

    await stop();

    await vi.advanceTimersByTimeAsync(200);
    expect(reapExpired).toHaveBeenCalledTimes(2); // no more calls after stop

    vi.useRealTimers();
  });

  it("stopReaper drains in-flight tick before resolving", async () => {
    let resolveTick!: () => void;
    const tickInflight = new Promise<void>((res) => {
      resolveTick = res;
    });

    // reapExpired blocks until we release it
    let reapStarted = false;
    const reapExpired = vi.fn().mockImplementation(() => {
      reapStarted = true;
      return tickInflight.then(() => []);
    });
    const reapExpiredEntity = vi.fn().mockResolvedValue(undefined);

    vi.useFakeTimers();
    const engine = new Engine({
      entityRepo: { reapExpired: reapExpiredEntity, clearExpiredAffinity: vi.fn().mockResolvedValue([]) } as any,
      flowRepo: {} as any,
      invocationRepo: { reapExpired } as any,
      gateRepo: {} as any,
      transitionLogRepo: {} as any,
      adapters: new Map(),
      eventEmitter: { emit: vi.fn() } as any,
    });

    const stop = engine.startReaper(100, 5000);

    // Trigger one tick
    await vi.advanceTimersByTimeAsync(100);
    expect(reapStarted).toBe(true);

    vi.useRealTimers();

    // stopReaper should not resolve until the in-flight tick completes
    let stopResolved = false;
    const stopPromise = stop().then(() => {
      stopResolved = true;
    });

    // Tick is still blocked — stop should not have resolved yet
    await new Promise((r) => setTimeout(r, 10));
    expect(stopResolved).toBe(false);

    // Release the in-flight tick
    resolveTick();
    await stopPromise;
    expect(stopResolved).toBe(true);

    // reapExpiredEntity (called after reapExpired resolves) must have run
    expect(reapExpiredEntity).toHaveBeenCalledWith(5000);
  });
});
