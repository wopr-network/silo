import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function createDatabase(dbPath = "./agentic-flow.db"): {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
} {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  return { db, sqlite };
}

export function runMigrations(db: ReturnType<typeof drizzle>, migrationsFolder = "./drizzle"): void {
  migrate(db, { migrationsFolder });
}

export function bootstrap(dbPath = "./agentic-flow.db"): {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
} {
  const { db, sqlite } = createDatabase(dbPath);
  runMigrations(db);
  return { db, sqlite };
}
