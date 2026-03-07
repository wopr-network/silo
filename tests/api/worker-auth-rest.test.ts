import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { createHttpServer } from "../../src/api/server.js";

const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

function makeTestDeps(workerToken?: string) {
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

  return { engine, mcpDeps, adminToken: undefined, workerToken, stopReaper, sqlite };
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });
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
  let deps: ReturnType<typeof makeTestDeps>;

  beforeAll(async () => {
    deps = makeTestDeps("worker-secret-456");
    server = createHttpServer(deps);
    port = await listen(server);
  });

  afterAll(async () => {
    server.close();
    await deps.stopReaper();
    deps.sqlite.close();
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
