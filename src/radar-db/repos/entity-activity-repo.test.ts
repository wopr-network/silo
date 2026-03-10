import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/helpers/pg-test-db.js";
import { DrizzleEntityActivityRepo } from "./drizzle-entity-activity-repo.js";

let db: TestDb;
let close: () => Promise<void>;
let repo: DrizzleEntityActivityRepo;

beforeEach(async () => {
  const res = await createTestDb();
  db = res.db;
  close = res.close;
  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  repo = new DrizzleEntityActivityRepo(db as any, "test-tenant");
});

afterEach(async () => {
  await close();
});

describe("EntityActivityRepo", () => {
  describe("insert", () => {
    it("stores the row with auto seq=0 for first insert", async () => {
      await repo.insert({
        entityId: "e1",
        slotId: "slot-1",
        type: "tool_use",
        data: { name: "Read", input: { file_path: "/foo.ts" } },
      });
      const rows = await repo.getByEntity("e1");
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.entityId).toBe("e1");
      expect(row.slotId).toBe("slot-1");
      expect(row.seq).toBe(0);
      expect(row.type).toBe("tool_use");
      expect(row.data).toEqual({ name: "Read", input: { file_path: "/foo.ts" } });
      expect(row.id).toBeTruthy();
      expect(row.createdAt).toBeGreaterThan(0);
    });

    it("auto-increments seq per entity", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      await repo.insert({ entityId: "e1", slotId: "s1", type: "tool_use", data: {} });
      await repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      const rows = await repo.getByEntity("e1");
      expect(rows[0].seq).toBe(0);
      expect(rows[1].seq).toBe(1);
      expect(rows[2].seq).toBe(2);
    });

    it("seq is scoped per entity", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      await repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      await repo.insert({ entityId: "e2", slotId: "s2", type: "start", data: {} });
      const rows = await repo.getByEntity("e2");
      expect(rows[0].seq).toBe(0);
    });
  });

  describe("getByEntity", () => {
    it("returns rows in seq order", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      await repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      await repo.insert({ entityId: "e1", slotId: "s1", type: "tool_use", data: {} });
      const rows = await repo.getByEntity("e1");
      expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    });

    it("filters by since (exclusive)", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.insert({ entityId: "e1", slotId: "s1", type: "text", data: { text: `line ${i}` } });
      }
      const rows = await repo.getByEntity("e1", 2);
      expect(rows.map((r) => r.seq)).toEqual([3, 4]);
    });

    it("returns empty array for unknown entity", async () => {
      expect(await repo.getByEntity("nobody")).toEqual([]);
    });
  });

  describe("getSummary", () => {
    it("returns empty string when no activity", async () => {
      expect(await repo.getSummary("e1")).toBe("");
    });

    it("skips tool_use events from summary", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      await repo.insert({
        entityId: "e1",
        slotId: "s1",
        type: "tool_use",
        data: { name: "Read", input: { file_path: "/src/foo.ts" } },
      });
      await repo.insert({
        entityId: "e1",
        slotId: "s1",
        type: "result",
        data: { subtype: "success", cost_usd: 0.001 },
      });
      const summary = await repo.getSummary("e1");
      expect(summary).not.toContain("Called tool");
      expect(summary).toContain("Ended: success");
    });

    it("groups by slotId as separate attempts", async () => {
      await repo.insert({ entityId: "e1", slotId: "slot-a", type: "start", data: {} });
      await repo.insert({ entityId: "e1", slotId: "slot-a", type: "result", data: { subtype: "error" } });
      await repo.insert({ entityId: "e1", slotId: "slot-b", type: "start", data: {} });
      await repo.insert({ entityId: "e1", slotId: "slot-b", type: "result", data: { subtype: "success" } });
      const summary = await repo.getSummary("e1");
      expect(summary).toContain("Attempt 1:");
      expect(summary).toContain("Attempt 2:");
    });

    it("includes prose wrapping", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      const summary = await repo.getSummary("e1");
      expect(summary).toContain("Prior work on this entity:");
      expect(summary).toContain("pick up where the last attempt left off");
    });
  });

  describe("deleteByEntity", () => {
    it("removes all rows for entity", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      await repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      await repo.deleteByEntity("e1");
      expect(await repo.getByEntity("e1")).toEqual([]);
    });

    it("does not affect other entities", async () => {
      await repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      await repo.insert({ entityId: "e2", slotId: "s2", type: "start", data: {} });
      await repo.deleteByEntity("e1");
      expect(await repo.getByEntity("e2")).toHaveLength(1);
    });
  });
});
