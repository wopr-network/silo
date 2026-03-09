import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { EventRow, IEventRepository } from "../interfaces.js";
import type * as schema from "./schema.js";
import { events } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

export class DrizzleEventRepository implements IEventRepository {
  constructor(private readonly db: Db) {}

  async emitDefinitionChanged(flowId: string | null, tool: string, payload: Record<string, unknown>): Promise<void> {
    this.db
      .insert(events)
      .values({
        id: randomUUID(),
        type: "definition.changed",
        entityId: null,
        flowId: flowId || null,
        payload: { tool, ...payload },
        emittedAt: Date.now(),
      })
      .run();
  }

  findAll(): (typeof events.$inferSelect)[] {
    return this.db.select().from(events).all();
  }

  findByEntity(entityId: string, limit = 100): Promise<EventRow[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(events)
        .where(eq(events.entityId, entityId))
        .orderBy(desc(events.emittedAt))
        .limit(limit)
        .all() as EventRow[],
    );
  }

  findRecent(limit = 100): Promise<EventRow[]> {
    return Promise.resolve(
      this.db.select().from(events).orderBy(desc(events.emittedAt)).limit(limit).all() as EventRow[],
    );
  }
}
