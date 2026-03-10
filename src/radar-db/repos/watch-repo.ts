import { and, eq } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { watches } from "../schema.js";

export interface CreateWatchInput {
  sourceId: string;
  name: string;
  filter: Record<string, unknown>;
  action: string;
  actionConfig: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateWatchInput {
  name?: string;
  filter?: Record<string, unknown>;
  action?: string;
  actionConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export interface WatchRow {
  id: string;
  sourceId: string;
  name: string;
  filter: Record<string, unknown>;
  action: string;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

function toRow(raw: typeof watches.$inferSelect): WatchRow {
  return {
    id: raw.id,
    sourceId: raw.sourceId,
    name: raw.name,
    filter: JSON.parse(raw.filter) as Record<string, unknown>,
    action: raw.action,
    actionConfig: JSON.parse(raw.actionConfig) as Record<string, unknown>,
    enabled: raw.enabled,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export class WatchRepo {
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async create(input: CreateWatchInput): Promise<WatchRow> {
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    await this.db.insert(watches).values({
      id,
      tenantId: this.tenantId,
      sourceId: input.sourceId,
      name: input.name,
      filter: JSON.stringify(input.filter),
      action: input.action,
      actionConfig: JSON.stringify(input.actionConfig),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await this.db.select().from(watches).where(eq(watches.id, id));
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  async getById(id: string): Promise<WatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(watches)
      .where(and(eq(watches.id, id), eq(watches.tenantId, this.tenantId)));
    return row ? toRow(row) : undefined;
  }

  async listBySource(sourceId: string): Promise<WatchRow[]> {
    const rows = await this.db
      .select()
      .from(watches)
      .where(and(eq(watches.sourceId, sourceId), eq(watches.tenantId, this.tenantId)));
    return rows.map(toRow);
  }

  async list(): Promise<WatchRow[]> {
    const rows = await this.db.select().from(watches).where(eq(watches.tenantId, this.tenantId));
    return rows.map(toRow);
  }

  async update(id: string, input: UpdateWatchInput): Promise<WatchRow | undefined> {
    const now = Math.floor(Date.now() / 1000);
    const values: Partial<typeof watches.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined) values.name = input.name;
    if (input.filter !== undefined) values.filter = JSON.stringify(input.filter);
    if (input.action !== undefined) values.action = input.action;
    if (input.actionConfig !== undefined) values.actionConfig = JSON.stringify(input.actionConfig);
    if (input.enabled !== undefined) values.enabled = input.enabled;
    await this.db
      .update(watches)
      .set(values)
      .where(and(eq(watches.id, id), eq(watches.tenantId, this.tenantId)));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(watches).where(and(eq(watches.id, id), eq(watches.tenantId, this.tenantId)));
  }
}
