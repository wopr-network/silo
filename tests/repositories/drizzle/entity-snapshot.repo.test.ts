import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { bootstrap } from "../../../src/main.js";
import { DrizzleEntitySnapshotRepository } from "../../../src/repositories/drizzle/entity-snapshot.repo.js";
import type { Entity } from "../../../src/repositories/interfaces.js";

let db: BetterSQLite3Database;
let sqlite: Database.Database;
let repo: DrizzleEntitySnapshotRepository;

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "open",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    priority: 0,
    createdAt: new Date(1000),
    updatedAt: new Date(2000),
    affinityWorkerId: null,
    affinityRole: null,
    affinityExpiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  const res = bootstrap(":memory:");
  db = res.db;
  sqlite = res.sqlite;
  repo = new DrizzleEntitySnapshotRepository(db);
});

afterEach(() => {
  sqlite.close();
});

describe("DrizzleEntitySnapshotRepository", () => {
  describe("loadLatest", () => {
    it("returns null when no snapshot exists", async () => {
      const result = await repo.loadLatest("ent-1");
      expect(result).toBeNull();
    });
  });

  describe("save and loadLatest", () => {
    it("saves a snapshot and loads it back", async () => {
      const entity = makeEntity({ state: "review", artifacts: { pr: "42" } });
      await repo.save("ent-1", 5, entity);
      const loaded = await repo.loadLatest("ent-1");
      expect(loaded).not.toBeNull();
      expect(loaded!.sequence).toBe(5);
      expect(loaded!.state.state).toBe("review");
      expect(loaded!.state.artifacts).toEqual({ pr: "42" });
      expect(loaded!.state.flowId).toBe("flow-1");
      expect(loaded!.state.flowVersion).toBe(1);
    });

    it("returns the latest (highest sequence) snapshot", async () => {
      await repo.save("ent-1", 3, makeEntity({ state: "old" }));
      await repo.save("ent-1", 10, makeEntity({ state: "new" }));
      const loaded = await repo.loadLatest("ent-1");
      expect(loaded!.sequence).toBe(10);
      expect(loaded!.state.state).toBe("new");
    });

    it("does not overwrite an existing snapshot at the same sequence (onConflictDoNothing)", async () => {
      await repo.save("ent-1", 5, makeEntity({ state: "first" }));
      // Second save at same entityId+sequence should be ignored
      await repo.save("ent-1", 5, makeEntity({ state: "second" }));
      const loaded = await repo.loadLatest("ent-1");
      expect(loaded!.state.state).toBe("first");
    });

    it("preserves claimedAt date correctly", async () => {
      const claimedAt = new Date(1700000000000);
      await repo.save("ent-1", 1, makeEntity({ claimedBy: "agent-x", claimedAt }));
      const loaded = await repo.loadLatest("ent-1");
      expect(loaded!.state.claimedBy).toBe("agent-x");
      expect(loaded!.state.claimedAt).toEqual(claimedAt);
    });

    it("isolates snapshots by entityId", async () => {
      await repo.save("ent-1", 1, makeEntity({ id: "ent-1", state: "alpha" }));
      await repo.save("ent-2", 1, makeEntity({ id: "ent-2", state: "beta" }));
      const r1 = await repo.loadLatest("ent-1");
      const r2 = await repo.loadLatest("ent-2");
      expect(r1!.state.state).toBe("alpha");
      expect(r2!.state.state).toBe("beta");
    });
  });
});
