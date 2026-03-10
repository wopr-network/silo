import { describe, it, expect, afterEach } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "../../../src/repositories/drizzle/schema.js";
import { createTestDb, type TestDb } from "../../helpers/pg-test-db.js";

describe("schema tables exist", () => {
  it("exports flowDefinitions table", () => {
    expect(schema.flowDefinitions).toBeDefined();
    expect(typeof schema.flowDefinitions).toBe("object");
    expect(getTableName(schema.flowDefinitions)).toBe("flow_definitions");
  });

  it("exports stateDefinitions table", () => {
    expect(schema.stateDefinitions).toBeDefined();
    expect(typeof schema.stateDefinitions).toBe("object");
    expect(getTableName(schema.stateDefinitions)).toBe("state_definitions");
  });

  it("exports transitionRules table", () => {
    expect(schema.transitionRules).toBeDefined();
    expect(typeof schema.transitionRules).toBe("object");
    expect(getTableName(schema.transitionRules)).toBe("transition_rules");
  });

  it("exports gateDefinitions table", () => {
    expect(schema.gateDefinitions).toBeDefined();
    expect(typeof schema.gateDefinitions).toBe("object");
    expect(getTableName(schema.gateDefinitions)).toBe("gate_definitions");
  });

  it("exports flowVersions table", () => {
    expect(schema.flowVersions).toBeDefined();
    expect(typeof schema.flowVersions).toBe("object");
    expect(getTableName(schema.flowVersions)).toBe("flow_versions");
  });

  it("exports entities table", () => {
    expect(schema.entities).toBeDefined();
    expect(typeof schema.entities).toBe("object");
    expect(getTableName(schema.entities)).toBe("entities");
  });

  it("exports invocations table", () => {
    expect(schema.invocations).toBeDefined();
    expect(typeof schema.invocations).toBe("object");
    expect(getTableName(schema.invocations)).toBe("invocations");
  });

  it("exports gateResults table", () => {
    expect(schema.gateResults).toBeDefined();
    expect(typeof schema.gateResults).toBe("object");
    expect(getTableName(schema.gateResults)).toBe("gate_results");
  });

  it("exports entityHistory table", () => {
    expect(schema.entityHistory).toBeDefined();
    expect(typeof schema.entityHistory).toBe("object");
    expect(getTableName(schema.entityHistory)).toBe("entity_history");
  });

  it("exports events table", () => {
    expect(schema.events).toBeDefined();
    expect(typeof schema.events).toBe("object");
    expect(getTableName(schema.events)).toBe("events");
  });
});

describe("Postgres bootstrap", () => {
  let close: () => Promise<void>;

  afterEach(async () => {
    if (close) await close();
  });

  it("createTestDb runs migrations and creates all tables", async () => {
    const res = await createTestDb();
    close = res.close;
    const db = res.db;

    // Verify we can query a table (proves migrations ran)
    const rows = await db.select().from(schema.flowDefinitions);
    expect(rows).toEqual([]);
  });

  it("all 19 tables are created", async () => {
    const res = await createTestDb();
    close = res.close;

    // Query pg_tables for our tables
    const result = await res.client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const tableNames = result.rows.map((r: { tablename: string }) => r.tablename);
    expect(tableNames).toContain("flow_definitions");
    expect(tableNames).toContain("entities");
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("domain_events");
    expect(tableNames).toContain("entity_activity");
    expect(tableNames.length).toBeGreaterThanOrEqual(19);
  });
});
