export interface HealthMonitorConfig {
  heartbeatIntervalMs: number;
  deadWorkerThresholdMs: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  heartbeatIntervalMs: 30_000,
  deadWorkerThresholdMs: 300_000,
};
