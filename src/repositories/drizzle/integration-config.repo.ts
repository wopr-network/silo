import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { CreateIntegrationConfigInput, IIntegrationConfigRepository, IntegrationConfig } from "../interfaces.js";
import type * as schema from "./schema.js";
import { integrationConfig } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

function toIntegrationConfig(row: typeof integrationConfig.$inferSelect): IntegrationConfig {
  return {
    id: row.id,
    capability: row.capability,
    adapter: row.adapter,
    config: (row.config as Record<string, unknown>) ?? null,
  };
}

export class DrizzleIntegrationConfigRepository implements IIntegrationConfigRepository {
  constructor(private db: Db) {}

  async create(input: CreateIntegrationConfigInput): Promise<IntegrationConfig> {
    const id = randomUUID();
    this.db
      .insert(integrationConfig)
      .values({
        id,
        capability: input.capability,
        adapter: input.adapter,
        config: input.config ?? null,
      })
      .run();
    const row = this.db.select().from(integrationConfig).where(eq(integrationConfig.id, id)).get();
    if (!row) throw new Error(`IntegrationConfig ${id} not found after insert`);
    return toIntegrationConfig(row);
  }

  async listAll(): Promise<IntegrationConfig[]> {
    const rows = this.db.select().from(integrationConfig).all();
    return rows.map(toIntegrationConfig);
  }
}
