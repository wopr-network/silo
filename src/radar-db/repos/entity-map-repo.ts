import { and, eq } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { entityMap } from "../schema.js";

export interface IEntityMapRepository {
  findEntityId(sourceId: string, externalId: string): Promise<string | undefined>;
  /** Returns true if the row was inserted, false if it already existed. */
  insertIfAbsent(sourceId: string, externalId: string, entityId: string): Promise<boolean>;
  updateEntityId(sourceId: string, externalId: string, entityId: string): Promise<void>;
  deleteRow(sourceId: string, externalId: string): Promise<void>;
}

export class DrizzleEntityMapRepository implements IEntityMapRepository {
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async findEntityId(sourceId: string, externalId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select()
      .from(entityMap)
      .where(
        and(
          eq(entityMap.sourceId, sourceId),
          eq(entityMap.externalId, externalId),
          eq(entityMap.tenantId, this.tenantId),
        ),
      );
    return row?.entityId;
  }

  async insertIfAbsent(sourceId: string, externalId: string, entityId: string): Promise<boolean> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db
      .insert(entityMap)
      .values({ id, tenantId: this.tenantId, sourceId, externalId, entityId, createdAt: now })
      .onConflictDoNothing();
    // postgres-js returns RowList with .count; drizzle wraps as array-like
    return (
      ((result as unknown as { rowCount?: number; count?: number })?.rowCount ??
        (result as unknown as { count?: number })?.count ??
        0) > 0
    );
  }

  async updateEntityId(sourceId: string, externalId: string, entityId: string): Promise<void> {
    await this.db
      .update(entityMap)
      .set({ entityId })
      .where(
        and(
          eq(entityMap.sourceId, sourceId),
          eq(entityMap.externalId, externalId),
          eq(entityMap.tenantId, this.tenantId),
        ),
      );
  }

  async deleteRow(sourceId: string, externalId: string): Promise<void> {
    await this.db
      .delete(entityMap)
      .where(
        and(
          eq(entityMap.sourceId, sourceId),
          eq(entityMap.externalId, externalId),
          eq(entityMap.tenantId, this.tenantId),
        ),
      );
  }
}
