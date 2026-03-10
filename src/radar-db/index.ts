import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../repositories/drizzle/schema.js";

export type RadarDb = ReturnType<typeof createDb>;

/**
 * Create a unified database with all tables (engine + worker pool).
 *
 * For tests that only need worker-pool tables, pass ":memory:" (default).
 * The raw-SQL DDL ensures tables exist without requiring the full migration folder.
 */
export function createDb(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Create worker-pool tables via raw SQL (tests that don't run full migrations)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watches (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      filter TEXT NOT NULL,
      action TEXT NOT NULL,
      action_config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      watch_id TEXT REFERENCES watches(id) ON DELETE CASCADE,
      raw_event TEXT NOT NULL,
      action_taken TEXT,
      silo_response TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      discipline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      config TEXT,
      last_heartbeat INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entity_map (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (source_id, external_id)
    );
    CREATE TABLE IF NOT EXISTS throughput_events (
      id TEXT PRIMARY KEY,
      outcome TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS throughput_events_created_at_idx ON throughput_events (created_at);
    CREATE TABLE IF NOT EXISTS entity_activity (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entity_activity_entity_id_idx ON entity_activity (entity_id);
    CREATE UNIQUE INDEX IF NOT EXISTS entity_activity_entity_seq_uniq ON entity_activity (entity_id, seq);
  `);
  return drizzle(sqlite, { schema });
}

/** @deprecated Use createDb instead */
export function applySchema(path: string = ":memory:") {
  return createDb(path);
}
