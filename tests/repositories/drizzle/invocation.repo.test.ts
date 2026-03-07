import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { bootstrap } from "../../../src/main.js";
import { DrizzleInvocationRepository } from "../../../src/repositories/drizzle/invocation.repo.js";
import { entities, flowDefinitions, invocations } from "../../../src/repositories/drizzle/schema.js";

let db: BetterSQLite3Database;
let sqlite: Database.Database;
let repo: DrizzleInvocationRepository;

async function seedEntity(flowId = "flow-1", entityId = "ent-1") {
  db.insert(flowDefinitions)
    .values({ id: flowId, name: `flow-${flowId}`, initialState: "init" })
    .run();
  db.insert(entities)
    .values({ id: entityId, flowId, state: "init", createdAt: Date.now(), updatedAt: Date.now() })
    .run();
}

beforeEach(() => {
  const result = bootstrap(":memory:");
  db = result.db as BetterSQLite3Database;
  sqlite = result.sqlite;
  repo = new DrizzleInvocationRepository(db);
});

afterEach(() => {
  sqlite.close();
});

describe("DrizzleInvocationRepository", () => {
  describe("create + get", () => {
    it("should create an invocation and retrieve it by id", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Please review", "active", 60000);
      expect(inv.id).toBeDefined();
      expect(inv.entityId).toBe("ent-1");
      expect(inv.stage).toBe("review");
      expect(inv.prompt).toBe("Please review");
      expect(inv.mode).toBe("active");
      expect(inv.ttlMs).toBe(60000);
      expect(inv.claimedBy).toBeNull();
      expect(inv.completedAt).toBeNull();
      expect(inv.failedAt).toBeNull();

      const fetched = await repo.get(inv.id);
      expect(fetched).toEqual(inv);
    });

    it("should return null for non-existent id", async () => {
      const result = await repo.get("does-not-exist");
      expect(result).toBeNull();
    });

    it("should use default ttlMs when not provided", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "build", "Build it", "passive");
      expect(inv.ttlMs).toBe(1800000);
    });
  });

  describe("claim", () => {
    it("should claim an unclaimed invocation", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      const claimed = await repo.claim(inv.id, "agent-1");
      expect(claimed).not.toBeNull();
      expect(claimed!.claimedBy).toBe("agent-1");
      expect(claimed!.claimedAt).toBeInstanceOf(Date);
    });

    it("should return null if already claimed", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      const second = await repo.claim(inv.id, "agent-2");
      expect(second).toBeNull();
    });

    it("should return null if invocation does not exist", async () => {
      const result = await repo.claim("nonexistent", "agent-1");
      expect(result).toBeNull();
    });

    it("should return null if invocation is already completed", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      const claimed = await repo.claim(inv.id, "agent-1");
      await repo.complete(claimed!.id, "done");
      const result = await repo.claim(inv.id, "agent-2");
      expect(result).toBeNull();
    });
  });

  describe("complete", () => {
    it("should mark invocation as completed with signal", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      const completed = await repo.complete(inv.id, "approved", { score: 95 });
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.signal).toBe("approved");
      expect(completed.artifacts).toEqual({ score: 95 });
    });

    it("should throw if already completed", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      await repo.complete(inv.id, "approved");
      await expect(repo.complete(inv.id, "again")).rejects.toThrow();
    });

    it("should throw if already failed", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      await repo.fail(inv.id, "crashed");
      await expect(repo.complete(inv.id, "approved")).rejects.toThrow();
    });
  });

  describe("fail", () => {
    it("should mark invocation as failed with error", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      const failed = await repo.fail(inv.id, "timeout");
      expect(failed.failedAt).toBeInstanceOf(Date);
      expect(failed.error).toBe("timeout");
    });

    it("should throw if already completed", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      await repo.complete(inv.id, "done");
      await expect(repo.fail(inv.id, "error")).rejects.toThrow();
    });

    it("should throw if already failed", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active");
      await repo.claim(inv.id, "agent-1");
      await repo.fail(inv.id, "first");
      await expect(repo.fail(inv.id, "second")).rejects.toThrow();
    });
  });

  describe("findByEntity", () => {
    it("should return all invocations for an entity ordered by creation", async () => {
      await seedEntity();
      await repo.create("ent-1", "review", "First", "active");
      await repo.create("ent-1", "build", "Second", "passive");
      const results = await repo.findByEntity("ent-1");
      expect(results).toHaveLength(2);
      expect(results[0].stage).toBe("review");
      expect(results[1].stage).toBe("build");
    });

    it("should return empty array when no invocations exist", async () => {
      const results = await repo.findByEntity("nonexistent");
      expect(results).toEqual([]);
    });
  });

  describe("reapExpired", () => {
    it("should reap invocations where claimedAt + ttlMs < now", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active", 1000);
      await repo.claim(inv.id, "agent-1");

      db.update(invocations)
        .set({ claimedAt: Date.now() - 2000 })
        .where(eq(invocations.id, inv.id))
        .run();

      const expired = await repo.reapExpired();
      expect(expired).toHaveLength(1);
      expect(expired[0].id).toBe(inv.id);

      const after = await repo.get(inv.id);
      expect(after!.claimedBy).toBeNull();
      expect(after!.claimedAt).toBeNull();
    });

    it("should not reap invocations within TTL", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active", 999999);
      await repo.claim(inv.id, "agent-1");
      const expired = await repo.reapExpired();
      expect(expired).toHaveLength(0);
    });

    it("should not reap completed or failed invocations", async () => {
      await seedEntity();
      const inv = await repo.create("ent-1", "review", "Review", "active", 1000);
      await repo.claim(inv.id, "agent-1");
      await repo.complete(inv.id, "done");

      db.update(invocations)
        .set({ claimedAt: Date.now() - 2000 })
        .where(eq(invocations.id, inv.id))
        .run();

      const expired = await repo.reapExpired();
      expect(expired).toHaveLength(0);
    });

    it("should not reap unclaimed invocations", async () => {
      await seedEntity();
      await repo.create("ent-1", "review", "Review", "active", 1000);
      const expired = await repo.reapExpired();
      expect(expired).toHaveLength(0);
    });
  });
});
