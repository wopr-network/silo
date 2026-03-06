import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { exportSeed } from "../../src/config/exporter.js";
import { loadSeed } from "../../src/config/seed-loader.js";
import { SeedFileSchema } from "../../src/config/zod-schemas.js";
import * as schema from "../../src/repositories/drizzle/schema.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";
import { DrizzleIntegrationConfigRepository } from "../../src/repositories/drizzle/integration-config.repo.js";

function setupDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const flowRepo = new DrizzleFlowRepository(db);
  const gateRepo = new DrizzleGateRepository(db);
  const integrationRepo = new DrizzleIntegrationConfigRepository(db);
  return { db, sqlite, flowRepo, gateRepo, integrationRepo };
}

function writeSeedFile(seed: unknown): string {
  const dir = join(tmpdir(), `export-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "seed.json");
  writeFileSync(path, JSON.stringify(seed));
  return path;
}

const validSeed = {
  flows: [{ name: "pr-review", initialState: "open" }],
  states: [
    { name: "open", flowName: "pr-review" },
    { name: "reviewing", flowName: "pr-review" },
  ],
  gates: [{ name: "lint-pass", type: "command" as const, command: "pnpm lint" }],
  transitions: [
    {
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
      trigger: "claim",
      gateName: "lint-pass",
    },
  ],
  integrations: [{ capability: "notifications", adapter: "discord", config: { webhookUrl: "https://example.com" } }],
};

describe("exportSeed", () => {
  it("exports current DB state as a valid SeedFile", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();
    const seedPath = writeSeedFile(validSeed);
    await loadSeed(seedPath, flowRepo, gateRepo, integrationRepo, sqlite);

    const exported = await exportSeed(flowRepo, gateRepo, integrationRepo);

    const result = SeedFileSchema.safeParse(exported);
    expect(result.success).toBe(true);

    expect(exported.flows).toHaveLength(1);
    expect(exported.flows[0].name).toBe("pr-review");
    expect(exported.states).toHaveLength(2);
    expect(exported.gates).toHaveLength(1);
    expect(exported.gates[0].name).toBe("lint-pass");
    expect(exported.transitions).toHaveLength(1);
    expect(exported.transitions[0].gateName).toBe("lint-pass");
    expect(exported.integrations).toHaveLength(1);

    sqlite.close();
  });

  it("exports empty DB as minimal valid structure", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();

    const exported = await exportSeed(flowRepo, gateRepo, integrationRepo);

    expect(exported.flows).toEqual([]);
    expect(exported.states).toEqual([]);
    expect(exported.gates).toEqual([]);
    expect(exported.transitions).toEqual([]);
    expect(exported.integrations).toEqual([]);

    sqlite.close();
  });

  it("round-trip: load -> export -> load produces same state", async () => {
    const sqlite1 = new Database(":memory:");
    const db1 = drizzle(sqlite1, { schema });
    migrate(db1, { migrationsFolder: "./drizzle" });
    const flowRepo1 = new DrizzleFlowRepository(db1);
    const gateRepo1 = new DrizzleGateRepository(db1);
    const integrationRepo1 = new DrizzleIntegrationConfigRepository(db1);
    const seedPath = writeSeedFile(validSeed);
    await loadSeed(seedPath, flowRepo1, gateRepo1, integrationRepo1, sqlite1);

    const exported = await exportSeed(flowRepo1, gateRepo1, integrationRepo1);

    const sqlite2 = new Database(":memory:");
    const db2 = drizzle(sqlite2, { schema });
    migrate(db2, { migrationsFolder: "./drizzle" });
    const flowRepo2 = new DrizzleFlowRepository(db2);
    const gateRepo2 = new DrizzleGateRepository(db2);
    const integrationRepo2 = new DrizzleIntegrationConfigRepository(db2);
    const exportPath = writeSeedFile(exported);
    await loadSeed(exportPath, flowRepo2, gateRepo2, integrationRepo2, sqlite2);

    const reExported = await exportSeed(flowRepo2, gateRepo2, integrationRepo2);

    expect(reExported.flows.length).toBe(exported.flows.length);
    expect(reExported.states.length).toBe(exported.states.length);
    expect(reExported.gates.length).toBe(exported.gates.length);
    expect(reExported.transitions.length).toBe(exported.transitions.length);
    expect(reExported.integrations.length).toBe(exported.integrations.length);

    expect(reExported.flows.map((f) => f.name).sort()).toEqual(exported.flows.map((f) => f.name).sort());
    expect(reExported.gates.map((g) => g.name).sort()).toEqual(exported.gates.map((g) => g.name).sort());

    sqlite1.close();
    sqlite2.close();
  });
});
