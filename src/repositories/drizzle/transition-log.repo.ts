import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ITransitionLogRepository, TransitionLog } from "../interfaces.js";
import type * as schema from "./schema.js";
import { entityHistory } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

export class DrizzleTransitionLogRepository implements ITransitionLogRepository {
  constructor(private db: Db) {}

  async record(log: Omit<TransitionLog, "id">): Promise<TransitionLog> {
    const id = randomUUID();
    this.db
      .insert(entityHistory)
      .values({
        id,
        entityId: log.entityId,
        fromState: log.fromState ?? null,
        toState: log.toState,
        trigger: log.trigger ?? null,
        invocationId: log.invocationId ?? null,
        timestamp: log.timestamp.getTime(),
      })
      .run();
    return { id, ...log };
  }

  async historyFor(entityId: string): Promise<TransitionLog[]> {
    const rows = this.db
      .select()
      .from(entityHistory)
      .where(eq(entityHistory.entityId, entityId))
      .orderBy(asc(entityHistory.timestamp))
      .all();
    return rows.map((r) => ({
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
