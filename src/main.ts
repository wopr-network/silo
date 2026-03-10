import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DB_PATH } from "./config/db-path.js";
import * as schema from "./repositories/drizzle/schema.js";

export function createDatabase(dbPath = DB_PATH): {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
} {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/**
 * Wraps `fn` in a BEGIN/COMMIT/ROLLBACK transaction on `sqlite`.
 * If already inside a transaction, runs `fn` directly (allows nested calls).
 * Supports both synchronous and Promise-returning `fn`.
 */
export async function withTransaction<T>(sqlite: Database.Database, fn: () => T | Promise<T>): Promise<T> {
  if (sqlite.inTransaction) {
    return fn();
  }
  sqlite.exec("BEGIN");
  try {
    const result = await fn();
    sqlite.exec("COMMIT");
    return result;
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
}

export function runMigrations(db: ReturnType<typeof drizzle>, migrationsFolder = "./drizzle"): void {
  migrate(db, { migrationsFolder });
}

export function bootstrap(dbPath = DB_PATH): {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
} {
  const { db, sqlite } = createDatabase(dbPath);
  try {
    runMigrations(db);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { db, sqlite };
}

export * from "./api/wire-types.js";
export * from "./engine/index.js";
export { ConflictError, GateError, InternalError, NotFoundError, SiloError, ValidationError } from "./errors.js";
