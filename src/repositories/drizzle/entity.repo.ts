import { and, eq, inArray, isNull, lt, not } from "drizzle-orm";
import { NotFoundError } from "../../errors.js";
import type { Artifacts, Entity, IEntityRepository, Refs } from "../interfaces.js";
import type { Db } from "./db-type.js";
import { entities } from "./schema.js";

export class DrizzleEntityRepository implements IEntityRepository {
  constructor(
    private db: Db,
    private tenantId: string,
  ) {}

  private toEntity(row: typeof entities.$inferSelect): Entity {
    return {
      id: row.id,
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
    };
  }

  async create(
    flowId: string,
    initialState: string,
    refs?: Refs,
    flowVersion?: number,
    parentEntityId?: string,
  ): Promise<Entity> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      tenantId: this.tenantId,
      flowId,
      state: initialState,
      refs: refs ?? null,
      artifacts: null,
      claimedBy: null,
      claimedAt: null,
      flowVersion: flowVersion ?? 1,
      createdAt: now,
      updatedAt: now,
      affinityWorkerId: null,
      affinityRole: null,
      affinityExpiresAt: null,
      parentEntityId: parentEntityId ?? null,
    };
    await this.db.insert(entities).values(row);
    return this.toEntity(row as typeof entities.$inferSelect);
  }

  async get(id: string): Promise<Entity | null> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)))
      .limit(1);
    return rows.length > 0 ? this.toEntity(rows[0]) : null;
  }

  async findByFlowAndState(flowId: string, state: string, limit?: number): Promise<Entity[]> {
    const query = this.db
      .select()
      .from(entities)
      .where(and(eq(entities.flowId, flowId), eq(entities.state, state), eq(entities.tenantId, this.tenantId)));
    const rows = await (limit !== undefined ? query.limit(limit) : query);
    return rows.map((r: typeof entities.$inferSelect) => this.toEntity(r));
  }

  async hasAnyInFlowAndState(flowId: string, stateNames: string[]): Promise<boolean> {
    if (stateNames.length === 0) return false;
    const rows = await this.db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.flowId, flowId), inArray(entities.state, stateNames), eq(entities.tenantId, this.tenantId)),
      )
      .limit(1);
    return rows.length > 0;
  }

  async transition(
    id: string,
    toState: string,
    _trigger: string,
    artifacts?: Partial<Artifacts>,
    _invocationId?: string | null,
  ): Promise<Entity> {
    return this.db.transaction(async (tx: Db) => {
      const rows = await tx
        .select()
        .from(entities)
        .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)))
        .limit(1);
      if (rows.length === 0) throw new NotFoundError(`Entity not found: ${id}`);
      const row = rows[0];
      const now = Date.now();
      const mergedArtifacts = artifacts
        ? { ...((row.artifacts as Record<string, unknown>) ?? {}), ...artifacts }
        : row.artifacts;

      await tx
        .update(entities)
        .set({ state: toState, artifacts: mergedArtifacts, updatedAt: now })
        .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)));

      return this.toEntity({
        ...row,
        state: toState,
        artifacts: mergedArtifacts,
        updatedAt: now,
      } as typeof entities.$inferSelect);
    });
  }

  async updateArtifacts(id: string, artifacts: Partial<Artifacts>): Promise<void> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundError(`Entity not found: ${id}`);
    const existing = (rows[0].artifacts as Record<string, unknown>) ?? {};
    await this.db
      .update(entities)
      .set({ artifacts: { ...existing, ...artifacts }, updatedAt: Date.now() })
      .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)));
  }

  async removeArtifactKeys(id: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundError(`Entity not found: ${id}`);
    const existing = (rows[0].artifacts as Record<string, unknown>) ?? {};
    const cleaned = { ...existing };
    for (const key of keys) {
      delete cleaned[key];
    }
    await this.db
      .update(entities)
      .set({ artifacts: cleaned, updatedAt: Date.now() })
      .where(and(eq(entities.id, id), eq(entities.tenantId, this.tenantId)));
  }

  async claim(flowId: string, state: string, agentId: string): Promise<Entity | null> {
    // Find a candidate row (no lock needed — claimById handles atomicity)
    const rows = await this.db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.flowId, flowId),
          eq(entities.state, state),
          isNull(entities.claimedBy),
          eq(entities.tenantId, this.tenantId),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    // claimById is atomic: UPDATE ... WHERE claimed_by IS NULL ... RETURNING
    // Two concurrent workers may SELECT the same row, but only one wins here.
    return this.claimById(rows[0].id, agentId);
  }

  async claimById(entityId: string, agentId: string): Promise<Entity | null> {
    const now = Date.now();
    const updated = await this.db
      .update(entities)
      .set({ claimedBy: agentId, claimedAt: now, updatedAt: now })
      .where(and(eq(entities.id, entityId), isNull(entities.claimedBy), eq(entities.tenantId, this.tenantId)))
      .returning();
    if (updated.length === 0) return null;
    return this.toEntity(updated[0]);
  }

  async release(entityId: string, agentId: string): Promise<void> {
    await this.db
      .update(entities)
      .set({ claimedBy: null, claimedAt: null, updatedAt: Date.now() })
      .where(and(eq(entities.id, entityId), eq(entities.claimedBy, agentId), eq(entities.tenantId, this.tenantId)));
  }

  async appendSpawnedChild(
    parentId: string,
    entry: { childId: string; childFlow: string; spawnedAt: string },
  ): Promise<void> {
    await this.db.transaction(async (tx: Db) => {
      const rows = await tx
        .select()
        .from(entities)
        .where(and(eq(entities.id, parentId), eq(entities.tenantId, this.tenantId)))
        .limit(1);
      if (rows.length === 0) throw new NotFoundError(`Entity ${parentId} not found`);
      const row = rows[0];
      const artifacts = (row.artifacts as Record<string, unknown>) ?? {};
      const existing = (Array.isArray(artifacts.spawnedChildren) ? artifacts.spawnedChildren : []) as Array<{
        childId: string;
        childFlow: string;
        spawnedAt: string;
      }>;
      await tx
        .update(entities)
        .set({ artifacts: { ...artifacts, spawnedChildren: [...existing, entry] }, updatedAt: Date.now() })
        .where(and(eq(entities.id, parentId), eq(entities.tenantId, this.tenantId)));
    });
  }

  async reapExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const rows = await this.db
      .update(entities)
      .set({ claimedBy: null, claimedAt: null, updatedAt: Date.now() })
      .where(and(not(isNull(entities.claimedBy)), lt(entities.claimedAt, cutoff), eq(entities.tenantId, this.tenantId)))
      .returning({ id: entities.id });
    return rows.map((r: { id: string }) => r.id);
  }

  async setAffinity(entityId: string, workerId: string, role: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(entities)
      .set({
        affinityWorkerId: workerId,
        affinityRole: role,
        affinityExpiresAt: expiresAt.getTime(),
        updatedAt: Date.now(),
      })
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, this.tenantId)));
  }

  async clearExpiredAffinity(): Promise<string[]> {
    const now = Date.now();
    const rows = await this.db
      .update(entities)
      .set({ affinityWorkerId: null, affinityRole: null, affinityExpiresAt: null, updatedAt: now })
      .where(
        and(
          not(isNull(entities.affinityWorkerId)),
          lt(entities.affinityExpiresAt, now),
          eq(entities.tenantId, this.tenantId),
        ),
      )
      .returning({ id: entities.id });
    return rows.map((r: { id: string }) => r.id);
  }

  async findByParentId(parentEntityId: string): Promise<Entity[]> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.parentEntityId, parentEntityId), eq(entities.tenantId, this.tenantId)));
    return rows.map((r: typeof entities.$inferSelect) => this.toEntity(r));
  }

  async cancelEntity(entityId: string): Promise<void> {
    await this.db
      .update(entities)
      .set({ state: "cancelled", claimedBy: null, claimedAt: null, updatedAt: Date.now() })
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, this.tenantId)));
  }

  async resetEntity(entityId: string, targetState: string): Promise<Entity> {
    const now = Date.now();
    await this.db
      .update(entities)
      .set({ state: targetState, claimedBy: null, claimedAt: null, updatedAt: now })
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, this.tenantId)));
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, this.tenantId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundError(`Entity not found: ${entityId}`);
    return this.toEntity(rows[0]);
  }

  async updateFlowVersion(entityId: string, version: number): Promise<void> {
    await this.db
      .update(entities)
      .set({ flowVersion: version, updatedAt: Date.now() })
      .where(and(eq(entities.id, entityId), eq(entities.tenantId, this.tenantId)));
  }
}
