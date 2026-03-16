/**
 * Runner Gate Client — delegates primitive gate evaluation to a holyshipper runner.
 *
 * Instead of evaluating gates locally (calling GitHub API directly), this handler
 * sends the gate request to the runner's POST /gate endpoint. The runner evaluates
 * locally and returns the outcome. The cloud never sees the underlying data.
 *
 * This is a drop-in replacement for the local PrimitiveOpHandler — the engine
 * doesn't know or care whether gates are evaluated locally or on a runner.
 */

import { logger } from "../logger.js";
import type { Entity } from "../repositories/interfaces.js";

/** Handler signature matching the engine's PrimitiveOpHandler contract. */
export type RunnerPrimitiveOpHandler = (
  primitiveOp: string,
  params: Record<string, unknown>,
  entity: Entity,
) => Promise<{ outcome: string; message?: string }>;

export interface RunnerGateClientConfig {
  /** Function to resolve the runner URL for a given entity. */
  resolveRunnerUrl: (entity: Entity) => Promise<string | null>;
  /** Timeout for the HTTP request to the runner, in ms. Default 30s. */
  requestTimeoutMs?: number;
}

/**
 * Create a PrimitiveOpHandler that delegates to a holyshipper runner.
 * Returns the standard { outcome, message } shape expected by the gate evaluator.
 */
export function createRunnerGateHandler(config: RunnerGateClientConfig): RunnerPrimitiveOpHandler {
  const requestTimeout = config.requestTimeoutMs ?? 30_000;

  return async (primitiveOp: string, params: Record<string, unknown>, entity: Entity) => {
    const runnerUrl = await config.resolveRunnerUrl(entity);
    if (!runnerUrl) {
      return { outcome: "error", message: "No runner available for entity" };
    }

    const gateId = `gate-${entity.id}-${Date.now()}`;
    const body = JSON.stringify({
      gateId,
      entityId: entity.id,
      op: primitiveOp,
      params,
    });

    logger.info(`[runner-gate] delegating gate to runner`, {
      entityId: entity.id,
      op: primitiveOp,
      runnerUrl,
      gateId,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeout);

    try {
      const res = await fetch(`${runnerUrl.replace(/\/$/, "")}/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error(`[runner-gate] runner returned error`, {
          entityId: entity.id,
          op: primitiveOp,
          status: res.status,
          body: text.slice(0, 200),
        });
        return { outcome: "error", message: `Runner error: HTTP ${res.status}` };
      }

      const result = (await res.json()) as { outcome: string; message?: string; durationMs?: number };

      logger.info(`[runner-gate] gate result received`, {
        entityId: entity.id,
        op: primitiveOp,
        outcome: result.outcome,
        durationMs: result.durationMs,
      });

      return { outcome: result.outcome, message: result.message };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const message = isTimeout
        ? `Runner gate timed out after ${requestTimeout}ms`
        : `Runner gate error: ${err instanceof Error ? err.message : String(err)}`;

      logger.error(`[runner-gate] request failed`, {
        entityId: entity.id,
        op: primitiveOp,
        error: message,
        isTimeout,
      });

      return { outcome: isTimeout ? "timeout" : "error", message };
    } finally {
      clearTimeout(timeout);
    }
  };
}
