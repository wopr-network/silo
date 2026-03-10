import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { serve } from "@hono/node-server";
import { createTestDb } from "../helpers/pg-test-db.js";
import { createScopedRepos } from "../../src/repositories/scoped-repos.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { createHonoApp, type HonoServerDeps } from "../../src/api/hono-server.js";

async function makeTestDeps(workerToken?: string): Promise<HonoServerDeps & { stopReaper: () => Promise<void>; close: () => Promise<void> }> {
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

  return { engine, mcpDeps, adminToken: undefined, workerToken, stopReaper, close };
}

async function request(port: number, method: string, path: string, body?: unknown, token?: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("REST worker auth", () => {
  let server: http.Server;
  let port: number;
  let deps: Awaited<ReturnType<typeof makeTestDeps>>;

  beforeAll(async () => {
    deps = await makeTestDeps("worker-secret-456");
    const app = createHonoApp(deps);
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as http.Server;
    await new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.on("listening", resolve);
    });
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
    await deps.close();
  });

  it("POST /api/flows/test/claim returns 401 without token", async () => {
    const res = await request(port, "POST", "/api/flows/test/claim", { role: "engineering" });
    expect(res.status).toBe(401);
  });

  it("POST /api/flows/test/claim returns 401 with wrong token", async () => {
    const res = await request(port, "POST", "/api/flows/test/claim", { role: "engineering" }, "wrong");
    expect(res.status).toBe(401);
  });

  it("POST /api/flows/test/claim succeeds with correct token (not 401)", async () => {
    const res = await request(port, "POST", "/api/flows/test/claim", { role: "engineering" }, "worker-secret-456");
    // 204 (no work) or 404 (flow not found) — either is fine, NOT 401
    expect(res.status).not.toBe(401);
  });

  it("POST /api/entities/test/report returns 401 without token", async () => {
    const res = await request(port, "POST", "/api/entities/test/report", { signal: "done" });
    expect(res.status).toBe(401);
  });

  it("POST /api/entities/test/fail returns 401 without token", async () => {
    const res = await request(port, "POST", "/api/entities/test/fail", { error: "boom" });
    expect(res.status).toBe(401);
  });

  it("GET /api/entities remains open (no auth required)", async () => {
    const res = await request(port, "GET", "/api/entities?flow=test&state=open");
    expect(res.status).not.toBe(401);
  });

  it("GET /api/flows remains open (no auth required)", async () => {
    const res = await request(port, "GET", "/api/flows");
    expect(res.status).toBe(200);
  });

  it("GET /api/status remains open (no auth required)", async () => {
    const res = await request(port, "GET", "/api/status");
    expect(res.status).toBe(200);
  });
});
