export interface ThroughputStats {
  completed_last_hour: number;
  failed_last_hour: number;
  avg_duration_ms: number;
}

export interface IThroughputRepo {
  record(outcome: "completed" | "failed", durationMs: number): void;
  getStats(): ThroughputStats;
  pruneOlderThan(cutoff: number): void;
}
