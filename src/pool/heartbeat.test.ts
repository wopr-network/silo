import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../tests/helpers/pg-test-db.js";
import { WorkerRepo } from "../radar-db/repos/worker-repo.js";
import { workers } from "../radar-db/schema.js";
import { HeartbeatReaper } from "./heartbeat.js";

async function makeReaper(opts: { thresholdSec?: number; intervalMs?: number } = {}) {
  const { db, close } = await createTestDb();
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  const repo = new WorkerRepo(db as any, "test-tenant");
  const reaper = new HeartbeatReaper(repo, {
    staleThresholdSec: opts.thresholdSec ?? 60,
    checkIntervalMs: opts.intervalMs ?? 50,
  });
  return { db, repo, reaper, close };
}

describe("HeartbeatReaper", () => {
  it("marks stale workers as offline", async () => {
    const { db, repo, reaper, close } = await makeReaper({ thresholdSec: 60, intervalMs: 50 });

    try {
      const worker = await repo.register({ name: "w1", type: "claude", discipline: "engineering" });

      // Set lastHeartbeat to 120s ago (well past 60s threshold)
      const staleTime = Math.floor(Date.now() / 1000) - 120;
      await db.update(workers).set({ lastHeartbeat: staleTime }).where(eq(workers.id, worker.id));

      reaper.start();
      // Wait for the reaper interval to fire and process
      await new Promise((r) => setTimeout(r, 120));
      reaper.stop();

      // Allow any pending async setStatus to resolve
      await new Promise((r) => setTimeout(r, 50));

      const updated = await repo.getById(worker.id);
      expect(updated?.status).toBe("offline");
    } finally {
      await close();
    }
  });

  it("does not touch workers with fresh heartbeats", async () => {
    const { repo, reaper, close } = await makeReaper({ thresholdSec: 60, intervalMs: 50 });

    try {
      const worker = await repo.register({ name: "w1", type: "claude", discipline: "engineering" });

      reaper.start();
      await new Promise((r) => setTimeout(r, 120));
      reaper.stop();

      const updated = await repo.getById(worker.id);
      expect(updated?.status).toBe("idle");
    } finally {
      await close();
    }
  });

  it("does not re-process already-offline workers", async () => {
    const { db, repo, reaper, close } = await makeReaper({ thresholdSec: 60, intervalMs: 50 });

    try {
      const worker = await repo.register({ name: "w1", type: "claude", discipline: "engineering" });
      await repo.setStatus(worker.id, "offline");

      const staleTime = Math.floor(Date.now() / 1000) - 120;
      await db.update(workers).set({ lastHeartbeat: staleTime }).where(eq(workers.id, worker.id));

      const loggerMod = await import("../logger.js");
      const warnSpy = vi.spyOn(loggerMod.logger, "warn");

      reaper.start();
      await new Promise((r) => setTimeout(r, 120));
      reaper.stop();

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("stop() clears the interval and is idempotent", async () => {
    const { reaper, close } = await makeReaper();
    try {
      reaper.start();
      reaper.stop();
      reaper.stop(); // should not throw
    } finally {
      await close();
    }
  });

  it("start() is idempotent", async () => {
    const { reaper, close } = await makeReaper();
    try {
      reaper.start();
      reaper.start(); // should not throw or create duplicate intervals
      reaper.stop();
    } finally {
      await close();
    }
  });
});
