import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { ITransitionLogRepository, TransitionLog } from "../interfaces.js";
import { entityHistory } from "./schema.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat (postgres-js + PGlite)
type Db = any;

export class DrizzleTransitionLogRepository implements ITransitionLogRepository {
  constructor(
    private db: Db,
    private tenantId: string,
  ) {}

  async record(log: Omit<TransitionLog, "id">): Promise<TransitionLog> {
    const id = randomUUID();
    await this.db.insert(entityHistory).values({
      id,
      tenantId: this.tenantId,
      entityId: log.entityId,
      fromState: log.fromState ?? null,
      toState: log.toState,
      trigger: log.trigger ?? null,
      invocationId: log.invocationId ?? null,
      timestamp: log.timestamp.getTime(),
    });
    return { id, ...log };
  }

  async historyFor(entityId: string): Promise<TransitionLog[]> {
    const rows = await this.db
      .select()
      .from(entityHistory)
      .where(and(eq(entityHistory.entityId, entityId), eq(entityHistory.tenantId, this.tenantId)))
      .orderBy(asc(entityHistory.timestamp), asc(entityHistory.seq));
    return rows.map((r: typeof entityHistory.$inferSelect) => ({
      id: r.id,
      entityId: r.entityId,
      fromState: r.fromState,
      toState: r.toState,
      trigger: r.trigger,
      invocationId: r.invocationId,
      timestamp: new Date(r.timestamp),
    }));
  }
}
