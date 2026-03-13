import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { serve } from "@hono/node-server";
import { createTestDb } from "../helpers/pg-test-db.js";
import { createScopedRepos } from "../../src/repositories/scoped-repos.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { createHonoApp, type HonoServerDeps } from "../../src/api/hono-server.js";

async function makeTestDeps(
  rateLimits?: HonoServerDeps["rateLimits"],
): Promise<HonoServerDeps & { stopReaper: () => Promise<void>; closeDb: () => Promise<void> }> {
  const { db, close } = await createTestDb();
  const repos = createScopedRepos(db, "test-tenant");
  const eventEmitter = new EventEmitter();
  const engine = new Engine({
    entityRepo: repos.entities,
    flowRepo: repos.flows,
    invocationRepo: repos.invocations,
    gateRepo: repos.gates,
    transitionLogRepo: repos.transitionLog,
    adapters: new Map(),
    eventEmitter,
  });
  const stopReaper = engine.startReaper(5000, 300000);
  const mcpDeps = {
    entities: repos.entities,
    flows: repos.flows,
    invocations: repos.invocations,
    gates: repos.gates,
    transitions: repos.transitionLog,
    eventRepo: repos.events,
    engine,
  };
  return {
    engine,
    mcpDeps,
    db,
    defaultTenantId: "test-tenant",
    eventEmitter,
    adminToken: "test-admin-token",
    workerToken: "test-worker-token",
    rateLimits,
    stopReaper,
    closeDb: close,
  };
}

async function startTestServer(deps: HonoServerDeps): Promise<{ server: http.Server; port: number }> {
  const app = createHonoApp(deps);
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as http.Server;
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.on("listening", resolve);
  });
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

const workerHeaders = { Authorization: "Bearer test-worker-token" };

describe("Rate limiting — allows requests under limit", () => {
  let deps: Awaited<ReturnType<typeof makeTestDeps>>;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    deps = await makeTestDeps({
      writeMaxRequests: 3,
      workerMaxRequests: 3,
      windowMs: 60_000,
    });
    const result = await startTestServer(deps);
    server = result.server;
    port = result.port;
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
    await deps.closeDb();
  });

  it("allows requests under the rate limit", async () => {
    // 3 requests should all succeed with a fresh server (budget = 3)
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders },
        body: JSON.stringify({ flow: "nonexistent" }),
      });
      expect(res.status).not.toBe(429);
    }
  });
});

describe("Rate limiting — 429 enforcement", () => {
  let deps: Awaited<ReturnType<typeof makeTestDeps>>;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    // Fresh server per describe so each test starts with a clean bucket
    deps = await makeTestDeps({
      writeMaxRequests: 3,
      workerMaxRequests: 3,
      windowMs: 60_000,
    });
    const result = await startTestServer(deps);
    server = result.server;
    port = result.port;
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
    await deps.closeDb();
  });

  it("returns 429 when rate limit is exceeded on POST /api/entities", async () => {
    // Exhaust the full budget (3) within this test, then assert the 4th is rejected
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders },
        body: JSON.stringify({ flow: "nonexistent" }),
      });
      expect(res.status).not.toBe(429);
    }
    const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...workerHeaders },
      body: JSON.stringify({ flow: "nonexistent" }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Rate limit exceeded");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 429 when rate limit is exceeded on POST /api/claim", async () => {
    // Exhaust claim limit (3 allowed, then 429)
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders },
        body: JSON.stringify({ role: "worker" }),
      });
      expect(res.status).not.toBe(429);
    }
    const res = await fetch(`http://127.0.0.1:${port}/api/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...workerHeaders },
      body: JSON.stringify({ role: "worker" }),
    });
    expect(res.status).toBe(429);
  });

  it("does not rate-limit GET endpoints", async () => {
    // GET /api/status should never return 429 even after many requests
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
        headers: workerHeaders,
      });
      expect(res.status).not.toBe(429);
    }
  });
});

describe("Rate limiting with defaults (no config override)", () => {
  let deps: Awaited<ReturnType<typeof makeTestDeps>>;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    // No rateLimits config — rate limiting should still apply with defaults
    deps = await makeTestDeps();
    const result = await startTestServer(deps);
    server = result.server;
    port = result.port;
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
    await deps.closeDb();
  });

  it("applies default rate limits (30 req/min for writes) without 429 under normal load", async () => {
    // 5 requests should be well under the default 30/min limit
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders },
        body: JSON.stringify({ flow: "nonexistent" }),
      });
      expect(res.status).not.toBe(429);
    }
  });
});
