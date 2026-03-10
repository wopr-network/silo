import { eq } from "drizzle-orm";
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
  constructor(private db: RadarDb) {}

  create(input: CreateWatchInput): WatchRow {
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    this.db
      .insert(watches)
      .values({
        id,
        sourceId: input.sourceId,
        name: input.name,
        filter: JSON.stringify(input.filter),
        action: input.action,
        actionConfig: JSON.stringify(input.actionConfig),
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = this.db.select().from(watches).where(eq(watches.id, id)).get();
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  getById(id: string): WatchRow | undefined {
    const row = this.db.select().from(watches).where(eq(watches.id, id)).get();
    return row ? toRow(row) : undefined;
  }

  listBySource(sourceId: string): WatchRow[] {
    return this.db.select().from(watches).where(eq(watches.sourceId, sourceId)).all().map(toRow);
  }

  list(): WatchRow[] {
    return this.db.select().from(watches).all().map(toRow);
  }

  update(id: string, input: UpdateWatchInput): WatchRow | undefined {
    const now = Math.floor(Date.now() / 1000);
    const values: Partial<typeof watches.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined) values.name = input.name;
    if (input.filter !== undefined) values.filter = JSON.stringify(input.filter);
    if (input.action !== undefined) values.action = input.action;
    if (input.actionConfig !== undefined) values.actionConfig = JSON.stringify(input.actionConfig);
    if (input.enabled !== undefined) values.enabled = input.enabled;
    this.db.update(watches).set(values).where(eq(watches.id, id)).run();
    return this.getById(id);
  }

  delete(id: string): void {
    this.db.delete(watches).where(eq(watches.id, id)).run();
  }
}
