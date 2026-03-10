import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../../helpers/pg-test-db.js";
import { DrizzleTransitionLogRepository } from "../../../src/repositories/drizzle/transition-log.repo.js";
import { entities, flowDefinitions } from "../../../src/repositories/drizzle/schema.js";

let db: TestDb;
let close: () => Promise<void>;
let repo: DrizzleTransitionLogRepository;
let entityId1: string;
let entityId2: string;

const TENANT = "test-tenant";
const FLOW_ID = "flow-1";

async function seedFlowAndEntities() {
  await db.insert(flowDefinitions).values({
    id: FLOW_ID,
    tenantId: TENANT,
    name: "test-flow",
    initialState: "open",
  });
  entityId1 = randomUUID();
  entityId2 = randomUUID();
  await db.insert(entities).values({
    id: entityId1,
    tenantId: TENANT,
    flowId: FLOW_ID,
    state: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.insert(entities).values({
    id: entityId2,
    tenantId: TENANT,
    flowId: FLOW_ID,
    state: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

beforeEach(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  close = testDb.close;
  repo = new DrizzleTransitionLogRepository(db, TENANT);
  await seedFlowAndEntities();
});

afterEach(async () => {
  await close();
});

describe("DrizzleTransitionLogRepository", () => {
  describe("record", () => {
    it("records a transition and returns it with an id", async () => {
      const now = new Date();
      const result = await repo.record({
        entityId: entityId1,
        fromState: "open",
        toState: "in_progress",
        trigger: "claim",
        invocationId: null,
        timestamp: now,
      });

      expect(result.id).toBeTypeOf("string");
      expect(result.entityId).toBe(entityId1);
      expect(result.fromState).toBe("open");
      expect(result.toState).toBe("in_progress");
      expect(result.trigger).toBe("claim");
      expect(result.invocationId).toBeNull();
      expect(result.timestamp).toEqual(now);
    });

    it("records a transition with null fromState (initial transition)", async () => {
      const result = await repo.record({
        entityId: entityId1,
        fromState: null,
        toState: "open",
        trigger: null,
        invocationId: null,
        timestamp: new Date(),
      });

      expect(result.fromState).toBeNull();
      expect(result.trigger).toBeNull();
    });
  });

  describe("historyFor", () => {
    it("returns history ordered by timestamp ascending", async () => {
      const t1 = new Date("2026-01-01T00:00:00Z");
      const t2 = new Date("2026-01-01T01:00:00Z");
      const t3 = new Date("2026-01-01T02:00:00Z");

      // Insert out of order to verify sorting
      await repo.record({
        entityId: entityId1,
        fromState: "in_progress",
        toState: "done",
        trigger: "complete",
        invocationId: null,
        timestamp: t3,
      });
      await repo.record({
        entityId: entityId1,
        fromState: null,
        toState: "open",
        trigger: null,
        invocationId: null,
        timestamp: t1,
      });
      await repo.record({
        entityId: entityId1,
        fromState: "open",
        toState: "in_progress",
        trigger: "claim",
        invocationId: null,
        timestamp: t2,
      });

      const history = await repo.historyFor(entityId1);

      expect(history).toHaveLength(3);
      expect(history[0].toState).toBe("open");
      expect(history[1].toState).toBe("in_progress");
      expect(history[2].toState).toBe("done");
      expect(history[0].timestamp).toBeInstanceOf(Date);
      expect(history[0].timestamp.getTime()).toBe(t1.getTime());
      expect(history[1].timestamp.getTime()).toBe(t2.getTime());
      expect(history[2].timestamp.getTime()).toBe(t3.getTime());
    });

    it("returns only history for the requested entity", async () => {
      const now = new Date();
      await repo.record({
        entityId: entityId1,
        fromState: null,
        toState: "open",
        trigger: null,
        invocationId: null,
        timestamp: now,
      });
      await repo.record({
        entityId: entityId2,
        fromState: null,
        toState: "open",
        trigger: null,
        invocationId: null,
        timestamp: now,
      });

      const history1 = await repo.historyFor(entityId1);
      const history2 = await repo.historyFor(entityId2);

      expect(history1).toHaveLength(1);
      expect(history1[0].entityId).toBe(entityId1);
      expect(history2).toHaveLength(1);
      expect(history2[0].entityId).toBe(entityId2);
    });

    it("returns empty array for unknown entity", async () => {
      const history = await repo.historyFor("nonexistent");
      expect(history).toEqual([]);
    });

    it("records multiple entries for the same entity with unique ids", async () => {
      const base = Date.now();
      for (let i = 0; i < 5; i++) {
        await repo.record({
          entityId: entityId1,
          fromState: `state-${i}`,
          toState: `state-${i + 1}`,
          trigger: `trigger-${i}`,
          invocationId: null,
          timestamp: new Date(base + i * 1000),
        });
      }

      const history = await repo.historyFor(entityId1);
      expect(history).toHaveLength(5);
      const ids = history.map((h) => h.id);
      expect(new Set(ids).size).toBe(5);
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp.getTime()).toBeGreaterThan(history[i - 1].timestamp.getTime());
      }
    });

    it("round-trips timestamp through epoch storage", async () => {
      const ts = new Date("2026-03-07T12:34:56.000Z");
      await repo.record({
        entityId: entityId1,
        fromState: "a",
        toState: "b",
        trigger: "go",
        invocationId: null,
        timestamp: ts,
      });

      const history = await repo.historyFor(entityId1);
      expect(history[0].timestamp.getTime()).toBe(ts.getTime());
    });
  });
});
