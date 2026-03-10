import { logger } from "../logger.js";
import type { Pool } from "../pool/pool.js";
import type { SiloClient } from "../silo-client/client.js";
import type { HealthMonitorConfig } from "./types.js";

export class HealthMonitor {
  private pool: Pool;
  private silo: SiloClient;
  private config: HealthMonitorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;

  constructor(pool: Pool, silo: SiloClient, config: HealthMonitorConfig) {
    this.pool = pool;
    this.silo = silo;
    this.config = config;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = true;
      this.check().finally(() => {
        this.checking = false;
      });
    }, this.config.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    const now = Date.now();
    const slots = this.pool.activeSlots();

    for (const slot of slots) {
      if (slot.state === "reporting") continue;
      if (now - slot.lastHeartbeat <= this.config.deadWorkerThresholdMs) continue;

      // Capture heartbeat timestamp before the async call so we can detect
      // a heartbeat arriving during the await (which would change the value).
      const heartbeatBefore = slot.lastHeartbeat;

      if (slot.entityId) {
        try {
          await this.silo.report({
            entityId: slot.entityId,
            signal: "fail",
            artifacts: { reason: "worker_timeout" },
          });
        } catch (err) {
          logger.error("[HealthMonitor] Error reporting dead slot", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Re-check: if lastHeartbeat advanced during the await, the worker is alive — skip release.
      if (slot.lastHeartbeat !== heartbeatBefore) {
        logger.warn("[health-monitor] heartbeat received during fail report — slot not released");
        continue;
      }

      try {
        this.pool.release(slot.slotId);
      } catch (err) {
        logger.error("[HealthMonitor] Error releasing slot", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
