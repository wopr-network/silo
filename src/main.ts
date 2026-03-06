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

export * from "./engine/index.js";
