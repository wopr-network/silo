import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Pool } from "pg";
import postgres from "postgres";
import * as schema from "../repositories/drizzle/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let pool: Pool | null = null;
let db: Db | null = null;
let sqlClient: postgres.Sql | null = null;

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) {
    sqlClient = postgres(process.env.DATABASE_URL ?? "");
    db = drizzle(sqlClient, { schema });
  }
  return db;
}

export async function runMigrations(): Promise<void> {
  const d = getDb();
  // Holyship's own migrations
  const holyshipMigrations = resolve(__dirname, "..", "..", "drizzle");
  await migrate(d, { migrationsFolder: holyshipMigrations });
}

export async function shutdown(): Promise<void> {
  if (sqlClient) await sqlClient.end();
  if (pool) await pool.end();
}
