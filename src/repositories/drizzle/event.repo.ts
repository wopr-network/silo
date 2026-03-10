import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { EventRow, IEventRepository } from "../interfaces.js";
import { events } from "./schema.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat (postgres-js + PGlite)
type Db = any;

export class DrizzleEventRepository implements IEventRepository {
  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
  ) {}

  async emitDefinitionChanged(flowId: string | null, tool: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.insert(events).values({
      id: randomUUID(),
      tenantId: this.tenantId,
      type: "definition.changed",
      entityId: null,
      flowId: flowId || null,
      payload: { tool, ...payload },
      emittedAt: Date.now(),
    });
  }

  async findAll(): Promise<(typeof events.$inferSelect)[]> {
    return this.db.select().from(events).where(eq(events.tenantId, this.tenantId));
  }

  async findByEntity(entityId: string, limit = 100): Promise<EventRow[]> {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.entityId, entityId), eq(events.tenantId, this.tenantId)))
      .orderBy(desc(events.emittedAt))
      .limit(limit) as Promise<EventRow[]>;
  }

  async findRecent(limit = 100): Promise<EventRow[]> {
    return this.db
      .select()
      .from(events)
      .where(eq(events.tenantId, this.tenantId))
      .orderBy(desc(events.emittedAt))
      .limit(limit) as Promise<EventRow[]>;
  }
}
