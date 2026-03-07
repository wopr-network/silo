import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Artifacts, IInvocationRepository, Invocation, Mode } from "../interfaces.js";
import type * as schema from "./schema.js";
import { entities, invocations } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

function toInvocation(row: typeof invocations.$inferSelect): Invocation {
  return {
    id: row.id,
    entityId: row.entityId,
    stage: row.stage,
    agentRole: row.agentRole,
    mode: row.mode as Mode,
    prompt: row.prompt,
    context: row.context as Record<string, unknown> | null,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt ? new Date(row.claimedAt) : null,
    startedAt: row.startedAt ? new Date(row.startedAt) : null,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    failedAt: row.failedAt ? new Date(row.failedAt) : null,
    signal: row.signal,
    artifacts: row.artifacts as Artifacts | null,
    error: row.error,
    ttlMs: row.ttlMs ?? 1800000,
  };
}

export class DrizzleInvocationRepository implements IInvocationRepository {
  constructor(private db: Db) {}

  async create(
    entityId: string,
    stage: string,
    prompt: string,
    mode: Mode,
    agentRole?: string,
    ttlMs?: number,
    context?: Record<string, unknown>,
  ): Promise<Invocation> {
    const id = crypto.randomUUID();
    this.db
      .insert(invocations)
      .values({
        id,
        entityId,
        stage,
        prompt,
        mode,
        agentRole: agentRole ?? null,
        ttlMs: ttlMs ?? 1800000,
        context: context ?? null,
        createdAt: Date.now(),
      })
      .run();
    const created = await this.get(id);
    if (!created) throw new Error(`Invocation ${id} not found after insert`);
    return created;
  }

  async get(id: string): Promise<Invocation | null> {
    const rows = this.db.select().from(invocations).where(eq(invocations.id, id)).all();
    return rows.length > 0 ? toInvocation(rows[0]) : null;
  }

  async claim(invocationId: string, agentId: string): Promise<Invocation | null> {
    const now = Date.now();
    const result = this.db
      .update(invocations)
      .set({ claimedBy: agentId, claimedAt: now })
      .where(
        and(
          eq(invocations.id, invocationId),
          isNull(invocations.claimedBy),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .run();

    if (result.changes === 0) return null;
    return this.get(invocationId);
  }

  async complete(id: string, signal: string, artifacts?: Artifacts): Promise<Invocation> {
    const result = this.db
      .update(invocations)
      .set({ completedAt: Date.now(), signal, artifacts: artifacts ?? null })
      .where(and(eq(invocations.id, id), isNull(invocations.completedAt), isNull(invocations.failedAt)))
      .run();

    if (result.changes === 0) {
      const existing = this.db.select().from(invocations).where(eq(invocations.id, id)).all();
      if (existing.length === 0) throw new Error(`Invocation ${id} not found`);
      if (existing[0].completedAt) throw new Error(`Invocation ${id} already completed`);
      if (existing[0].failedAt) throw new Error(`Invocation ${id} already failed`);
      throw new Error(`Invocation ${id} concurrent modification detected`);
    }

    const row = this.db.select().from(invocations).where(eq(invocations.id, id)).all();
    if (row.length === 0) throw new Error(`Invocation ${id} not found after update`);
    return toInvocation(row[0]);
  }

  async fail(id: string, error: string): Promise<Invocation> {
    const result = this.db
      .update(invocations)
      .set({ failedAt: Date.now(), error })
      .where(and(eq(invocations.id, id), isNull(invocations.completedAt), isNull(invocations.failedAt)))
      .run();

    if (result.changes === 0) {
      const existing = this.db.select().from(invocations).where(eq(invocations.id, id)).all();
      if (existing.length === 0) throw new Error(`Invocation ${id} not found`);
      if (existing[0].completedAt) throw new Error(`Invocation ${id} already completed`);
      if (existing[0].failedAt) throw new Error(`Invocation ${id} already failed`);
      throw new Error(`Invocation ${id} concurrent modification detected`);
    }

    const row = this.db.select().from(invocations).where(eq(invocations.id, id)).all();
    if (row.length === 0) throw new Error(`Invocation ${id} not found after update`);
    return toInvocation(row[0]);
  }

  async findByEntity(entityId: string): Promise<Invocation[]> {
    const rows = this.db
      .select()
      .from(invocations)
      .where(eq(invocations.entityId, entityId))
      // order by creation time for stable chronological ordering across databases
      .orderBy(asc(invocations.createdAt))
      .all();
    return rows.map(toInvocation);
  }

  async findUnclaimed(flowId: string, role: string): Promise<Invocation[]> {
    const rows = this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(entities.flowId, flowId),
          eq(invocations.agentRole, role),
          isNull(invocations.claimedBy),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .all();
    return rows.map((r) => toInvocation(r.inv));
  }

  async findByFlow(flowId: string): Promise<Invocation[]> {
    const rows = this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(eq(entities.flowId, flowId))
      // order by creation time for stable chronological ordering across databases
      .orderBy(asc(invocations.createdAt))
      .all();
    return rows.map((r) => toInvocation(r.inv));
  }

  async findUnclaimedActive(flowId?: string): Promise<Invocation[]> {
    const conditions = [
      eq(invocations.mode, "active"),
      isNull(invocations.claimedBy),
      isNull(invocations.completedAt),
      isNull(invocations.failedAt),
    ];
    if (flowId) {
      conditions.push(eq(entities.flowId, flowId));
    }
    const rows = this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(and(...conditions))
      // raw SQL: order by creation time for fair FIFO claim ordering across databases
      .orderBy(asc(invocations.createdAt))
      .all();
    return rows.map((r) => toInvocation(r.inv));
  }

  async countActiveByFlow(flowId: string): Promise<number> {
    const rows = this.db
      .select({ count: sql<number>`count(*)` })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(entities.flowId, flowId),
          isNotNull(invocations.claimedAt),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .get();
    return rows?.count ?? 0;
  }

  async countPendingByFlow(flowId: string): Promise<number> {
    const rows = this.db
      .select({ count: sql<number>`count(*)` })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(entities.flowId, flowId),
          isNull(invocations.claimedAt),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .get();
    return rows?.count ?? 0;
  }

  async reapExpired(): Promise<Invocation[]> {
    const now = Date.now();
    const rows = this.db
      .update(invocations)
      .set({ claimedBy: null, claimedAt: null })
      .where(
        and(
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
          sql`${invocations.claimedBy} IS NOT NULL`,
          sql`${invocations.claimedAt} + ${invocations.ttlMs} < ${now}`,
        ),
      )
      .returning()
      .all();

    return rows.map(toInvocation);
  }
}
