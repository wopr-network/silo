import { and, eq, inArray, isNull, lt, not } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Artifacts, Entity, IEntityRepository, Refs } from "../interfaces.js";
import type * as schema from "./schema.js";
import { entities } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

export class DrizzleEntityRepository implements IEntityRepository {
  constructor(private db: Db) {}

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
    };
  }

  async create(flowId: string, initialState: string, refs?: Refs): Promise<Entity> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      flowId,
      state: initialState,
      refs: refs ?? null,
      artifacts: null,
      claimedBy: null,
      claimedAt: null,
      flowVersion: 1,
      createdAt: now,
      updatedAt: now,
      affinityWorkerId: null,
      affinityRole: null,
      affinityExpiresAt: null,
    };
    await this.db.insert(entities).values(row);
    return this.toEntity(row as typeof entities.$inferSelect);
  }

  async get(id: string): Promise<Entity | null> {
    const rows = await this.db.select().from(entities).where(eq(entities.id, id)).limit(1);
    return rows.length > 0 ? this.toEntity(rows[0]) : null;
  }

  async findByFlowAndState(flowId: string, state: string, limit?: number): Promise<Entity[]> {
    const query = this.db
      .select()
      .from(entities)
      .where(and(eq(entities.flowId, flowId), eq(entities.state, state)));
    const rows = await (limit !== undefined ? query.limit(limit) : query);
    return rows.map((r) => this.toEntity(r));
  }

  async hasAnyInFlowAndState(flowId: string, stateNames: string[]): Promise<boolean> {
    if (stateNames.length === 0) return false;
    const rows = await this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.flowId, flowId), inArray(entities.state, stateNames)))
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
    return this.db.transaction((tx) => {
      const rows = tx.select().from(entities).where(eq(entities.id, id)).limit(1).all();
      if (rows.length === 0) throw new Error(`Entity not found: ${id}`);
      const row = rows[0];
      const now = Date.now();
      const mergedArtifacts = artifacts
        ? { ...((row.artifacts as Record<string, unknown>) ?? {}), ...artifacts }
        : row.artifacts;

      tx.update(entities)
        .set({ state: toState, artifacts: mergedArtifacts, updatedAt: now })
        .where(eq(entities.id, id))
        .run();

      return this.toEntity({
        ...row,
        state: toState,
        artifacts: mergedArtifacts,
        updatedAt: now,
      } as typeof entities.$inferSelect);
    });
  }

  async updateArtifacts(id: string, artifacts: Partial<Artifacts>): Promise<void> {
    const rows = await this.db.select().from(entities).where(eq(entities.id, id)).limit(1);
    if (rows.length === 0) throw new Error(`Entity not found: ${id}`);
    const existing = (rows[0].artifacts as Record<string, unknown>) ?? {};
    await this.db
      .update(entities)
      .set({ artifacts: { ...existing, ...artifacts }, updatedAt: Date.now() })
      .where(eq(entities.id, id));
  }

  async claim(flowId: string, state: string, agentId: string): Promise<Entity | null> {
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(entities)
        .where(and(eq(entities.flowId, flowId), eq(entities.state, state), isNull(entities.claimedBy)))
        .limit(1)
        .all();
      if (rows.length === 0) return null;
      const row = rows[0];
      const now = Date.now();
      tx.update(entities)
        .set({ claimedBy: agentId, claimedAt: now, updatedAt: now })
        .where(eq(entities.id, row.id))
        .run();
      return this.toEntity({
        ...row,
        claimedBy: agentId,
        claimedAt: now,
        updatedAt: now,
      } as typeof entities.$inferSelect);
    });
  }

  async claimById(entityId: string, agentId: string): Promise<Entity | null> {
    const now = Date.now();
    const result = this.db
      .update(entities)
      .set({ claimedBy: agentId, claimedAt: now, updatedAt: now })
      .where(and(eq(entities.id, entityId), isNull(entities.claimedBy)))
      .run();
    if (result.changes === 0) return null;
    const rows = this.db.select().from(entities).where(eq(entities.id, entityId)).limit(1).all();
    return rows.length > 0 ? this.toEntity(rows[0]) : null;
  }

  async release(entityId: string, agentId: string): Promise<void> {
    await this.db
      .update(entities)
      .set({ claimedBy: null, claimedAt: null, updatedAt: Date.now() })
      .where(and(eq(entities.id, entityId), eq(entities.claimedBy, agentId)))
      .run();
  }

  async appendSpawnedChild(
    parentId: string,
    entry: { childId: string; childFlow: string; spawnedAt: string },
  ): Promise<void> {
    this.db.transaction((tx) => {
      const rows = tx.select().from(entities).where(eq(entities.id, parentId)).limit(1).all();
      if (rows.length === 0) throw new Error(`Entity ${parentId} not found`);
      const row = rows[0];
      const artifacts = (row.artifacts as Record<string, unknown>) ?? {};
      const existing = (Array.isArray(artifacts.spawnedChildren) ? artifacts.spawnedChildren : []) as Array<{
        childId: string;
        childFlow: string;
        spawnedAt: string;
      }>;
      tx.update(entities)
        .set({ artifacts: { ...artifacts, spawnedChildren: [...existing, entry] }, updatedAt: Date.now() })
        .where(eq(entities.id, parentId))
        .run();
    });
  }

  async reapExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const rows = this.db
      .update(entities)
      .set({ claimedBy: null, claimedAt: null, updatedAt: Date.now() })
      .where(and(not(isNull(entities.claimedBy)), lt(entities.claimedAt, cutoff)))
      .returning({ id: entities.id })
      .all();
    return rows.map((r) => r.id);
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
      .where(eq(entities.id, entityId))
      .run();
  }

  async clearExpiredAffinity(): Promise<string[]> {
    const now = Date.now();
    const rows = this.db
      .update(entities)
      .set({ affinityWorkerId: null, affinityRole: null, affinityExpiresAt: null, updatedAt: now })
      .where(and(not(isNull(entities.affinityWorkerId)), lt(entities.affinityExpiresAt, now)))
      .returning({ id: entities.id })
      .all();
    return rows.map((r) => r.id);
  }
}
