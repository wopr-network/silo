import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { entityActivity } from "../schema.js";
import type { ActivityRow, IEntityActivityRepo } from "./i-entity-activity-repo.js";

function toRow(raw: typeof entityActivity.$inferSelect): ActivityRow {
  return {
    id: raw.id,
    entityId: raw.entityId,
    slotId: raw.slotId,
    seq: raw.seq,
    type: raw.type as ActivityRow["type"],
    data: (() => {
      try {
        return JSON.parse(raw.data) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    createdAt: raw.createdAt,
  };
}

export class DrizzleEntityActivityRepo implements IEntityActivityRepo {
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async insert(input: Omit<ActivityRow, "id" | "seq" | "createdAt">): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();
    // Wrap in a Postgres transaction to ensure nextSeq + insert are atomic.
    // The UNIQUE (entity_id, seq) constraint is the hard guard — this transaction
    // prevents the gap between computing seq and writing it.
    await this.db.transaction(async (tx) => {
      const [seqRow] = await tx
        .select({ maxSeq: sql<number>`MAX(seq)` })
        .from(entityActivity)
        .where(and(eq(entityActivity.entityId, input.entityId), eq(entityActivity.tenantId, this.tenantId)));
      // Postgres returns bigint as string — coerce to number to avoid string concatenation.
      const seq = Number(seqRow?.maxSeq ?? -1) + 1;
      await tx.insert(entityActivity).values({
        id,
        tenantId: this.tenantId,
        entityId: input.entityId,
        slotId: input.slotId,
        seq,
        type: input.type,
        data: JSON.stringify(input.data),
        createdAt: now,
      });
    });
  }

  async getByEntity(entityId: string, since?: number): Promise<ActivityRow[]> {
    const base = and(eq(entityActivity.entityId, entityId), eq(entityActivity.tenantId, this.tenantId));
    const conditions = since !== undefined ? and(base, gt(entityActivity.seq, since)) : base;
    const rows = await this.db.select().from(entityActivity).where(conditions).orderBy(asc(entityActivity.seq));
    return rows.map(toRow);
  }

  async getSummary(entityId: string): Promise<string> {
    const rawRows = await this.db
      .select()
      .from(entityActivity)
      .where(and(eq(entityActivity.entityId, entityId), eq(entityActivity.tenantId, this.tenantId)))
      .orderBy(asc(entityActivity.seq));
    const rows = rawRows.map(toRow);
    if (rows.length === 0) return "";

    const bySlot = new Map<string, ActivityRow[]>();
    for (const row of rows) {
      const bucket = bySlot.get(row.slotId) ?? [];
      bucket.push(row);
      bySlot.set(row.slotId, bucket);
    }

    const attempts: string[] = [];
    let attemptNum = 1;
    const slots = [...bySlot.entries()].sort((a, b) => (a[1][0]?.seq ?? 0) - (b[1][0]?.seq ?? 0));
    for (const [, events] of slots) {
      const lines: string[] = [`Attempt ${attemptNum}:`];
      for (const event of events) {
        if (event.type === "tool_use") {
          // Skip — tool call inputs bloat the prompt without useful context
        } else if (event.type === "text") {
          const d = event.data as { text?: string };
          const text = (d.text ?? "").replace(/\n/g, " ").trim();
          if (text) lines.push(`  - Said: "${text}"`);
        } else if (event.type === "result") {
          const d = event.data as { subtype?: string; cost_usd?: number };
          lines.push(`  - Ended: ${d.subtype ?? "unknown"} (cost: $${(d.cost_usd ?? 0).toFixed(4)})`);
        }
      }
      attempts.push(lines.join("\n"));
      attemptNum++;
    }

    return `Prior work on this entity:\n\n${attempts.join("\n\n")}\n\nPlease pick up where the last attempt left off.`;
  }

  async deleteByEntity(entityId: string): Promise<void> {
    await this.db
      .delete(entityActivity)
      .where(and(eq(entityActivity.entityId, entityId), eq(entityActivity.tenantId, this.tenantId)));
  }
}
