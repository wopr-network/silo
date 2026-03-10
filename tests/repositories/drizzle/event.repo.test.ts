import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../../helpers/pg-test-db.js";
import { DrizzleEventRepository } from "../../../src/repositories/drizzle/event.repo.js";
import { events as eventsTable } from "../../../src/repositories/drizzle/schema.js";

let db: TestDb;
let close: () => Promise<void>;
let repo: DrizzleEventRepository;

const TENANT = "test-tenant";

beforeEach(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  close = testDb.close;
  repo = new DrizzleEventRepository(db, TENANT);
});

afterEach(async () => {
  await close();
});

describe("DrizzleEventRepository", () => {
  describe("emitDefinitionChanged", () => {
    it("inserts a definition.changed event with flowId", async () => {
      await repo.emitDefinitionChanged("flow-1", "flow.create", { name: "test-flow" });

      const rows = await repo.findAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("definition.changed");
      expect(rows[0].flowId).toBe("flow-1");
      expect(rows[0].entityId).toBeNull();
      expect(rows[0].payload).toEqual({ tool: "flow.create", name: "test-flow" });
      expect(rows[0].emittedAt).toBeTypeOf("number");
      expect(rows[0].id).toBeTypeOf("string");
    });

    it("inserts a definition.changed event with null flowId", async () => {
      await repo.emitDefinitionChanged(null, "gate.create", { gateName: "lint" });

      const rows = await repo.findAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].flowId).toBeNull();
      expect(rows[0].payload).toEqual({ tool: "gate.create", gateName: "lint" });
    });

    it("coerces empty string flowId to null", async () => {
      await repo.emitDefinitionChanged("", "flow.update", {});

      const rows = await repo.findAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].flowId).toBeNull();
    });

    it("inserts multiple events with unique ids", async () => {
      await repo.emitDefinitionChanged("flow-1", "flow.create", { a: 1 });
      await repo.emitDefinitionChanged("flow-1", "state.add", { b: 2 });
      await repo.emitDefinitionChanged("flow-2", "flow.create", { c: 3 });

      const rows = await repo.findAll();
      expect(rows).toHaveLength(3);
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("stores emittedAt as a recent timestamp", async () => {
      const before = Date.now();
      await repo.emitDefinitionChanged("flow-1", "flow.create", {});
      const after = Date.now();

      const rows = await repo.findAll();
      expect(rows[0].emittedAt).toBeGreaterThanOrEqual(before);
      expect(rows[0].emittedAt).toBeLessThanOrEqual(after);
    });

    it("handles complex nested payload objects", async () => {
      const payload = { nested: { key: "value" }, arr: [1, 2, 3], flag: true };
      await repo.emitDefinitionChanged("flow-1", "flow.update", payload);

      const rows = await repo.findAll();
      expect(rows[0].payload).toEqual({ tool: "flow.update", ...payload });
    });
  });

  describe("findByEntity", () => {
    it("returns events for the given entityId", async () => {
      await repo.emitDefinitionChanged("flow-1", "flow.create", { entityId: "e1" });
      // Insert a raw event with an entityId via the events table directly
      await db.insert(eventsTable).values({
        id: randomUUID(),
        tenantId: TENANT,
        type: "entity.created",
        entityId: "e1",
        flowId: "f1",
        payload: {},
        emittedAt: Date.now(),
      });
      await db.insert(eventsTable).values({
        id: randomUUID(),
        tenantId: TENANT,
        type: "entity.created",
        entityId: "e2",
        flowId: "f1",
        payload: {},
        emittedAt: Date.now(),
      });

      const rows = await repo.findByEntity("e1");
      expect(rows.every((r) => r.entityId === "e1")).toBe(true);
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await db.insert(eventsTable).values({
          id: randomUUID(),
          tenantId: TENANT,
          type: "entity.updated",
          entityId: "e3",
          flowId: null,
          payload: {},
          emittedAt: Date.now() + i,
        });
      }
      const rows = await repo.findByEntity("e3", 3);
      expect(rows).toHaveLength(3);
    });
  });

  describe("findRecent", () => {
    it("returns all events up to the limit", async () => {
      for (let i = 0; i < 5; i++) {
        await db.insert(eventsTable).values({
          id: randomUUID(),
          tenantId: TENANT,
          type: "entity.created",
          entityId: `e${i}`,
          flowId: null,
          payload: {},
          emittedAt: Date.now() + i,
        });
      }
      const rows = await repo.findRecent(3);
      expect(rows).toHaveLength(3);
    });

    it("returns events ordered by emittedAt descending", async () => {
      await db.insert(eventsTable).values({
        id: randomUUID(),
        tenantId: TENANT,
        type: "entity.created",
        entityId: "ea",
        flowId: null,
        payload: {},
        emittedAt: 1000,
      });
      await db.insert(eventsTable).values({
        id: randomUUID(),
        tenantId: TENANT,
        type: "entity.created",
        entityId: "eb",
        flowId: null,
        payload: {},
        emittedAt: 3000,
      });
      await db.insert(eventsTable).values({
        id: randomUUID(),
        tenantId: TENANT,
        type: "entity.created",
        entityId: "ec",
        flowId: null,
        payload: {},
        emittedAt: 2000,
      });

      const rows = await repo.findRecent(10);
      expect(rows[0].emittedAt).toBeGreaterThanOrEqual(rows[1].emittedAt);
      expect(rows[1].emittedAt).toBeGreaterThanOrEqual(rows[2].emittedAt);
    });
  });
});
