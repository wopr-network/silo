import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { DATABASE_URL } from "./config/db-url.js";
import * as schema from "./repositories/drizzle/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(url = DATABASE_URL): {
  db: Db;
  client: postgres.Sql;
} {
  const client = postgres(url);
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function runMigrations(db: Db, migrationsFolder?: string): Promise<void> {
  // Resolve relative to the package root (one level up from src/), not CWD.
  const folder = migrationsFolder ?? resolve(__dirname, "..", "drizzle");
  await migrate(db, { migrationsFolder: folder });
}

export async function bootstrap(url = DATABASE_URL): Promise<{
  db: Db;
  client: postgres.Sql;
}> {
  const { db, client } = createDatabase(url);
  try {
    await runMigrations(db);
  } catch (err) {
    await client.end();
    throw err;
  }
  return { db, client };
}

export * from "./api/wire-types.js";
export * from "./engine/index.js";
export { ConflictError, GateError, InternalError, NotFoundError, SiloError, ValidationError } from "./errors.js";
