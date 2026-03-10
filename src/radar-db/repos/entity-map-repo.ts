import { and, eq } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { entityMap } from "../schema.js";

export interface IEntityMapRepository {
  findEntityId(sourceId: string, externalId: string): string | undefined;
  /** Returns true if the row was inserted, false if it already existed. */
  insertIfAbsent(sourceId: string, externalId: string, entityId: string): boolean;
  updateEntityId(sourceId: string, externalId: string, entityId: string): void;
  deleteRow(sourceId: string, externalId: string): void;
}

export class DrizzleEntityMapRepository implements IEntityMapRepository {
  constructor(private db: RadarDb) {}

  findEntityId(sourceId: string, externalId: string): string | undefined {
    const row = this.db
      .select()
      .from(entityMap)
      .where(and(eq(entityMap.sourceId, sourceId), eq(entityMap.externalId, externalId)))
      .get();
    return row?.entityId;
  }

  insertIfAbsent(sourceId: string, externalId: string, entityId: string): boolean {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const result = this.db
      .insert(entityMap)
      .values({ id, sourceId, externalId, entityId, createdAt: now })
      .onConflictDoNothing()
      .run();
    return result.changes > 0;
  }

  updateEntityId(sourceId: string, externalId: string, entityId: string): void {
    this.db
      .update(entityMap)
      .set({ entityId })
      .where(and(eq(entityMap.sourceId, sourceId), eq(entityMap.externalId, externalId)))
      .run();
  }

  deleteRow(sourceId: string, externalId: string): void {
    this.db
      .delete(entityMap)
      .where(and(eq(entityMap.sourceId, sourceId), eq(entityMap.externalId, externalId)))
      .run();
  }
}
