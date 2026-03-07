import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../src/repositories/drizzle/schema.js";
import { DrizzleEntityRepository } from "../../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleInvocationRepository } from "../../src/repositories/drizzle/invocation.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";
import { DrizzleTransitionLogRepository } from "../../src/repositories/drizzle/transition-log.repo.js";
import { DrizzleEventRepository } from "../../src/repositories/drizzle/event.repo.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { createHttpServer, type HttpServerDeps } from "../../src/api/server.js";
import { Router } from "../../src/api/router.js";

const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

function makeTestDeps(): HttpServerDeps & { stopReaper: () => Promise<void> } {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const entityRepo = new DrizzleEntityRepository(db);
  const flowRepo = new DrizzleFlowRepository(db);
  const invocationRepo = new DrizzleInvocationRepository(db);
  const gateRepo = new DrizzleGateRepository(db);
  const transitionLogRepo = new DrizzleTransitionLogRepository(db);
  const eventRepo = new DrizzleEventRepository(db);
  const eventEmitter = new EventEmitter();

  const engine = new Engine({
    entityRepo,
    flowRepo,
    invocationRepo,
    gateRepo,
    transitionLogRepo,
    adapters: new Map(),
    eventEmitter,
  });

  const stopReaper = engine.startReaper(5000, 300000);

  const mcpDeps = {
    entities: entityRepo,
    flows: flowRepo,
    invocations: invocationRepo,
    gates: gateRepo,
    transitions: transitionLogRepo,
    eventRepo,
    engine,
  };

  return { engine, mcpDeps, adminToken: undefined, stopReaper };
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });
}

// ─── Router unit tests ───────────────────────────────────────────────────────

describe("Router", () => {
  it("matches a parameterized route", () => {
    const router = new Router();
    const handler = async () => ({ status: 200, body: { ok: true } });
    router.add("GET", "/api/flows/:id", handler);

    const match = router.match("GET", "/api/flows/abc-123");
    expect(match).not.toBeNull();
    expect(match!.params).toEqual({ id: "abc-123" });
  });

  it("returns null for unmatched routes", () => {
    const router = new Router();
    const match = router.match("GET", "/api/unknown");
    expect(match).toBeNull();
  });

  it("distinguishes methods", () => {
    const router = new Router();
    const handler = async () => ({ status: 200, body: {} });
    router.add("POST", "/api/entities", handler);
    expect(router.match("GET", "/api/entities")).toBeNull();
    expect(router.match("POST", "/api/entities")).not.toBeNull();
  });
});

// ─── HTTP server integration tests ───────────────────────────────────────────

describe("HTTP Server - basic", () => {
  let deps: ReturnType<typeof makeTestDeps>;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    deps = makeTestDeps();
    server = createHttpServer(deps);
    port = await listen(server);
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
  });

  it("GET /api/status returns engine status", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("flows");
    expect(body).toHaveProperty("activeInvocations");
    expect(body).toHaveProperty("pendingClaims");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("GET /api/flows returns empty array initially", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/flows`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("GET /api/entities without query params returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities`);
    expect(res.status).toBe(400);
  });

  it("POST /api/entities with missing flow returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/entities with unknown flow returns 4xx", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow: "nonexistent-flow" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/entities/:id for missing entity returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("OPTIONS preflight returns 204", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:4000" },
    });
    expect(res.status).toBe(204);
  });

  it("DELETE /api/flows/:id returns 501", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/flows/some-flow`, {
      method: "DELETE",
    });
    expect(res.status).toBe(501);
  });

  it("POST /api/flows/:flow/claim returns 204 when no work available", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/flows/nonexistent/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "worker" }),
    });
    // No work available → 204 (no entity) or 404 (unknown flow)
    expect([204, 404]).toContain(res.status);
  });

  it("POST with invalid JSON returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("CORS header not set for non-loopback origin", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Origin: "https://evil.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("CORS header set for loopback origin", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Origin: "http://127.0.0.1:3000" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:3000");
  });

  it("OPTIONS without Origin returns 204 without CORS headers", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("GET /api/entities with only flow param returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities?flow=test`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Required query params: flow, state");
  });

  it("GET /api/entities with only state param returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities?state=init`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Required query params: flow, state");
  });

  it("GET /api/entities with valid flow+state returns non-400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities?flow=test&state=init`);
    expect(res.status).not.toBe(400);
  });

  it("GET /api/entities with limit param returns non-400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities?flow=test&state=init&limit=5`);
    expect(res.status).not.toBe(400);
  });

  it("GET /api/entities with invalid limit param ignored", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities?flow=test&state=init&limit=abc`);
    expect(res.status).not.toBe(400);
  });

  it("GET /api/flows/:id for unknown flow returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/flows/nonexistent-flow-xyz`);
    expect(res.status).toBe(404);
  });

  it("POST /api/claim returns 204 when no work available", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "worker" }),
    });
    expect([204, 200].includes(res.status)).toBe(true);
  });

  it("POST /api/entities/:id/report for nonexistent entity", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities/nonexistent/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "done" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/entities/:id/report with artifacts", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities/nonexistent/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: "done", artifacts: { key: "value" } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/entities/:id/fail for nonexistent entity", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/entities/nonexistent/fail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "something broke" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("HTTP Server - explicit CORS origin", () => {
  let deps: ReturnType<typeof makeTestDeps>;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    deps = makeTestDeps();
    (deps as unknown as Record<string, unknown>).corsOrigin = "https://app.example.com";
    server = createHttpServer(deps);
    port = await listen(server);
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
  });

  it("reflects matching explicit CORS origin", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Origin: "https://app.example.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("does not reflect non-matching origin", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Origin: "https://other.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not reflect loopback when explicit origin is set", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Origin: "http://localhost:4000" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("HTTP Server - handler error", () => {
  let server: http.Server;
  let port: number;
  let stopReaper: () => Promise<void>;

  beforeAll(async () => {
    const deps = makeTestDeps();
    stopReaper = deps.stopReaper;
    deps.engine.getStatus = async () => {
      throw new Error("boom");
    };
    server = createHttpServer(deps);
    port = await listen(server);
  });

  afterAll(async () => {
    server.close();
    await stopReaper();
  });

  it("returns 500 when handler throws", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
