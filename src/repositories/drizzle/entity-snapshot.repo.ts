import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Artifacts, Entity, IEntitySnapshotRepository, Refs } from "../interfaces.js";
import { entitySnapshots } from "./schema.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat (postgres-js + PGlite)
type Db = any;

export class DrizzleEntitySnapshotRepository implements IEntitySnapshotRepository {
  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
  ) {}

  async save(entityId: string, sequence: number, state: Entity): Promise<void> {
    const id = randomUUID();
    await this.db
      .insert(entitySnapshots)
      .values({
        id,
        tenantId: this.tenantId,
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
        parentEntityId: state.parentEntityId,
      })
      .onConflictDoNothing();
  }

  async loadLatest(entityId: string): Promise<{ sequence: number; state: Entity } | null> {
    const [row] = await this.db
      .select()
      .from(entitySnapshots)
      .where(and(eq(entitySnapshots.entityId, entityId), eq(entitySnapshots.tenantId, this.tenantId)))
      .orderBy(desc(entitySnapshots.sequence))
      .limit(1);

    if (!row) return null;

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
        parentEntityId: row.parentEntityId ?? null,
      },
    };
  }
}
