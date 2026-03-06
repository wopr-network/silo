import { and, eq, isNull, lt, not } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Artifacts, Entity, IEntityRepository, Refs } from "../interfaces.js";
import { entities, entityHistory } from "./schema.js";

export class DrizzleEntityRepository implements IEntityRepository {
  constructor(private db: BetterSQLite3Database) {}

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
      createdAt: new Date(row.createdAt ?? 0),
      updatedAt: new Date(row.updatedAt ?? 0),
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
    };
    await this.db.insert(entities).values(row);
    return this.toEntity(row as typeof entities.$inferSelect);
  }

  async get(id: string): Promise<Entity | null> {
    const rows = await this.db.select().from(entities).where(eq(entities.id, id)).limit(1);
    return rows.length > 0 ? this.toEntity(rows[0]) : null;
  }

  async findByFlowAndState(flowId: string, state: string): Promise<Entity[]> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.flowId, flowId), eq(entities.state, state)));
    return rows.map((r) => this.toEntity(r));
  }

  async transition(id: string, toState: string, trigger: string, artifacts?: Partial<Artifacts>): Promise<Entity> {
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

      tx.insert(entityHistory)
        .values({
          id: crypto.randomUUID(),
          entityId: id,
          fromState: row.state,
          toState,
          trigger,
          invocationId: null,
          timestamp: now,
        })
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
      tx.update(entities).set({ claimedBy: agentId, claimedAt: now }).where(eq(entities.id, row.id)).run();
      return this.toEntity({ ...row, claimedBy: agentId, claimedAt: now } as typeof entities.$inferSelect);
    });
  }

  async reapExpired(ttlMs: number): Promise<string[]> {
    const cutoff = Date.now() - ttlMs;
    const expired = await this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(not(isNull(entities.claimedBy)), lt(entities.claimedAt, cutoff)));
    if (expired.length === 0) return [];
    const ids = expired.map((r) => r.id);
    for (const id of ids) {
      await this.db.update(entities).set({ claimedBy: null, claimedAt: null }).where(eq(entities.id, id));
    }
    return ids;
  }
}
