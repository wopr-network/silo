import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";
import type { RadarDb } from "../radar-db/index.js";
import { SeedFileSchema } from "./types.js";

export interface LoadSeedDeps {
  defconUrl: string;
  db: RadarDb;
  adminToken?: string;
}

export interface LoadSeedResult {
  flows: number;
  sources: number;
  watches: number;
}

/**
 * Replace $VAR and ${VAR} patterns in raw text with process.env values.
 * Only expands vars matching [A-Z_][A-Z0-9_]* to avoid false positives.
 * Throws if a referenced env var is not set.
 */
export function expandEnvVars(raw: string): string {
  return raw.replace(
    /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g,
    (_match, braced: string | undefined, bare: string | undefined) => {
      const name = braced ?? bare ?? "";
      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`Missing environment variable: ${name}`);
      }
      return value;
    },
  );
}

function ensureSeedTables(db: RadarDb): void {
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS seed_sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL
    )
  `);
  db.$client.exec(`
    CREATE TABLE IF NOT EXISTS seed_watches (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      event TEXT NOT NULL,
      flow_name TEXT NOT NULL,
      filter TEXT,
      FOREIGN KEY (source_id) REFERENCES seed_sources(id)
    )
  `);
}

// Keys that hold credentials — expanded only at use time, never persisted expanded.
const SENSITIVE_KEYS = new Set([
  "token",
  "password",
  "secret",
  "apiKey",
  "apikey",
  "api_key",
  "clientSecret",
  "client_secret",
]);

export function expandEnvVarsInValue(value: unknown, key?: string): unknown {
  if (SENSITIVE_KEYS.has(key ?? "")) {
    // Leave sensitive fields as env-var references so they are never stored in plaintext.
    return value;
  }
  if (typeof value === "string") {
    return expandEnvVars(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvVarsInValue(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandEnvVarsInValue(v, k);
    }
    return result;
  }
  return value;
}

export async function loadSeed(seedPath: string, deps: LoadSeedDeps): Promise<LoadSeedResult> {
  const absPath = resolve(seedPath);
  const raw = readFileSync(absPath, "utf-8");
  const json: unknown = expandEnvVarsInValue(JSON.parse(raw));
  const seed = SeedFileSchema.parse(json);

  ensureSeedTables(deps.db);

  for (const flow of seed.flows) {
    if (!flow.discipline) {
      logger.warn(
        `[radar] WARNING: flow "${flow.name}" has no discipline — workers will not claim its entities. Add "discipline": "<role>" to the flow definition.`,
      );
    }
    // PUT /api/flows/:id is idempotent — creates the flow if absent, updates it if already present.
    const res = await fetch(`${deps.defconUrl}/api/flows/${encodeURIComponent(flow.name)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(deps.adminToken ? { Authorization: `Bearer ${deps.adminToken}` } : {}),
      },
      body: JSON.stringify({
        description: flow.description,
        definition: {
          initialState: flow.initialState,
          discipline: flow.discipline,
          maxConcurrent: flow.maxConcurrent,
          maxConcurrentPerRepo: flow.maxConcurrentPerRepo,
          claimRetryAfterMs: flow.claimRetryAfterMs,
          states: flow.states.map((s) => ({
            name: s.name,
            modelTier: s.modelTier,
            mode: s.mode,
            promptTemplate: s.promptTemplate,
            constraints: s.constraints,
          })),
          transitions: flow.transitions.map((t) => ({
            fromState: t.fromState,
            toState: t.toState,
            trigger: t.trigger,
            condition: t.condition,
            priority: t.priority,
          })),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to push flow "${flow.name}" to DEFCON: HTTP ${res.status}: ${body}`);
    }
  }

  const upsertSource = deps.db.$client.prepare(
    "INSERT OR REPLACE INTO seed_sources (id, type, config) VALUES (?, ?, ?)",
  );
  const upsertWatch = deps.db.$client.prepare(
    "INSERT OR REPLACE INTO seed_watches (id, source_id, event, flow_name, filter) VALUES (?, ?, ?, ?, ?)",
  );

  deps.db.$client.transaction(() => {
    for (const source of seed.sources) {
      const { id, type, ...rest } = source;
      upsertSource.run(id, type, JSON.stringify(rest));
    }
    for (const watch of seed.watches) {
      upsertWatch.run(
        watch.id,
        watch.sourceId,
        watch.event,
        watch.flowName,
        watch.filter ? JSON.stringify(watch.filter) : null,
      );
    }
  })();

  return {
    flows: seed.flows.length,
    sources: seed.sources.length,
    watches: seed.watches.length,
  };
}
