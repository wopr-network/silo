import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../../src/repositories/drizzle/schema.js";
import { DrizzleGateRepository } from "../../../src/repositories/drizzle/gate.repo.js";

function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE flow_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      entity_schema TEXT,
      initial_state TEXT NOT NULL,
      max_concurrent INTEGER DEFAULT 0,
      max_concurrent_per_repo INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      created_by TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE gate_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      command TEXT,
      function_ref TEXT,
      api_config TEXT,
      timeout_ms INTEGER DEFAULT 30000,
      failure_prompt TEXT,
      timeout_prompt TEXT
    );
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL REFERENCES flow_definitions(id),
      state TEXT NOT NULL,
      refs TEXT,
      artifacts TEXT,
      claimed_by TEXT,
      claimed_at INTEGER,
      flow_version INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE gate_results (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      gate_id TEXT NOT NULL REFERENCES gate_definitions(id),
      passed INTEGER NOT NULL,
      output TEXT,
      evaluated_at INTEGER
    );
  `);
  return { db, sqlite };
}

describe("DrizzleGateRepository", () => {
  let repo: DrizzleGateRepository;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    repo = new DrizzleGateRepository(testDb.db);
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("create()", () => {
    it("should create a shell gate with generated id", async () => {
      const gate = await repo.create({
        name: "lint-check",
        type: "shell",
        command: "npm run lint",
      });

      expect(gate.id).toBeDefined();
      expect(gate.name).toBe("lint-check");
      expect(gate.type).toBe("shell");
      expect(gate.command).toBe("npm run lint");
      expect(gate.functionRef).toBeNull();
      expect(gate.apiConfig).toBeNull();
      expect(gate.timeoutMs).toBe(30000);
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

  function seedEntity(db: Database.Database, flowId = "flow-1", entityId = "entity-1") {
    db.prepare("INSERT INTO flow_definitions (id, name, initial_state) VALUES (?, ?, ?)").run(
      flowId,
      `flow-${flowId}`,
      "init",
    );
    db.prepare(
      "INSERT INTO entities (id, flow_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(entityId, flowId, "init", Date.now(), Date.now());
  }

  describe("record()", () => {
    it("should record a gate result", async () => {
      seedEntity(sqlite);
      const gate = await repo.create({ name: "lint", type: "shell", command: "npm run lint" });

      const result = await repo.record("entity-1", gate.id, true, "All checks passed");

      expect(result.id).toBeDefined();
      expect(result.entityId).toBe("entity-1");
      expect(result.gateId).toBe(gate.id);
      expect(result.passed).toBe(true);
      expect(result.output).toBe("All checks passed");
      expect(result.evaluatedAt).toBeInstanceOf(Date);
    });

    it("should store multiple results for same entity+gate (history)", async () => {
      seedEntity(sqlite);
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
      seedEntity(sqlite);
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
      seedEntity(sqlite);
      const results = await repo.resultsFor("entity-1");
      expect(results).toEqual([]);
    });

    it("should only return results for the specified entity", async () => {
      seedEntity(sqlite, "flow-1", "entity-1");
      sqlite
        .prepare(
          "INSERT INTO entities (id, flow_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("entity-2", "flow-1", "init", Date.now(), Date.now());

      const gate = await repo.create({ name: "check", type: "shell", command: "true" });
      await repo.record("entity-1", gate.id, true, "ok");
      await repo.record("entity-2", gate.id, false, "fail");

      const results = await repo.resultsFor("entity-1");
      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe("entity-1");
    });
  });
});
