import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "../../../src/repositories/drizzle/schema.js";
import { createDatabase, bootstrap } from "../../../src/main.js";

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

describe("foreign keys enforcement", () => {
  it("createDatabase enables foreign_keys pragma", () => {
    const { sqlite } = createDatabase(":memory:");
    const result = sqlite.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
    sqlite.close();
  });
});

describe("migration", () => {
  it("bootstrap runs migrations without error", () => {
    const { sqlite } = bootstrap(":memory:");
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name).filter((n) => !n.startsWith("__"));
    expect(tableNames).toContain("flow_definitions");
    expect(tableNames).toContain("entities");
    expect(tableNames).toContain("events");
    expect(tableNames.length).toBeGreaterThanOrEqual(10);
    sqlite.close();
  });
});
