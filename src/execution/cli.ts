#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { exportSeed } from "../config/exporter.js";
import { loadSeed } from "../config/seed-loader.js";
import { DrizzleFlowRepository } from "../repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../repositories/drizzle/gate.repo.js";
import { DrizzleIntegrationConfigRepository } from "../repositories/drizzle/integration-config.repo.js";
import * as schema from "../repositories/drizzle/schema.js";
import {
  entities,
  entityHistory,
  flowDefinitions,
  flowVersions,
  gateDefinitions,
  gateResults,
  integrationConfig,
  invocations,
  stateDefinitions,
  transitionRules,
} from "../repositories/drizzle/schema.js";

const DB_PATH = process.env.AGENTIC_DB_PATH ?? "./agentic-flow.db";
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

function openDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, sqlite };
}

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const args = argv.slice(2);
  const command = args[0] ?? "";
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (command === "init") {
    const seedPath = flags.seed;
    if (typeof seedPath !== "string") {
      console.log("Usage: agentic init --seed <path> [--force]");
      return;
    }

    const { db, sqlite } = openDb(DB_PATH);
    const flowRepo = new DrizzleFlowRepository(db);
    const gateRepo = new DrizzleGateRepository(db);

    if (flags.force) {
      // Delete in FK-safe order
      db.delete(gateResults).run();
      db.delete(entityHistory).run();
      db.delete(invocations).run();
      db.delete(entities).run();
      db.delete(transitionRules).run();
      db.delete(stateDefinitions).run();
      db.delete(integrationConfig).run();
      db.delete(flowVersions).run();
      db.delete(gateDefinitions).run();
      db.delete(flowDefinitions).run();
    }

    const integrationRepo = new DrizzleIntegrationConfigRepository(db);
    const result = await loadSeed(resolve(seedPath), flowRepo, gateRepo, integrationRepo, sqlite);
    console.log(`Loaded seed: flows: ${result.flows}, gates: ${result.gates}, integrations: ${result.integrations}`);
    sqlite.close();
  } else if (command === "export") {
    const { db, sqlite } = openDb(DB_PATH);
    const flowRepo = new DrizzleFlowRepository(db);
    const gateRepo = new DrizzleGateRepository(db);

    const integrationRepo = new DrizzleIntegrationConfigRepository(db);
    const seed = await exportSeed(flowRepo, gateRepo, integrationRepo);
    const json = JSON.stringify(seed, null, 2);

    const outPath = flags.out;
    if (typeof outPath === "string") {
      writeFileSync(resolve(outPath), json);
      console.log(`Exported to ${outPath}`);
    } else {
      console.log(json);
    }
    sqlite.close();
  } else {
    console.log("Usage: agentic <command>");
    console.log("  init --seed <path> [--force]  Load seed file into database");
    console.log("  export [--out <path>]          Export database to JSON");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
