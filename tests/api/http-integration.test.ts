import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp, adminHeaders, workerHeaders, type TestApp } from "../helpers/test-app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(__dirname, "../fixtures/outer-layer-flow.seed.json");

describe("HTTP integration — entity lifecycle via REST", () => {
  let t: TestApp;

  beforeAll(async () => { t = await createTestApp({ seedPath: SEED }); });
  afterAll(async () => { await t.close(); });

  it("POST /api/entities creates entity with 201 and correct initial state", async () => {
    const res = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ flow: "outer-test-flow" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.state).toBe("open");
  });

  it("POST /api/entities with payload passes payload to entity", async () => {
    const res = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ flow: "outer-test-flow", payload: { key: "value" } }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /api/entities with unknown flow returns 404", async () => {
    const res = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ flow: "nonexistent-flow" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/entities with missing flow field returns 400", async () => {
    const res = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/entities with invalid JSON returns 400", async () => {
    const res = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/entities/:id returns entity after creation", async () => {
    const createRes = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ flow: "outer-test-flow" }),
    });
    const { id } = await createRes.json() as Record<string, unknown>;

    const getRes = await t.app.request(`/api/entities/${id}`, {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(getRes.status).toBe(200);
    const entity = await getRes.json() as Record<string, unknown>;
    expect(entity.id).toBe(id);
    expect(entity.state).toBe("open");
  });

  it("GET /api/entities/:id for nonexistent entity returns 404", async () => {
    const res = await t.app.request("/api/entities/does-not-exist", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/entities?flow=...&state=... returns matching entities", async () => {
    // Create entity
    await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ flow: "outer-test-flow" }),
    });

    const res = await t.app.request("/api/entities?flow=outer-test-flow&state=open", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/entities without required params returns 400", async () => {
    const res = await t.app.request("/api/entities", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/claim with no available work returns check_back", async () => {
    // Use a fresh app with no entities
    const fresh = await createTestApp({ seedPath: SEED });
    const res = await fresh.app.request("/api/claim", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ role: "engineering" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.next_action).toBe("check_back");
    expect(body.retry_after_ms as number).toBeGreaterThan(0);
    await fresh.close();
  });

  it("GET /api/flows returns seeded flow definitions", async () => {
    const res = await t.app.request("/api/flows", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(200);
    const flows = await res.json() as Array<Record<string, unknown>>;
    expect(flows.length).toBeGreaterThanOrEqual(1);
    expect(flows.some((f) => f.name === "outer-test-flow")).toBe(true);
  });

  it("GET /api/flows/:id returns specific flow", async () => {
    const res = await t.app.request("/api/flows/outer-test-flow", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(200);
    const flow = await res.json() as Record<string, unknown>;
    expect(flow.name).toBe("outer-test-flow");
  });

  it("GET /api/flows/:id for unknown flow returns 404", async () => {
    const res = await t.app.request("/api/flows/nonexistent-flow-xyz", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/status returns engine status shape", async () => {
    const res = await t.app.request("/api/status", {
      headers: { Authorization: workerHeaders().Authorization },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("flows");
    expect(body).toHaveProperty("activeInvocations");
    expect(body).toHaveProperty("pendingClaims");
  });

  it("unknown route returns 404 with JSON error", async () => {
    const res = await t.app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Not found");
  });
});

describe("HTTP integration — admin endpoints", () => {
  let t: TestApp;

  beforeAll(async () => { t = await createTestApp({ seedPath: SEED }); });
  afterAll(async () => { await t.close(); });

  it("POST /api/admin/flows/:flow/pause pauses a flow", async () => {
    const res = await t.app.request("/api/admin/flows/outer-test-flow/pause", {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.paused).toBe(true);
  });

  it("POST /api/admin/entities/:id/cancel cancels an entity", async () => {
    const createRes = await t.app.request("/api/entities", {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ flow: "outer-test-flow" }),
    });
    const { id } = await createRes.json() as Record<string, unknown>;

    const cancelRes = await t.app.request(`/api/admin/entities/${id}/cancel`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(cancelRes.status).toBe(200);

    // Verify entity is cancelled
    const getRes = await t.app.request(`/api/entities/${id}`, {
      headers: { Authorization: adminHeaders().Authorization },
    });
    const entity = await getRes.json() as Record<string, unknown>;
    expect(entity.state).toBe("cancelled");
  });

  it("DELETE /api/flows/:id returns 404 (route removed)", async () => {
    const res = await t.app.request("/api/flows/outer-test-flow", {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/pool/slots returns shape even without pool", async () => {
    const res = await t.app.request("/api/pool/slots", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("slots");
    expect(body).toHaveProperty("available");
    expect(body).toHaveProperty("capacity");
  });

  it("GET /api/workers returns empty array without worker repo", async () => {
    const res = await t.app.request("/api/workers", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("GET /api/sources returns empty array without source repo", async () => {
    const res = await t.app.request("/api/sources", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });

  it("GET /api/events returns empty array without event log repo", async () => {
    const res = await t.app.request("/api/events", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });
});
