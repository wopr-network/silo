/**
 * Engine REST routes for holyshippers (workers).
 *
 * These are plain HTTP endpoints that holyshippers call to:
 * - Claim work (POST /claim, POST /flows/:flow/claim)
 * - Report signals (POST /entities/:id/report)
 * - Report failures (POST /entities/:id/fail)
 * - Get entity details (GET /entities/:id)
 * - Get engine status (GET /status)
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Engine } from "../engine/engine.js";
import type { IEntityRepository, IFlowRepository } from "../repositories/interfaces.js";

export interface EngineRouteDeps {
  engine: Engine;
  entities: IEntityRepository;
  flows: IFlowRepository;
  workerToken?: string;
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createEngineRoutes(deps: EngineRouteDeps): Hono {
  const app = new Hono();

  // Worker auth middleware
  app.use("/*", async (c, next) => {
    if (!deps.workerToken) return next();
    const auth = c.req.header("Authorization");
    if (!auth) return c.json({ error: "Missing Authorization header" }, 401);
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return c.json({ error: "Invalid Authorization format" }, 401);
    }
    if (!tokensMatch(parts[1], deps.workerToken)) {
      return c.json({ error: "Invalid token" }, 403);
    }
    return next();
  });

  // POST /claim — claim next available entity (any flow)
  app.post("/claim", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const workerId = (body.worker_id as string) ?? undefined;
    const role = (body.role as string) ?? "engineering";
    const result = await deps.engine.claimWork(role, undefined, workerId);
    if (!result) {
      return c.json({ next_action: "check_back", retry_after_ms: 30_000, message: "No work available" }, 200);
    }
    return c.json(result, 200);
  });

  // POST /flows/:flow/claim — claim from specific flow
  app.post("/flows/:flow/claim", async (c) => {
    const flowName = c.req.param("flow");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const workerId = (body.worker_id as string) ?? undefined;
    const role = (body.role as string) ?? "engineering";
    const result = await deps.engine.claimWork(role, flowName, workerId);
    if (!result) {
      return c.json({ next_action: "check_back", retry_after_ms: 30_000, message: "No work available" }, 200);
    }
    return c.json(result, 200);
  });

  // POST /entities/:id/report — report a signal
  app.post("/entities/:id/report", async (c) => {
    const entityId = c.req.param("id");
    const body = (await c.req.json()) as Record<string, unknown>;
    const signal = body.signal as string;
    if (!signal) return c.json({ error: "signal is required" }, 400);
    const artifacts = (body.artifacts as Record<string, unknown>) ?? undefined;
    const result = await deps.engine.processSignal(entityId, signal, artifacts);
    return c.json(result, 200);
  });

  // POST /entities/:id/fail — report failure
  app.post("/entities/:id/fail", async (c) => {
    const entityId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = (body.reason as string) ?? "unknown";
    const result = await deps.engine.processSignal(entityId, "fail", { failureReason: reason });
    return c.json(result, 200);
  });

  // GET /entities/:id — get entity
  app.get("/entities/:id", async (c) => {
    const entity = await deps.entities.get(c.req.param("id"));
    if (!entity) return c.json({ error: "Not found" }, 404);
    return c.json(entity, 200);
  });

  // GET /entities — list entities
  app.get("/entities", async (c) => {
    const flowId = c.req.query("flowId");
    const state = c.req.query("state");
    const limit = Number(c.req.query("limit") || 50);
    if (flowId && state) {
      const entities = await deps.entities.findByFlowAndState(flowId, state, limit);
      return c.json(entities, 200);
    }
    // Default: return all (limited)
    const entities = await deps.entities.findByFlowAndState("*", "*", limit);
    return c.json(entities, 200);
  });

  // POST /entities — create entity (admin/testing)
  app.post("/entities", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const flow = (body.flow as string) ?? "engineering";
    const refs = (body.refs as Record<string, unknown>) ?? {};
    const entity = await deps.engine.createEntity(flow, undefined, refs);
    return c.json(entity, 201);
  });

  // GET /status — engine status
  app.get("/status", async (c) => {
    const status = await deps.engine.getStatus();
    return c.json(status, 200);
  });

  return app;
}
