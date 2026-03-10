import { randomUUID } from "node:crypto";
import { gt, sql } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { throughputEvents } from "../schema.js";
import type { IThroughputRepo, ThroughputStats } from "./i-throughput-repo.js";

const ONE_HOUR_MS = 3_600_000;

export class DrizzleThroughputRepo implements IThroughputRepo {
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async record(outcome: "completed" | "failed", durationMs: number): Promise<void> {
    const now = Date.now();
    await this.db
      .insert(throughputEvents)
      .values({ id: randomUUID(), tenantId: this.tenantId, outcome, durationMs, createdAt: now });
  }

  async getStats(): Promise<ThroughputStats> {
    const cutoff = Date.now() - ONE_HOUR_MS;
    const rows = await this.db.select().from(throughputEvents).where(gt(throughputEvents.createdAt, cutoff));

    let completed = 0;
    let failed = 0;
    let totalDuration = 0;

    for (const row of rows) {
      if (row.outcome === "completed") {
        completed++;
        totalDuration += row.durationMs;
      } else {
        failed++;
      }
    }

    return {
      completed_last_hour: completed,
      failed_last_hour: failed,
      avg_duration_ms: completed > 0 ? Math.round(totalDuration / completed) : 0,
    };
  }

  async pruneOlderThan(cutoff: number): Promise<void> {
    await this.db.delete(throughputEvents).where(sql`created_at < ${cutoff}`);
  }
}
