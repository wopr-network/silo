import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../repositories/drizzle/schema.js";
import { log } from "./log.js";

let client: postgres.Sql | null = null;

export function createDb(url?: string) {
  const databaseUrl = url ?? process.env.DATABASE_URL ?? "";
  client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function runMigrations(db: ReturnType<typeof createDb>["db"]): Promise<void> {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  log.info("Running database migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  log.info("Migrations complete.");
}

export async function shutdown(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}
