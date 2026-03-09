import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Artifacts, Entity, IEntitySnapshotRepository, Refs } from "../interfaces.js";
import type * as schema from "./schema.js";
import { entitySnapshots } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

export class DrizzleEntitySnapshotRepository implements IEntitySnapshotRepository {
  constructor(private readonly db: Db) {}

  async save(entityId: string, sequence: number, state: Entity): Promise<void> {
    const id = randomUUID();
    this.db
      .insert(entitySnapshots)
      .values({
        id,
        entityId,
        sequence,
        state: state.state,
        flowId: state.flowId,
        refs: state.refs,
        artifacts: state.artifacts,
        claimedBy: state.claimedBy,
        claimedAt: state.claimedAt?.getTime() ?? null,
        flowVersion: state.flowVersion,
        priority: state.priority,
        affinityWorkerId: state.affinityWorkerId,
        affinityRole: state.affinityRole,
        affinityExpiresAt: state.affinityExpiresAt?.getTime() ?? null,
        createdAt: state.createdAt.getTime(),
        updatedAt: state.updatedAt.getTime(),
        snapshotAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
  }

  async loadLatest(entityId: string): Promise<{ sequence: number; state: Entity } | null> {
    const rows = this.db
      .select()
      .from(entitySnapshots)
      .where(eq(entitySnapshots.entityId, entityId))
      .orderBy(desc(entitySnapshots.sequence))
      .limit(1)
      .all();

    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      sequence: row.sequence,
      state: {
        id: entityId,
        flowId: row.flowId,
        state: row.state,
        refs: row.refs as Refs | null,
        artifacts: row.artifacts as Artifacts | null,
        claimedBy: row.claimedBy,
        claimedAt: row.claimedAt ? new Date(row.claimedAt) : null,
        flowVersion: row.flowVersion ?? 1,
        priority: row.priority ?? 0,
        createdAt: new Date(row.createdAt ?? 0),
        updatedAt: new Date(row.updatedAt ?? 0),
        affinityWorkerId: row.affinityWorkerId ?? null,
        affinityRole: row.affinityRole ?? null,
        affinityExpiresAt: row.affinityExpiresAt ? new Date(row.affinityExpiresAt) : null,
        parentEntityId: null,
      },
    };
  }
}
