import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { DomainEvent, IDomainEventRepository } from "../interfaces.js";
import type { Db } from "./db-type.js";
import { isUniqueViolation } from "./is-unique-violation.js";
import { domainEvents } from "./schema.js";

export class DrizzleDomainEventRepository implements IDomainEventRepository {
  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
  ) {}

  async append(type: string, entityId: string, payload: Record<string, unknown>): Promise<DomainEvent> {
    return await this.db.transaction(async (tx: Db) => {
      const [maxRow] = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${domainEvents.sequence}), 0)` })
        .from(domainEvents)
        .where(and(eq(domainEvents.entityId, entityId), eq(domainEvents.tenantId, this.tenantId)));
      const sequence = (Number(maxRow?.maxSeq) || 0) + 1;
      const id = randomUUID();
      const emittedAt = Date.now();

      await tx
        .insert(domainEvents)
        .values({ id, tenantId: this.tenantId, type, entityId, payload, sequence, emittedAt });

      return { id, type, entityId, payload, sequence, emittedAt };
    });
  }

  async getLastSequence(entityId: string): Promise<number> {
    const [row] = await this.db
      .select({ maxSeq: sql<number>`coalesce(max(${domainEvents.sequence}), 0)` })
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, entityId), eq(domainEvents.tenantId, this.tenantId)));
    return Number(row?.maxSeq) || 0;
  }

  async appendCas(
    type: string,
    entityId: string,
    payload: Record<string, unknown>,
    expectedSequence?: number,
  ): Promise<DomainEvent | null> {
    try {
      return await this.db.transaction(async (tx: Db) => {
        const [currentRow] = await tx
          .select({ maxSeq: sql<number>`coalesce(max(${domainEvents.sequence}), 0)` })
          .from(domainEvents)
          .where(and(eq(domainEvents.entityId, entityId), eq(domainEvents.tenantId, this.tenantId)));
        const currentSeq = Number(currentRow?.maxSeq) || 0;
        if (expectedSequence !== undefined && currentSeq !== expectedSequence) {
          return null;
        }
        const newSequence = currentSeq + 1;
        const id = randomUUID();
        const emittedAt = Date.now();
        await tx
          .insert(domainEvents)
          .values({ id, tenantId: this.tenantId, type, entityId, payload, sequence: newSequence, emittedAt });
        return { id, type, entityId, payload, sequence: newSequence, emittedAt };
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return null;
      }
      throw err;
    }
  }

  async list(entityId: string, opts?: { type?: string; limit?: number; minSequence?: number }): Promise<DomainEvent[]> {
    const conditions = [eq(domainEvents.entityId, entityId), eq(domainEvents.tenantId, this.tenantId)];
    if (opts?.type) {
      conditions.push(eq(domainEvents.type, opts.type));
    }
    if (opts?.minSequence !== undefined) {
      conditions.push(gt(domainEvents.sequence, opts.minSequence));
    }

    const rows = await this.db
      .select()
      .from(domainEvents)
      .where(and(...conditions))
      .orderBy(domainEvents.sequence)
      .limit(opts?.limit ?? 100);

    return rows.map((r: typeof domainEvents.$inferSelect) => ({
      id: r.id,
      type: r.type,
      entityId: r.entityId,
      payload: r.payload as Record<string, unknown>,
      sequence: r.sequence,
      emittedAt: r.emittedAt,
    }));
  }
}
