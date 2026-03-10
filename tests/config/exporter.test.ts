import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import { exportSeed } from "../../src/config/exporter.js";
import { loadSeed } from "../../src/config/seed-loader.js";
import { SeedFileSchema } from "../../src/config/zod-schemas.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";

const TEST_TENANT = "test-tenant";

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
  let db: TestDb;
  let close: () => Promise<void>;
  let flowRepo: DrizzleFlowRepository;
  let gateRepo: DrizzleGateRepository;

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;
    flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
    gateRepo = new DrizzleGateRepository(db, TEST_TENANT);
  });

  afterEach(async () => {
    await close();
  });

  it("exports current DB state as a valid SeedFile", async () => {
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
  });

  it("exports empty DB as minimal valid structure", async () => {
    const exported = await exportSeed(flowRepo, gateRepo);

    expect(exported.flows).toEqual([]);
    expect(exported.states).toEqual([]);
    expect(exported.gates).toEqual([]);
    expect(exported.transitions).toEqual([]);
  });

  it("round-trip: load -> export -> load produces same state", async () => {
    const seedPath = writeSeedFile(validSeed);
    await loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot });

    const exported = await exportSeed(flowRepo, gateRepo);

    // Create a second DB for the round-trip
    const res2 = await createTestDb();
    const flowRepo2 = new DrizzleFlowRepository(res2.db, TEST_TENANT);
    const gateRepo2 = new DrizzleGateRepository(res2.db, TEST_TENANT);
    const exportPath = writeSeedFile(exported);
    await loadSeed(exportPath, flowRepo2, gateRepo2, { allowedRoot: tmpRoot });

    const reExported = await exportSeed(flowRepo2, gateRepo2);

    expect(reExported.flows.length).toBe(exported.flows.length);
    expect(reExported.states.length).toBe(exported.states.length);
    expect(reExported.gates.length).toBe(exported.gates.length);
    expect(reExported.transitions.length).toBe(exported.transitions.length);

    expect(reExported.flows.map((f) => f.name).sort()).toEqual(exported.flows.map((f) => f.name).sort());
    expect(reExported.gates.map((g) => g.name).sort()).toEqual(exported.gates.map((g) => g.name).sort());

    await res2.close();
  });
});
