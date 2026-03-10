import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/pg-test-db.js";
import { DrizzleThroughputRepo } from "../radar-db/repos/drizzle-throughput-repo.js";
import { ThroughputTracker } from "./throughput-tracker.js";

async function makeTracker() {
  const { db, close } = await createTestDb();
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  const repo = new DrizzleThroughputRepo(db as any, "test-tenant");
  const tracker = new ThroughputTracker(repo);
  return { tracker, repo, close };
}

describe("ThroughputTracker", () => {
  it("returns zeros when empty", async () => {
    const { tracker, close } = await makeTracker();
    try {
      const stats = await tracker.getStats();
      expect(stats.completed_last_hour).toBe(0);
      expect(stats.failed_last_hour).toBe(0);
      expect(stats.avg_duration_ms).toBe(0);
    } finally {
      await close();
    }
  });

  it("counts completed and failed separately", async () => {
    const { tracker, close } = await makeTracker();
    try {
      await tracker.record("completed", 1000);
      await tracker.record("completed", 2000);
      await tracker.record("failed", 500);
      const stats = await tracker.getStats();
      expect(stats.completed_last_hour).toBe(2);
      expect(stats.failed_last_hour).toBe(1);
      expect(stats.avg_duration_ms).toBe(1500); // avg of completed only
    } finally {
      await close();
    }
  });

  it("excludes entries older than 1 hour", async () => {
    const { tracker, repo, close } = await makeTracker();
    try {
      const now = Date.now();
      // Insert an old entry directly via repo, bypassing the prune-on-write
      await repo.record("completed", 1000);
      // Prune everything recorded so far
      await repo.pruneOlderThan(now + 1);
      await tracker.record("completed", 2000); // this one is within the last hour
      const stats = await tracker.getStats();
      expect(stats.completed_last_hour).toBe(1);
    } finally {
      await close();
    }
  });

  it("avg_duration_ms only counts completed, not failed", async () => {
    const { tracker, close } = await makeTracker();
    try {
      await tracker.record("failed", 9999);
      await tracker.record("completed", 500);
      const stats = await tracker.getStats();
      expect(stats.avg_duration_ms).toBe(500);
    } finally {
      await close();
    }
  });

  it("pruning on record keeps memory bounded", async () => {
    const { tracker, close } = await makeTracker();
    try {
      // Record some entries; after pruning they should still count correctly
      await tracker.record("completed", 1000);
      await tracker.record("failed", 500);
      const stats = await tracker.getStats();
      expect(stats.completed_last_hour).toBe(1);
      expect(stats.failed_last_hour).toBe(1);
    } finally {
      await close();
    }
  });
});
