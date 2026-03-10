import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../../helpers/pg-test-db.js";
import { DrizzleGateRepository } from "../../../src/repositories/drizzle/gate.repo.js";
import { entities, flowDefinitions } from "../../../src/repositories/drizzle/schema.js";

let db: TestDb;
let close: () => Promise<void>;
let repo: DrizzleGateRepository;

const TENANT = "test-tenant";

async function seedEntity(flowId = "flow-1", entityId = "entity-1") {
  await db.insert(flowDefinitions).values({
    id: flowId,
    tenantId: TENANT,
    name: `flow-${flowId}`,
    initialState: "init",
  });
  await db.insert(entities).values({
    id: entityId,
    tenantId: TENANT,
    flowId,
    state: "init",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

beforeEach(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  close = testDb.close;
  repo = new DrizzleGateRepository(db, TENANT);
});

afterEach(async () => {
  await close();
});

describe("DrizzleGateRepository", () => {
  describe("create()", () => {
    it("should create a shell gate with generated id", async () => {
      const gate = await repo.create({
        name: "lint-check",
        type: "shell",
        command: "npm run lint",
      });

      expect(typeof gate.id).toBe("string");
      expect(gate.id.length).toBeGreaterThan(0);
      expect(gate.name).toBe("lint-check");
      expect(gate.type).toBe("shell");
      expect(gate.command).toBe("npm run lint");
      expect(gate.functionRef).toBeNull();
      expect(gate.apiConfig).toBeNull();
      expect(gate.timeoutMs).toBeNull();
    });

    it("should create a function gate", async () => {
      const gate = await repo.create({
        name: "coverage-check",
        type: "function",
        functionRef: "checks/coverage",
        timeoutMs: 60000,
      });

      expect(gate.type).toBe("function");
      expect(gate.functionRef).toBe("checks/coverage");
      expect(gate.timeoutMs).toBe(60000);
    });

    it("should create an api gate", async () => {
      const gate = await repo.create({
        name: "sonar-gate",
        type: "api",
        apiConfig: { url: "https://sonar.example.com/api/check", method: "POST" },
      });

      expect(gate.type).toBe("api");
      expect(gate.apiConfig).toEqual({ url: "https://sonar.example.com/api/check", method: "POST" });
    });
  });

  describe("get()", () => {
    it("should return gate by id", async () => {
      const created = await repo.create({ name: "test-gate", type: "shell", command: "echo ok" });
      const fetched = await repo.get(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe("test-gate");
    });

    it("should return null for unknown id", async () => {
      const result = await repo.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getByName()", () => {
    it("should return gate by name", async () => {
      await repo.create({ name: "unique-gate", type: "shell", command: "true" });
      const fetched = await repo.getByName("unique-gate");

      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("unique-gate");
    });

    it("should return null for unknown name", async () => {
      const result = await repo.getByName("no-such-gate");
      expect(result).toBeNull();
    });
  });

  describe("record()", () => {
    it("should record a gate result", async () => {
      await seedEntity();
      const gate = await repo.create({ name: "lint", type: "shell", command: "npm run lint" });

      const result = await repo.record("entity-1", gate.id, true, "All checks passed");

      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.entityId).toBe("entity-1");
      expect(result.gateId).toBe(gate.id);
      expect(result.passed).toBe(true);
      expect(result.output).toBe("All checks passed");
      expect(result.evaluatedAt).toBeInstanceOf(Date);
    });

    it("should store multiple results for same entity+gate (history)", async () => {
      await seedEntity();
      const gate = await repo.create({ name: "test", type: "shell", command: "npm test" });

      await repo.record("entity-1", gate.id, false, "3 tests failed");
      await repo.record("entity-1", gate.id, true, "All tests passed");

      const results = await repo.resultsFor("entity-1");
      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(false);
      expect(results[1].passed).toBe(true);
    });
  });

  describe("resultsFor()", () => {
    it("should return results in chronological order", async () => {
      await seedEntity();
      const gate = await repo.create({ name: "build", type: "shell", command: "npm run build" });

      await repo.record("entity-1", gate.id, false, "build failed");
      await repo.record("entity-1", gate.id, false, "still failing");
      await repo.record("entity-1", gate.id, true, "build passed");

      const results = await repo.resultsFor("entity-1");
      expect(results).toHaveLength(3);
      expect(results[0].output).toBe("build failed");
      expect(results[1].output).toBe("still failing");
      expect(results[2].output).toBe("build passed");
      for (let i = 1; i < results.length; i++) {
        expect(results[i].evaluatedAt!.getTime()).toBeGreaterThanOrEqual(
          results[i - 1].evaluatedAt!.getTime(),
        );
      }
    });

    it("should return empty array for entity with no results", async () => {
      await seedEntity();
      const results = await repo.resultsFor("entity-1");
      expect(results).toEqual([]);
    });

    it("should only return results for the specified entity", async () => {
      await seedEntity("flow-1", "entity-1");
      await db.insert(entities).values({
        id: "entity-2",
        tenantId: TENANT,
        flowId: "flow-1",
        state: "init",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const gate = await repo.create({ name: "check", type: "shell", command: "true" });
      await repo.record("entity-1", gate.id, true, "ok");
      await repo.record("entity-2", gate.id, false, "fail");

      const results = await repo.resultsFor("entity-1");
      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe("entity-1");
    });
  });
});
