import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
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

function setupDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  const flowRepo = new DrizzleFlowRepository(db);
  const gateRepo = new DrizzleGateRepository(db);
  return { db, sqlite, flowRepo, gateRepo };
}

function writeSeedFile(seed: unknown): string {
  const dir = join(tmpdir(), `export-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "seed.json");
  writeFileSync(path, JSON.stringify(seed));
  return path;
}

const validSeed = {
  flows: [{ name: "pr-review", initialState: "open", discipline: "engineering" }],
  states: [
    { name: "open", flowName: "pr-review" },
    { name: "reviewing", flowName: "pr-review" },
  ],
  gates: [{ name: "lint-pass", type: "command" as const, command: "gates/blocking-graph.ts" }],
  transitions: [
    {
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
      trigger: "claim",
      gateName: "lint-pass",
    },
  ],
};

const tmpRoot = realpathSync(tmpdir());

describe("exportSeed", () => {
  it("exports current DB state as a valid SeedFile", async () => {
    const { db, sqlite, flowRepo, gateRepo } = setupDb();
    const seedPath = writeSeedFile(validSeed);
    await loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot });

    const exported = await exportSeed(flowRepo, gateRepo);

    const result = SeedFileSchema.safeParse(exported);
    expect(result.success).toBe(true);

    expect(exported.flows).toHaveLength(1);
    expect(exported.flows[0].name).toBe("pr-review");
    expect(exported.states).toHaveLength(2);
    expect(exported.gates).toHaveLength(1);
    expect(exported.gates[0].name).toBe("lint-pass");
    expect(exported.transitions).toHaveLength(1);
    expect(exported.transitions[0].gateName).toBe("lint-pass");

    sqlite.close();
  });

  it("exports empty DB as minimal valid structure", async () => {
    const { sqlite, flowRepo, gateRepo } = setupDb();

    const exported = await exportSeed(flowRepo, gateRepo);

    expect(exported.flows).toEqual([]);
    expect(exported.states).toEqual([]);
    expect(exported.gates).toEqual([]);
    expect(exported.transitions).toEqual([]);

    sqlite.close();
  });

  it("round-trip: load -> export -> load produces same state", async () => {
    const sqlite1 = new Database(":memory:");
    const db1 = drizzle(sqlite1, { schema });
    migrate(db1, { migrationsFolder: "./drizzle" });
    const flowRepo1 = new DrizzleFlowRepository(db1);
    const gateRepo1 = new DrizzleGateRepository(db1);
    const seedPath = writeSeedFile(validSeed);
    await loadSeed(seedPath, flowRepo1, gateRepo1, { allowedRoot: tmpRoot });

    const exported = await exportSeed(flowRepo1, gateRepo1);

    const sqlite2 = new Database(":memory:");
    const db2 = drizzle(sqlite2, { schema });
    migrate(db2, { migrationsFolder: "./drizzle" });
    const flowRepo2 = new DrizzleFlowRepository(db2);
    const gateRepo2 = new DrizzleGateRepository(db2);
    const exportPath = writeSeedFile(exported);
    await loadSeed(exportPath, flowRepo2, gateRepo2, { allowedRoot: tmpRoot });

    const reExported = await exportSeed(flowRepo2, gateRepo2);

    expect(reExported.flows.length).toBe(exported.flows.length);
    expect(reExported.states.length).toBe(exported.states.length);
    expect(reExported.gates.length).toBe(exported.gates.length);
    expect(reExported.transitions.length).toBe(exported.transitions.length);

    expect(reExported.flows.map((f) => f.name).sort()).toEqual(exported.flows.map((f) => f.name).sort());
    expect(reExported.gates.map((g) => g.name).sort()).toEqual(exported.gates.map((g) => g.name).sort());

    sqlite1.close();
    sqlite2.close();
  });
});
