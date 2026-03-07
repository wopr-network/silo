import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadSeed } from "../../src/config/seed-loader.js";
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

const PROJECT_ROOT = realpathSync(resolve(__dirname, "../.."));
const SEED_PATH = resolve(PROJECT_ROOT, "seeds/wopr-changeset.json");

describe("wopr-changeset seed loads with gates", () => {
  it("loads the seed with 4 gates", async () => {
    const { sqlite, flowRepo, gateRepo } = setupDb();
    const result = await loadSeed(SEED_PATH, flowRepo, gateRepo, sqlite, {
      allowedRoot: PROJECT_ROOT,
    });

    expect(result).toEqual({ flows: 1, gates: 4 });
    sqlite.close();
  });

  it("all gates have failurePrompt and timeoutPrompt", async () => {
    const { sqlite, flowRepo, gateRepo } = setupDb();
    await loadSeed(SEED_PATH, flowRepo, gateRepo, sqlite, {
      allowedRoot: PROJECT_ROOT,
    });

    for (const name of ["spec-posted", "ci-green", "review-bots-ready", "merge-queue"]) {
      const gate = await gateRepo.getByName(name);
      expect(gate, `gate ${name} should exist`).not.toBeNull();
      expect(gate!.failurePrompt, `gate ${name} should have failurePrompt`).toBeTruthy();
      expect(gate!.timeoutPrompt, `gate ${name} should have timeoutPrompt`).toBeTruthy();
    }
    sqlite.close();
  });

  it("transitions reference the correct gates", async () => {
    const { sqlite, flowRepo, gateRepo } = setupDb();
    await loadSeed(SEED_PATH, flowRepo, gateRepo, sqlite, {
      allowedRoot: PROJECT_ROOT,
    });

    const flow = await flowRepo.getByName("wopr-changeset");
    expect(flow).not.toBeNull();

    const specPosted = await gateRepo.getByName("spec-posted");
    const ciGreen = await gateRepo.getByName("ci-green");
    const reviewBots = await gateRepo.getByName("review-bots-ready");
    const mergeQueue = await gateRepo.getByName("merge-queue");

    const t = flow!.transitions;

    const archToCoding = t.find((tr) => tr.fromState === "architecting" && tr.toState === "coding");
    expect(archToCoding?.gateId).toBe(specPosted!.id);

    const codingToReviewing = t.find((tr) => tr.fromState === "coding" && tr.toState === "reviewing");
    expect(codingToReviewing?.gateId).toBe(ciGreen!.id);

    const reviewingToMerging = t.find((tr) => tr.fromState === "reviewing" && tr.toState === "merging");
    expect(reviewingToMerging?.gateId).toBe(reviewBots!.id);

    const mergingToDone = t.find((tr) => tr.fromState === "merging" && tr.toState === "done");
    expect(mergingToDone?.gateId).toBe(mergeQueue!.id);

    sqlite.close();
  });
});
