import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp, ADMIN_TOKEN, WORKER_TOKEN, type TestApp } from "../helpers/test-app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(__dirname, "../fixtures/outer-layer-flow.seed.json");

describe("Auth boundary — unauthenticated requests", () => {
  let t: TestApp;

  beforeAll(async () => { t = await createTestApp({ seedPath: SEED }); });
  afterAll(async () => { await t.close(); });

  // ── Worker-auth routes (requireWorkerAuth) ──
  const workerRoutes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: "POST", path: "/api/claim", body: { role: "eng" } },
    { method: "POST", path: "/api/flows/outer-test-flow/claim", body: { role: "eng" } },
    { method: "POST", path: "/api/entities/fake-id/report", body: { signal: "done" } },
    { method: "POST", path: "/api/entities/fake-id/fail", body: { error: "boom" } },
    { method: "POST", path: "/api/entities", body: { flow: "outer-test-flow" } },
  ];

  for (const route of workerRoutes) {
    it(`${route.method} ${route.path} returns 401 without token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: { "Content-Type": "application/json" },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).toBe(401);
    });

    it(`${route.method} ${route.path} returns 401 with wrong token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).toBe(401);
    });

    it(`${route.method} ${route.path} does NOT return 401 with correct worker token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_TOKEN}` },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).not.toBe(401);
    });
  }

  // ── Auth routes (requireAuth — accepts worker OR admin) ──
  const authRoutes: Array<{ method: string; path: string }> = [
    { method: "GET", path: "/api/status" },
    { method: "GET", path: "/api/entities?flow=outer-test-flow&state=open" },
    { method: "GET", path: "/api/entities/fake-id" },
    { method: "GET", path: "/api/flows" },
    { method: "GET", path: "/api/flows/outer-test-flow" },
  ];

  for (const route of authRoutes) {
    it(`${route.method} ${route.path} returns 401 without token`, async () => {
      const res = await t.app.request(route.path, { method: route.method });
      expect(res.status).toBe(401);
    });

    it(`${route.method} ${route.path} accepts worker token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
      });
      expect(res.status).not.toBe(401);
    });

    it(`${route.method} ${route.path} accepts admin token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).not.toBe(401);
    });
  }

  // ── Admin-only routes (requireAdminAuth) ──
  const adminRoutes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: "GET", path: "/api/entities/fake-id/activity" },
    { method: "GET", path: "/api/pool/slots" },
    { method: "GET", path: "/api/workers" },
    { method: "GET", path: "/api/sources" },
    { method: "GET", path: "/api/sources/fake-id/watches" },
    { method: "GET", path: "/api/events" },
    { method: "POST", path: "/api/admin/flows/outer-test-flow/pause" },
    { method: "POST", path: "/api/admin/flows/outer-test-flow/resume" },
    { method: "POST", path: "/api/admin/entities/fake-id/cancel" },
    { method: "POST", path: "/api/admin/entities/fake-id/reset", body: { target_state: "open" } },
    { method: "POST", path: "/api/admin/workers/fake-id/drain" },
    { method: "POST", path: "/api/admin/workers/fake-id/undrain" },
    { method: "POST", path: "/api/admin/entities/fake-id/gates/fake-gate/rerun" },
    { method: "PUT", path: "/api/flows/outer-test-flow", body: { definition: {} } },
    { method: "POST", path: "/api/admin/integrations", body: { name: "test" } },
    { method: "GET", path: "/api/admin/integrations" },
    { method: "GET", path: "/api/admin/integrations/fake-id" },
    { method: "PATCH", path: "/api/admin/integrations/fake-id", body: { name: "updated" } },
    { method: "DELETE", path: "/api/admin/integrations/fake-id" },
  ];

  for (const route of adminRoutes) {
    it(`${route.method} ${route.path} returns 401 without token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: route.body ? { "Content-Type": "application/json" } : {},
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).toBe(401);
    });

    it(`${route.method} ${route.path} returns 401 with worker token (not admin)`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: {
          ...(route.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${WORKER_TOKEN}`,
        },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).toBe(401);
    });

    it(`${route.method} ${route.path} does NOT return 401 with admin token`, async () => {
      const res = await t.app.request(route.path, {
        method: route.method,
        headers: {
          ...(route.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).not.toBe(401);
    });
  }
});

describe("Auth boundary — no tokens configured (open mode)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      adminToken: undefined as unknown as string,
      workerToken: undefined as unknown as string,
      seedPath: SEED,
    });
  });
  afterAll(async () => { await t.close(); });

  it("worker routes return 401 even without token config (server rejects)", async () => {
    // When workerToken is not configured, requireWorkerAuth returns 401
    const res = await t.app.request("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "eng" }),
    });
    expect(res.status).toBe(401);
  });

  it("admin routes return 401 even without token config", async () => {
    const res = await t.app.request("/api/admin/flows/outer-test-flow/pause", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});
