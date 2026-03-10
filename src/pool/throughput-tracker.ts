import type { IThroughputRepo } from "../radar-db/repos/i-throughput-repo.js";

const ONE_HOUR_MS = 3_600_000;

export class ThroughputTracker {
  constructor(private repo: IThroughputRepo) {}

  record(outcome: "completed" | "failed", durationMs: number): void {
    this.repo.record(outcome, durationMs);
    this.repo.pruneOlderThan(Date.now() - ONE_HOUR_MS);
  }

  getStats(): { completed_last_hour: number; failed_last_hour: number; avg_duration_ms: number } {
    return this.repo.getStats();
  }
}
