import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../radar-db/index.js";
import { WorkerRepo } from "../radar-db/repos/worker-repo.js";
import { workers } from "../radar-db/schema.js";
import { HeartbeatReaper } from "./heartbeat.js";

function makeReaper(opts: { thresholdSec?: number; intervalMs?: number } = {}) {
  const db = createDb(":memory:");
  const repo = new WorkerRepo(db);
  const reaper = new HeartbeatReaper(repo, {
    staleThresholdSec: opts.thresholdSec ?? 60,
    checkIntervalMs: opts.intervalMs ?? 50,
  });
  return { db, repo, reaper };
}

describe("HeartbeatReaper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks stale workers as offline", async () => {
    const { db, repo, reaper } = makeReaper({ thresholdSec: 60, intervalMs: 50 });

    const worker = await repo.register({ name: "w1", type: "claude", discipline: "engineering" });

    // Set lastHeartbeat to 120s ago (well past 60s threshold)
    const staleTime = Math.floor(Date.now() / 1000) - 120;
    db.update(workers).set({ lastHeartbeat: staleTime }).where(eq(workers.id, worker.id)).run();

    reaper.start();
    await vi.advanceTimersByTimeAsync(60);
    reaper.stop();

    // Allow any pending async setStatus to resolve
    await Promise.resolve();

    const updated = await repo.getById(worker.id);
    expect(updated?.status).toBe("offline");
  });

  it("does not touch workers with fresh heartbeats", async () => {
    const { repo, reaper } = makeReaper({ thresholdSec: 60, intervalMs: 50 });

    const worker = await repo.register({ name: "w1", type: "claude", discipline: "engineering" });

    reaper.start();
    await vi.advanceTimersByTimeAsync(60);
    reaper.stop();

    const updated = await repo.getById(worker.id);
    expect(updated?.status).toBe("idle");
  });

  it("does not re-process already-offline workers", async () => {
    const { db, repo, reaper } = makeReaper({ thresholdSec: 60, intervalMs: 50 });

    const worker = await repo.register({ name: "w1", type: "claude", discipline: "engineering" });
    await repo.setStatus(worker.id, "offline");

    const staleTime = Math.floor(Date.now() / 1000) - 120;
    db.update(workers).set({ lastHeartbeat: staleTime }).where(eq(workers.id, worker.id)).run();

    const loggerMod = await import("../logger.js");
    const warnSpy = vi.spyOn(loggerMod.logger, "warn");

    reaper.start();
    await vi.advanceTimersByTimeAsync(60);
    reaper.stop();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stop() clears the interval and is idempotent", async () => {
    const { reaper } = makeReaper();
    reaper.start();
    reaper.stop();
    reaper.stop(); // should not throw
  });

  it("start() is idempotent", async () => {
    const { reaper } = makeReaper();
    reaper.start();
    reaper.start(); // should not throw or create duplicate intervals
    reaper.stop();
  });
});
