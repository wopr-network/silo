import { and, desc, eq } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { eventLog } from "../schema.js";

export interface AppendEventInput {
  sourceId: string;
  watchId: string | null;
  rawEvent: Record<string, unknown>;
  actionTaken: string | null;
  siloResponse: Record<string, unknown> | null;
}

export interface EventLogRow {
  id: string;
  sourceId: string;
  watchId: string | null;
  rawEvent: Record<string, unknown>;
  actionTaken: string | null;
  siloResponse: Record<string, unknown> | null;
  createdAt: number;
}

function toRow(raw: typeof eventLog.$inferSelect): EventLogRow {
  return {
    id: raw.id,
    sourceId: raw.sourceId,
    watchId: raw.watchId,
    rawEvent: JSON.parse(raw.rawEvent) as Record<string, unknown>,
    actionTaken: raw.actionTaken,
    siloResponse: raw.siloResponse ? (JSON.parse(raw.siloResponse) as Record<string, unknown>) : null,
    createdAt: raw.createdAt,
  };
}

export class EventLogRepo {
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async append(input: AppendEventInput): Promise<EventLogRow> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.db.insert(eventLog).values({
      id,
      tenantId: this.tenantId,
      sourceId: input.sourceId,
      watchId: input.watchId,
      rawEvent: JSON.stringify(input.rawEvent),
      actionTaken: input.actionTaken,
      siloResponse: input.siloResponse ? JSON.stringify(input.siloResponse) : null,
      createdAt: now,
    });
    const [row] = await this.db.select().from(eventLog).where(eq(eventLog.id, id));
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  async getById(id: string): Promise<EventLogRow | undefined> {
    const [row] = await this.db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.id, id), eq(eventLog.tenantId, this.tenantId)));
    return row ? toRow(row) : undefined;
  }

  async list(opts?: { limit?: number; offset?: number }): Promise<EventLogRow[]> {
    let query = this.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.tenantId, this.tenantId))
      .orderBy(desc(eventLog.createdAt))
      .offset(opts?.offset ?? 0);
    if (opts?.limit && opts.limit > 0) query = query.limit(opts.limit) as typeof query;
    const rows = await query;
    return rows.map(toRow);
  }

  async queryBySource(sourceId: string, opts?: { limit?: number }): Promise<EventLogRow[]> {
    let query = this.db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.sourceId, sourceId), eq(eventLog.tenantId, this.tenantId)))
      .orderBy(desc(eventLog.createdAt));
    if (opts?.limit && opts.limit > 0) query = query.limit(opts.limit) as typeof query;
    const rows = await query;
    return rows.map(toRow);
  }

  async queryByWatch(watchId: string, opts?: { limit?: number }): Promise<EventLogRow[]> {
    let query = this.db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.watchId, watchId), eq(eventLog.tenantId, this.tenantId)))
      .orderBy(desc(eventLog.createdAt));
    if (opts?.limit && opts.limit > 0) query = query.limit(opts.limit) as typeof query;
    const rows = await query;
    return rows.map(toRow);
  }
}
