import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadSeed } from "../../src/config/seed-loader.js";
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
  const dir = join(tmpdir(), `seed-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "seed.json");
  writeFileSync(path, JSON.stringify(seed));
  return path;
}

const validSeed = {
  flows: [{ name: "pr-review", initialState: "open" }],
  states: [
    { name: "open", flowName: "pr-review", mode: "passive", promptTemplate: "Review this PR" },
    { name: "reviewing", flowName: "pr-review" },
  ],
  gates: [{ name: "lint-pass", type: "command", command: "pnpm lint" }],
  transitions: [
    {
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
      trigger: "claim",
      gateName: "lint-pass",
    },
  ],
  integrations: [
    { capability: "notifications", adapter: "discord", config: { webhookUrl: "https://example.com" } },
  ],
};

describe("loadSeed", () => {
  it("loads a valid seed file and creates all records", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();
    const seedPath = writeSeedFile(validSeed);

    const result = await loadSeed(seedPath, flowRepo, gateRepo, integrationRepo, sqlite);

    expect(result).toEqual({ flows: 1, gates: 1, integrations: 1 });

    const flow = await flowRepo.getByName("pr-review");
    expect(flow).not.toBeNull();
    expect(flow?.states).toHaveLength(2);
    expect(flow?.transitions).toHaveLength(1);
    expect(flow?.initialState).toBe("open");

    const gate = await gateRepo.getByName("lint-pass");
    expect(gate).not.toBeNull();
    expect(gate?.type).toBe("command");

    expect(flow?.transitions[0].gateId).toBe(gate?.id);

    const integrations = await integrationRepo.listAll();
    expect(integrations).toHaveLength(1);
    expect(integrations[0].capability).toBe("notifications");
    expect(integrations[0].adapter).toBe("discord");

    sqlite.close();
  });

  it("rejects invalid seed file with Zod errors", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();
    const seedPath = writeSeedFile({ flows: [], states: [], transitions: [] });

    await expect(loadSeed(seedPath, flowRepo, gateRepo, integrationRepo, sqlite)).rejects.toThrow();

    sqlite.close();
  });

  it("rejects non-existent file", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();

    await expect(loadSeed("/tmp/nonexistent-seed.json", flowRepo, gateRepo, integrationRepo, sqlite)).rejects.toThrow();

    sqlite.close();
  });

  it("loads seed without gates or integrations", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();
    const seed = {
      flows: [{ name: "simple", initialState: "start" }],
      states: [{ name: "start", flowName: "simple" }],
      transitions: [{ flowName: "simple", fromState: "start", toState: "start", trigger: "loop" }],
    };
    const seedPath = writeSeedFile(seed);

    const result = await loadSeed(seedPath, flowRepo, gateRepo, integrationRepo, sqlite);
    expect(result).toEqual({ flows: 1, gates: 0, integrations: 0 });

    sqlite.close();
  });

  it("throws a descriptive error when a transition references an unknown gate", async () => {
    const { sqlite, flowRepo, gateRepo, integrationRepo } = setupDb();
    const seed = {
      flows: [{ name: "broken", initialState: "start" }],
      states: [{ name: "start", flowName: "broken" }, { name: "end", flowName: "broken" }],
      gates: [],
      transitions: [
        { flowName: "broken", fromState: "start", toState: "end", trigger: "go", gateName: "nonexistent-gate" },
      ],
      integrations: [],
    };
    const seedPath = writeSeedFile(seed);

    // The Zod schema validates gate references and throws with a descriptive message
    await expect(loadSeed(seedPath, flowRepo, gateRepo, integrationRepo, sqlite)).rejects.toThrow(
      "nonexistent-gate",
    );

    sqlite.close();
  });
});
