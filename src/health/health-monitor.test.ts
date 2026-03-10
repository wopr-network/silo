import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DefconClient } from "../defcon-client/client.js";
import { Pool } from "../pool/pool.js";
import { HealthMonitor } from "./health-monitor.js";
import type { HealthMonitorConfig } from "./types.js";

function makeDefconClient() {
  const reportFn = vi.fn().mockResolvedValue({ next_action: "check_back", message: "ok", retry_after_ms: 1000 });
  const client = { report: reportFn } as unknown as DefconClient;
  return { client, reportFn };
}

const FAST_CONFIG: HealthMonitorConfig = {
  heartbeatIntervalMs: 50,
  deadWorkerThresholdMs: 100,
};

describe("HealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when all slots are healthy", async () => {
    const pool = new Pool(4);
    const { client, reportFn } = makeDefconClient();
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    pool.allocate("s1", "w1", "engineering", "e1", "do stuff");

    monitor.start();
    await vi.advanceTimersByTimeAsync(FAST_CONFIG.heartbeatIntervalMs + 10);
    monitor.stop();

    expect(reportFn).not.toHaveBeenCalled();
    expect(pool.activeSlots()).toHaveLength(1);
  });

  it("reaps a dead slot and reports flow.fail", async () => {
    const pool = new Pool(4);
    const { client, reportFn } = makeDefconClient();
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    pool.allocate("s1", "w1", "engineering", "e1", "do stuff");

    // Simulate time passing beyond threshold
    vi.advanceTimersByTime(FAST_CONFIG.deadWorkerThresholdMs + 50);

    // Manually set lastHeartbeat to the past (since fake timers don't affect Date.now in allocate)
    const slot = pool.activeSlots()[0];
    slot.lastHeartbeat = Date.now() - FAST_CONFIG.deadWorkerThresholdMs - 1;

    monitor.start();
    await vi.advanceTimersByTimeAsync(FAST_CONFIG.heartbeatIntervalMs + 10);
    monitor.stop();

    expect(reportFn).toHaveBeenCalledWith({
      entityId: "e1",
      signal: "fail",
      artifacts: { reason: "worker_timeout" },
    });
    expect(pool.activeSlots()).toHaveLength(0);
  });

  it("does not reap slots in reporting state", async () => {
    const pool = new Pool(4);
    const { client, reportFn } = makeDefconClient();
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    pool.allocate("s1", "w1", "engineering", "e1", "do stuff");
    pool.complete("s1", { signal: "done", artifacts: {}, exitCode: 0 });

    // Make heartbeat stale
    const slot = pool.activeSlots()[0];
    slot.lastHeartbeat = Date.now() - FAST_CONFIG.deadWorkerThresholdMs - 1;

    monitor.start();
    await vi.advanceTimersByTimeAsync(FAST_CONFIG.heartbeatIntervalMs + 10);
    monitor.stop();

    expect(reportFn).not.toHaveBeenCalled();
    expect(pool.activeSlots()).toHaveLength(1);
  });

  it("skips slots with null entityId", async () => {
    const pool = new Pool(4);
    const { client, reportFn } = makeDefconClient();
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    pool.allocate("s1", "w1", "engineering", "e1", "do stuff");
    const slot = pool.activeSlots()[0];
    slot.entityId = null;
    slot.lastHeartbeat = Date.now() - FAST_CONFIG.deadWorkerThresholdMs - 1;

    monitor.start();
    await vi.advanceTimersByTimeAsync(FAST_CONFIG.heartbeatIntervalMs + 10);
    monitor.stop();

    expect(reportFn).not.toHaveBeenCalled();
    expect(pool.activeSlots()).toHaveLength(0);
  });

  it("catches defcon.report errors without crashing", async () => {
    const pool = new Pool(4);
    const { client, reportFn } = makeDefconClient();
    reportFn.mockRejectedValueOnce(new Error("network down"));
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    pool.allocate("s1", "w1", "engineering", "e1", "do stuff");
    const slot = pool.activeSlots()[0];
    slot.lastHeartbeat = Date.now() - FAST_CONFIG.deadWorkerThresholdMs - 1;

    monitor.start();
    await vi.advanceTimersByTimeAsync(FAST_CONFIG.heartbeatIntervalMs + 10);
    monitor.stop();

    expect(pool.activeSlots()).toHaveLength(0);
  });

  it("does not release slot if heartbeat arrives during defcon.report await", async () => {
    const pool = new Pool(4);
    // defcon.report takes time; during it, the heartbeat fires and updates lastHeartbeat
    let resolveReport!: () => void;
    const reportFn = vi.fn().mockImplementation(
      () =>
        new Promise<{ next_action: string; message: string; retry_after_ms: number }>((resolve) => {
          resolveReport = () => resolve({ next_action: "check_back", message: "ok", retry_after_ms: 1000 });
        }),
    );
    const client = { report: reportFn } as unknown as DefconClient;
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    pool.allocate("s1", "w1", "engineering", "e1", "do stuff");
    const slot = pool.activeSlots()[0];
    // Make slot appear stale
    slot.lastHeartbeat = Date.now() - FAST_CONFIG.deadWorkerThresholdMs - 1;

    monitor.start();
    // Advance enough to trigger check(); defcon.report is now awaiting
    await vi.advanceTimersByTimeAsync(FAST_CONFIG.heartbeatIntervalMs + 10);

    // Simulate heartbeat arriving while defcon.report is in flight
    slot.lastHeartbeat = Date.now();

    // Now resolve defcon.report
    resolveReport();
    await vi.advanceTimersByTimeAsync(0);
    monitor.stop();

    // Slot sent a heartbeat mid-await — must NOT be released
    expect(pool.activeSlots()).toHaveLength(1);
  });

  it("stop() clears the interval", () => {
    const pool = new Pool(4);
    const { client } = makeDefconClient();
    const monitor = new HealthMonitor(pool, client, FAST_CONFIG);

    monitor.start();
    monitor.stop();

    // Calling stop again should not throw
    monitor.stop();
  });
});
