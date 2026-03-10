import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { ConflictError, InternalError, NotFoundError } from "../../errors.js";
import type { Artifacts, IInvocationRepository, Invocation, Mode } from "../interfaces.js";
import type { Db } from "./db-type.js";
import { entities, invocations } from "./schema.js";

function toInvocation(row: typeof invocations.$inferSelect): Invocation {
  return {
    id: row.id,
    entityId: row.entityId,
    stage: row.stage,
    agentRole: row.agentRole ?? null,
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
  constructor(
    private db: Db,
    private tenantId: string,
  ) {}

  async create(
    entityId: string,
    stage: string,
    prompt: string,
    mode: Mode,
    ttlMs: number | undefined,
    context: Record<string, unknown> | undefined,
    agentRole: string | null,
  ): Promise<Invocation> {
    const id = crypto.randomUUID();
    await this.db.insert(invocations).values({
      id,
      tenantId: this.tenantId,
      entityId,
      stage,
      agentRole: agentRole || null,
      prompt,
      mode,
      ttlMs: ttlMs ?? 1800000,
      context: context ?? null,
      createdAt: Date.now(),
    });
    const created = await this.get(id);
    if (!created) throw new InternalError(`Invocation ${id} not found after insert`);
    return created;
  }

  async get(id: string): Promise<Invocation | null> {
    const rows = await this.db
      .select()
      .from(invocations)
      .where(and(eq(invocations.id, id), eq(invocations.tenantId, this.tenantId)))
      .limit(1);
    return rows.length > 0 ? toInvocation(rows[0]) : null;
  }

  async claim(invocationId: string, agentId: string): Promise<Invocation | null> {
    const now = Date.now();
    const updated = await this.db
      .update(invocations)
      .set({ claimedBy: agentId, claimedAt: now })
      .where(
        and(
          eq(invocations.id, invocationId),
          eq(invocations.tenantId, this.tenantId),
          isNull(invocations.claimedBy),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .returning();

    if (updated.length === 0) return null;
    return this.get(invocationId);
  }

  async complete(id: string, signal: string, artifacts?: Artifacts): Promise<Invocation> {
    const updated = await this.db
      .update(invocations)
      .set({ completedAt: Date.now(), signal, artifacts: artifacts ?? null })
      .where(
        and(
          eq(invocations.id, id),
          eq(invocations.tenantId, this.tenantId),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .returning();

    if (updated.length === 0) {
      const [existing] = await this.db
        .select()
        .from(invocations)
        .where(and(eq(invocations.id, id), eq(invocations.tenantId, this.tenantId)))
        .limit(1);
      if (!existing) throw new NotFoundError(`Invocation ${id} not found`);
      if (existing.completedAt) throw new ConflictError(`Invocation ${id} already completed`);
      if (existing.failedAt) throw new ConflictError(`Invocation ${id} already failed`);
      throw new ConflictError(`Invocation ${id} concurrent modification detected`);
    }

    return toInvocation(updated[0]);
  }

  async fail(id: string, error: string): Promise<Invocation> {
    const updated = await this.db
      .update(invocations)
      .set({ failedAt: Date.now(), error })
      .where(
        and(
          eq(invocations.id, id),
          eq(invocations.tenantId, this.tenantId),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .returning();

    if (updated.length === 0) {
      const [existing] = await this.db
        .select()
        .from(invocations)
        .where(and(eq(invocations.id, id), eq(invocations.tenantId, this.tenantId)))
        .limit(1);
      if (!existing) throw new NotFoundError(`Invocation ${id} not found`);
      if (existing.completedAt) throw new ConflictError(`Invocation ${id} already completed`);
      if (existing.failedAt) throw new ConflictError(`Invocation ${id} already failed`);
      throw new ConflictError(`Invocation ${id} concurrent modification detected`);
    }

    return toInvocation(updated[0]);
  }

  async releaseClaim(id: string): Promise<void> {
    await this.db
      .update(invocations)
      .set({ claimedBy: null, claimedAt: null })
      .where(
        and(
          eq(invocations.id, id),
          eq(invocations.tenantId, this.tenantId),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      );
  }

  async findByEntity(entityId: string): Promise<Invocation[]> {
    const rows = await this.db
      .select()
      .from(invocations)
      .where(and(eq(invocations.entityId, entityId), eq(invocations.tenantId, this.tenantId)))
      .orderBy(asc(invocations.createdAt));
    return rows.map(toInvocation);
  }

  async findUnclaimedWithAffinity(flowId: string, role: string, workerId: string): Promise<Invocation[]> {
    const now = Date.now();
    const rows = await this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(invocations.tenantId, this.tenantId),
          eq(entities.flowId, flowId),
          isNull(invocations.claimedBy),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
          eq(entities.affinityWorkerId, workerId),
          eq(entities.affinityRole, role),
          sql`${entities.affinityExpiresAt} > ${now}`,
        ),
      );
    return rows.map((r: { inv: typeof invocations.$inferSelect }) => toInvocation(r.inv));
  }

  async findUnclaimedByFlow(flowId: string): Promise<Invocation[]> {
    const rows = await this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(invocations.tenantId, this.tenantId),
          eq(entities.flowId, flowId),
          isNull(invocations.claimedBy),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      );
    return rows.map((r: { inv: typeof invocations.$inferSelect }) => toInvocation(r.inv));
  }

  async findByFlow(flowId: string): Promise<Invocation[]> {
    const rows = await this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(and(eq(invocations.tenantId, this.tenantId), eq(entities.flowId, flowId)))
      .orderBy(asc(invocations.createdAt));
    return rows.map((r: { inv: typeof invocations.$inferSelect }) => toInvocation(r.inv));
  }

  async findUnclaimedActive(flowId?: string): Promise<Invocation[]> {
    const conditions = [
      eq(invocations.tenantId, this.tenantId),
      eq(invocations.mode, "active"),
      isNull(invocations.claimedBy),
      isNull(invocations.completedAt),
      isNull(invocations.failedAt),
    ];
    if (flowId) {
      conditions.push(eq(entities.flowId, flowId));
    }
    const rows = await this.db
      .select({ inv: invocations })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(and(...conditions))
      .orderBy(asc(invocations.createdAt));
    return rows.map((r: { inv: typeof invocations.$inferSelect }) => toInvocation(r.inv));
  }

  async countActiveByFlow(flowId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(invocations.tenantId, this.tenantId),
          eq(entities.flowId, flowId),
          isNotNull(invocations.claimedAt),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .limit(1);
    return Number(row?.count ?? 0);
  }

  async countPendingByFlow(flowId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(invocations)
      .innerJoin(entities, eq(invocations.entityId, entities.id))
      .where(
        and(
          eq(invocations.tenantId, this.tenantId),
          eq(entities.flowId, flowId),
          isNull(invocations.claimedAt),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
        ),
      )
      .limit(1);
    return Number(row?.count ?? 0);
  }

  async reapExpired(): Promise<Invocation[]> {
    const now = Date.now();
    const rows = await this.db
      .update(invocations)
      .set({ claimedBy: null, claimedAt: null })
      .where(
        and(
          eq(invocations.tenantId, this.tenantId),
          isNull(invocations.completedAt),
          isNull(invocations.failedAt),
          sql`${invocations.claimedBy} IS NOT NULL`,
          sql`${invocations.claimedAt} + ${invocations.ttlMs} < ${now}`,
        ),
      )
      .returning();

    return rows.map(toInvocation);
  }
}
