import { desc, eq } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { eventLog } from "../schema.js";

export interface AppendEventInput {
  sourceId: string;
  watchId: string | null;
  rawEvent: Record<string, unknown>;
  actionTaken: string | null;
  defconResponse: Record<string, unknown> | null;
}

export interface EventLogRow {
  id: string;
  sourceId: string;
  watchId: string | null;
  rawEvent: Record<string, unknown>;
  actionTaken: string | null;
  defconResponse: Record<string, unknown> | null;
  createdAt: number;
}

function toRow(raw: typeof eventLog.$inferSelect): EventLogRow {
  return {
    id: raw.id,
    sourceId: raw.sourceId,
    watchId: raw.watchId,
    rawEvent: JSON.parse(raw.rawEvent) as Record<string, unknown>,
    actionTaken: raw.actionTaken,
    defconResponse: raw.defconResponse ? (JSON.parse(raw.defconResponse) as Record<string, unknown>) : null,
    createdAt: raw.createdAt,
  };
}

export class EventLogRepo {
  constructor(private db: RadarDb) {}

  append(input: AppendEventInput): EventLogRow {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.db
      .insert(eventLog)
      .values({
        id,
        sourceId: input.sourceId,
        watchId: input.watchId,
        rawEvent: JSON.stringify(input.rawEvent),
        actionTaken: input.actionTaken,
        defconResponse: input.defconResponse ? JSON.stringify(input.defconResponse) : null,
        createdAt: now,
      })
      .run();
    const row = this.db.select().from(eventLog).where(eq(eventLog.id, id)).get();
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  getById(id: string): EventLogRow | undefined {
    const row = this.db.select().from(eventLog).where(eq(eventLog.id, id)).get();
    return row ? toRow(row) : undefined;
  }

  list(opts?: { limit?: number; offset?: number }): EventLogRow[] {
    const query = this.db
      .select()
      .from(eventLog)
      .orderBy(desc(eventLog.createdAt))
      .limit(opts?.limit ?? -1)
      .offset(opts?.offset ?? 0);
    return query.all().map(toRow);
  }

  queryBySource(sourceId: string, opts?: { limit?: number }): EventLogRow[] {
    const query = this.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.sourceId, sourceId))
      .orderBy(desc(eventLog.createdAt))
      .limit(opts?.limit ?? -1);
    return query.all().map(toRow);
  }

  queryByWatch(watchId: string, opts?: { limit?: number }): EventLogRow[] {
    const query = this.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.watchId, watchId))
      .orderBy(desc(eventLog.createdAt))
      .limit(opts?.limit ?? -1);
    return query.all().map(toRow);
  }
}
