/**
 * Multi-tenant isolation tests.
 *
 * Verifies that tenant A cannot see, modify, or delete tenant B's data
 * across every repository layer — core repos, radar-db repos, event repos,
 * snapshots, domain events, and the engine's transactional signal path.
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHonoApp } from "../src/api/hono-server.js";
import { Engine } from "../src/engine/engine.js";
import { EventEmitter } from "../src/engine/event-emitter.js";
import type { EngineEvent } from "../src/engine/event-types.js";
import { DrizzleEntityActivityRepo } from "../src/radar-db/repos/drizzle-entity-activity-repo.js";
import { DrizzleEntityMapRepository } from "../src/radar-db/repos/entity-map-repo.js";
import { EventLogRepo } from "../src/radar-db/repos/event-log-repo.js";
import { WatchRepo } from "../src/radar-db/repos/watch-repo.js";
import { WorkerRepo } from "../src/radar-db/repos/worker-repo.js";
import * as schema from "../src/repositories/drizzle/schema.js";
import { createScopedRepos, type ScopedRepos } from "../src/repositories/scoped-repos.js";
import { createTestDb, type TestDb } from "./helpers/pg-test-db.js";

let db: TestDb;
let close: () => Promise<void>;
let t1: ScopedRepos;
let t2: ScopedRepos;

beforeEach(async () => {
  const res = await createTestDb();
  db = res.db;
  close = res.close;
  t1 = createScopedRepos(db, "tenant-1");
  t2 = createScopedRepos(db, "tenant-2");
});

afterEach(async () => {
  await close();
});

// ─── Helper: insert a source row directly (radar-db repos need FK) ───

async function insertSource(tenantId: string, id: string, name: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.sources).values({
    id,
    tenantId,
    name,
    type: "webhook",
    config: "{}",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

// ─── Core repos ───

describe("tenant isolation — core repos", () => {
  it("entities: claim only sees own tenant", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "ready" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "ready" });

    await t1.entities.create(f1.id, "ready");
    await t2.entities.create(f2.id, "ready");

    // Tenant 1 claims — should only see tenant 1's entity
    const claimed = await t1.entities.claim(f1.id, "ready", "agent-1");
    expect(claimed).not.toBeNull();

    // Tenant 2's entity is still unclaimed
    const claimed2 = await t2.entities.claim(f2.id, "ready", "agent-2");
    expect(claimed2).not.toBeNull();
  });

  it("invocations: tenant 1 cannot see tenant 2 invocations", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });

    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.invocations.create(e1.id, "s1", "do stuff", "active", undefined, undefined, null);
    await t2.invocations.create(e2.id, "s1", "do stuff", "active", undefined, undefined, null);

    const inv1 = await t1.invocations.findByFlow(f1.id);
    const inv2 = await t2.invocations.findByFlow(f2.id);

    expect(inv1).toHaveLength(1);
    expect(inv2).toHaveLength(1);
    expect(inv1[0].entityId).toBe(e1.id);
    expect(inv2[0].entityId).toBe(e2.id);
  });

  it("invocations: findUnclaimedByFlow isolated", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.invocations.create(e1.id, "s1", "prompt", "active", undefined, undefined, null);
    await t2.invocations.create(e2.id, "s1", "prompt", "active", undefined, undefined, null);

    // Each tenant only sees their own unclaimed invocations
    const unclaimed1 = await t1.invocations.findUnclaimedByFlow(f1.id);
    const unclaimed2 = await t2.invocations.findUnclaimedByFlow(f2.id);
    expect(unclaimed1).toHaveLength(1);
    expect(unclaimed2).toHaveLength(1);
    expect(unclaimed1[0].entityId).toBe(e1.id);
    expect(unclaimed2[0].entityId).toBe(e2.id);

    // Cross-tenant: tenant 1 cannot see tenant 2's flow invocations
    const cross = await t1.invocations.findUnclaimedByFlow(f2.id);
    expect(cross).toHaveLength(0);
  });

  it("invocations: findUnclaimedActive isolated", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.invocations.create(e1.id, "s1", "prompt", "active", undefined, undefined, null);
    await t2.invocations.create(e2.id, "s1", "prompt", "active", undefined, undefined, null);

    // Without flowId filter — each tenant sees only their own
    const active1 = await t1.invocations.findUnclaimedActive();
    const active2 = await t2.invocations.findUnclaimedActive();
    expect(active1).toHaveLength(1);
    expect(active2).toHaveLength(1);
    expect(active1[0].entityId).toBe(e1.id);
    expect(active2[0].entityId).toBe(e2.id);
  });

  it("invocations: reapExpired isolated", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    // Create invocations with very short TTL so they expire immediately
    const inv1 = await t1.invocations.create(e1.id, "s1", "prompt", "active", 1, undefined, null);
    const inv2 = await t2.invocations.create(e2.id, "s1", "prompt", "active", 1, undefined, null);

    // Claim both
    await t1.invocations.claim(inv1.id, "agent-1");
    await t2.invocations.claim(inv2.id, "agent-2");

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10));

    // Tenant 1 reaps only its own expired invocations
    const reaped1 = await t1.invocations.reapExpired();
    expect(reaped1).toHaveLength(1);
    expect(reaped1[0].entityId).toBe(e1.id);

    // Tenant 2's expired invocation is still claimed (not reaped by t1)
    const inv2Check = await t2.invocations.get(inv2.id);
    expect(inv2Check!.claimedBy).toBe("agent-2");

    // Now tenant 2 reaps its own
    const reaped2 = await t2.invocations.reapExpired();
    expect(reaped2).toHaveLength(1);
    expect(reaped2[0].entityId).toBe(e2.id);
  });

  it("transition log: isolated between tenants", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.transitionLog.record({
      entityId: e1.id,
      fromState: "s1",
      toState: "s2",
      trigger: "go",
      invocationId: null,
      timestamp: new Date(),
    });
    await t2.transitionLog.record({
      entityId: e2.id,
      fromState: "s1",
      toState: "s2",
      trigger: "go",
      invocationId: null,
      timestamp: new Date(),
    });

    const log1 = await t1.transitionLog.historyFor(e1.id);
    const log2 = await t2.transitionLog.historyFor(e2.id);
    expect(log1).toHaveLength(1);
    expect(log2).toHaveLength(1);

    // Cross-tenant query returns empty
    const cross = await t1.transitionLog.historyFor(e2.id);
    expect(cross).toHaveLength(0);
  });

  it("events: findByEntity isolated", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.events.emitDefinitionChanged(f1.id, "test", { entityId: e1.id });
    // Insert event for t2 entity via t2 repo
    await t2.events.emitDefinitionChanged(f2.id, "test", { entityId: e2.id });

    const ev1 = await t1.events.findAll();
    const ev2 = await t2.events.findAll();
    expect(ev1).toHaveLength(1);
    expect(ev2).toHaveLength(1);
  });

  it("domain events: isolated between tenants", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.domainEvents.append("entity.created", e1.id, { source: "test" });
    await t2.domainEvents.append("entity.created", e2.id, { source: "test" });

    const de1 = await t1.domainEvents.list(e1.id);
    const de2 = await t2.domainEvents.list(e2.id);
    expect(de1).toHaveLength(1);
    expect(de2).toHaveLength(1);

    // Cross-tenant: tenant 1 cannot see tenant 2's domain events
    const cross = await t1.domainEvents.list(e2.id);
    expect(cross).toHaveLength(0);
  });

  it("entity snapshots: loadLatest isolated", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    await t1.snapshots.save(e1.id, 1, e1);
    await t2.snapshots.save(e2.id, 1, e2);

    const snap1 = await t1.snapshots.loadLatest(e1.id);
    const snap2 = await t2.snapshots.loadLatest(e2.id);
    expect(snap1).not.toBeNull();
    expect(snap2).not.toBeNull();

    // Cross-tenant: tenant 1 cannot load tenant 2's snapshot
    const cross = await t1.snapshots.loadLatest(e2.id);
    expect(cross).toBeNull();
  });
});

// ─── Flow hydration (states + transitions) ───

describe("tenant isolation — flow hydration", () => {
  it("states and transitions from hydrateFlow are tenant-scoped", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    await t1.flows.addState(f1.id, { name: "s1" });
    await t1.flows.addState(f1.id, { name: "s2" });
    await t1.flows.addTransition(f1.id, { fromState: "s1", toState: "s2", trigger: "go" });

    const f2 = await t2.flows.create({ name: "flow", initialState: "x1" });
    await t2.flows.addState(f2.id, { name: "x1" });
    await t2.flows.addTransition(f2.id, { fromState: "x1", toState: "x2", trigger: "run" });

    // Each tenant sees only their own states/transitions
    const loaded1 = await t1.flows.get(f1.id);
    const loaded2 = await t2.flows.get(f2.id);

    expect(loaded1!.states.map((s) => s.name).sort()).toEqual(["s1", "s2"]);
    expect(loaded1!.transitions).toHaveLength(1);
    expect(loaded1!.transitions[0].trigger).toBe("go");

    expect(loaded2!.states.map((s) => s.name)).toEqual(["x1"]);
    expect(loaded2!.transitions).toHaveLength(1);
    expect(loaded2!.transitions[0].trigger).toBe("run");

    // Cross-tenant: tenant 2 cannot see tenant 1's flow
    const cross = await t2.flows.get(f1.id);
    expect(cross).toBeNull();
  });
});

// ─── Radar-db repos ───

describe("tenant isolation — radar-db repos", () => {
  it("entity activity: isolated between tenants", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a1 = new DrizzleEntityActivityRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a2 = new DrizzleEntityActivityRepo(db as any, "tenant-2");

    await a1.insert({ entityId: "shared-id", slotId: "s1", type: "text", data: { text: "from t1" } });
    await a2.insert({ entityId: "shared-id", slotId: "s2", type: "text", data: { text: "from t2" } });

    const rows1 = await a1.getByEntity("shared-id");
    const rows2 = await a2.getByEntity("shared-id");

    expect(rows1).toHaveLength(1);
    expect(rows2).toHaveLength(1);
    expect((rows1[0].data as { text: string }).text).toBe("from t1");
    expect((rows2[0].data as { text: string }).text).toBe("from t2");
  });

  it("entity activity: getSummary isolated", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a1 = new DrizzleEntityActivityRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a2 = new DrizzleEntityActivityRepo(db as any, "tenant-2");

    await a1.insert({ entityId: "eid", slotId: "s1", type: "text", data: { text: "t1 said hello" } });
    await a2.insert({ entityId: "eid", slotId: "s2", type: "text", data: { text: "t2 said goodbye" } });

    const sum1 = await a1.getSummary("eid");
    const sum2 = await a2.getSummary("eid");

    expect(sum1).toContain("t1 said hello");
    expect(sum1).not.toContain("t2 said goodbye");
    expect(sum2).toContain("t2 said goodbye");
    expect(sum2).not.toContain("t1 said hello");
  });

  it("entity activity: deleteByEntity isolated", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a1 = new DrizzleEntityActivityRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a2 = new DrizzleEntityActivityRepo(db as any, "tenant-2");

    await a1.insert({ entityId: "eid", slotId: "s1", type: "start", data: {} });
    await a2.insert({ entityId: "eid", slotId: "s2", type: "start", data: {} });

    // Delete tenant 1's — tenant 2's should survive
    await a1.deleteByEntity("eid");

    expect(await a1.getByEntity("eid")).toHaveLength(0);
    expect(await a2.getByEntity("eid")).toHaveLength(1);
  });

  it("entity activity: seq numbering isolated per tenant", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a1 = new DrizzleEntityActivityRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const a2 = new DrizzleEntityActivityRepo(db as any, "tenant-2");

    // Insert 3 rows for tenant 1
    await a1.insert({ entityId: "eid", slotId: "s1", type: "start", data: {} });
    await a1.insert({ entityId: "eid", slotId: "s1", type: "text", data: {} });
    await a1.insert({ entityId: "eid", slotId: "s1", type: "result", data: {} });

    // Tenant 2's seq starts at 0, not 3
    await a2.insert({ entityId: "eid", slotId: "s1", type: "start", data: {} });
    const rows2 = await a2.getByEntity("eid");
    expect(rows2[0].seq).toBe(0);
  });

  it("worker repo: isolated between tenants", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const w1 = new WorkerRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const w2 = new WorkerRepo(db as any, "tenant-2");

    await w1.register({ name: "worker-a", type: "claude", discipline: "engineering" });
    await w2.register({ name: "worker-b", type: "claude", discipline: "engineering" });

    const list1 = await w1.list();
    const list2 = await w2.list();
    expect(list1).toHaveLength(1);
    expect(list2).toHaveLength(1);
    expect(list1[0].name).toBe("worker-a");
    expect(list2[0].name).toBe("worker-b");
  });

  it("worker repo: deregister isolated", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const w1 = new WorkerRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const w2 = new WorkerRepo(db as any, "tenant-2");

    const reg1 = await w1.register({ name: "w1", type: "claude", discipline: "eng" });
    const reg2 = await w2.register({ name: "w2", type: "claude", discipline: "eng" });

    // Tenant 1 tries to deregister tenant 2's worker — should be a no-op
    await w1.deregister(reg2.id);
    expect(await w2.getById(reg2.id)).toBeDefined();

    // Tenant 1 deregisters own worker — works
    await w1.deregister(reg1.id);
    expect(await w1.getById(reg1.id)).toBeUndefined();
  });

  it("watch repo: isolated between tenants", async () => {
    await insertSource("tenant-1", "src-1", "github-t1");
    await insertSource("tenant-2", "src-2", "github-t2");

    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const wr1 = new WatchRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const wr2 = new WatchRepo(db as any, "tenant-2");

    await wr1.create({
      sourceId: "src-1",
      name: "watch-a",
      filter: {},
      action: "create_entity",
      actionConfig: {},
    });
    await wr2.create({
      sourceId: "src-2",
      name: "watch-b",
      filter: {},
      action: "create_entity",
      actionConfig: {},
    });

    expect(await wr1.list()).toHaveLength(1);
    expect(await wr2.list()).toHaveLength(1);
    expect((await wr1.list())[0].name).toBe("watch-a");
    expect((await wr2.list())[0].name).toBe("watch-b");
  });

  it("event log repo: isolated between tenants", async () => {
    await insertSource("tenant-1", "src-1", "github-t1");
    await insertSource("tenant-2", "src-2", "github-t2");

    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const el1 = new EventLogRepo(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const el2 = new EventLogRepo(db as any, "tenant-2");

    const row1 = await el1.append({
      sourceId: "src-1",
      watchId: null,
      rawEvent: { type: "push" },
      actionTaken: "created",
      siloResponse: null,
    });
    await el2.append({
      sourceId: "src-2",
      watchId: null,
      rawEvent: { type: "pr" },
      actionTaken: "created",
      siloResponse: null,
    });

    // list() scoped to tenant
    expect(await el1.list()).toHaveLength(1);
    expect(await el2.list()).toHaveLength(1);

    // getById cross-tenant returns undefined
    const cross = await el2.getById(row1.id);
    expect(cross).toBeUndefined();
  });

  it("entity map repo: isolated between tenants", async () => {
    await insertSource("tenant-1", "src-1", "github-t1");
    await insertSource("tenant-2", "src-2", "github-t2");

    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const em1 = new DrizzleEntityMapRepository(db as any, "tenant-1");
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    const em2 = new DrizzleEntityMapRepository(db as any, "tenant-2");

    await em1.insertIfAbsent("src-1", "ext-1", "entity-aaa");
    await em2.insertIfAbsent("src-2", "ext-1", "entity-bbb");

    // Same externalId, different tenants — isolated
    expect(await em1.findEntityId("src-1", "ext-1")).toBe("entity-aaa");
    expect(await em2.findEntityId("src-2", "ext-1")).toBe("entity-bbb");

    // Cross-tenant: tenant 1 cannot find tenant 2's mapping
    expect(await em1.findEntityId("src-2", "ext-1")).toBeUndefined();
  });
});

// ─── Engine transactional isolation ───

describe("tenant isolation — engine processSignal", () => {
  it("signal processing uses tx-bound repos", async () => {
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    await t1.flows.addState(f1.id, { name: "s1" });
    await t1.flows.addState(f1.id, { name: "s2" });
    await t1.flows.addTransition(f1.id, { fromState: "s1", toState: "s2", trigger: "go" });

    const e1 = await t1.entities.create(f1.id, "s1");

    const events: EngineEvent[] = [];
    const emitter = new EventEmitter();
    emitter.register({ emit: async (ev) => { events.push(ev); } });

    const engine = new Engine({
      entityRepo: t1.entities,
      flowRepo: t1.flows,
      invocationRepo: t1.invocations,
      gateRepo: t1.gates,
      transitionLogRepo: t1.transitionLog,
      adapters: new Map(),
      eventEmitter: emitter,
      withTransaction: (fn) => db.transaction(async (tx) => fn(tx)),
      repoFactory: (tx) => {
        const r = createScopedRepos(tx, "tenant-1");
        return {
          entityRepo: r.entities,
          flowRepo: r.flows,
          invocationRepo: r.invocations,
          gateRepo: r.gates,
          transitionLogRepo: r.transitionLog,
          domainEvents: r.domainEvents,
        };
      },
      domainEvents: t1.domainEvents,
    });

    const result = await engine.processSignal(e1.id, "go");
    // s2 has no outbound transitions, so it's terminal
    expect(result.terminal).toBe(true);

    // Entity should now be in s2
    const updated = await t1.entities.get(e1.id);
    expect(updated!.state).toBe("s2");

    // Tenant 2 cannot see this entity
    const cross = await t2.entities.get(e1.id);
    expect(cross).toBeNull();

    // Events were emitted
    expect(events.some((e) => e.type === "entity.transitioned")).toBe(true);
  });

  it("per-tenant engines have isolated event streams", async () => {
    const events1: EngineEvent[] = [];
    const events2: EngineEvent[] = [];

    const emitter1 = new EventEmitter();
    emitter1.register({ emit: async (ev) => { events1.push(ev); } });
    const emitter2 = new EventEmitter();
    emitter2.register({ emit: async (ev) => { events2.push(ev); } });

    // Create identical flows in both tenants
    const f1 = await t1.flows.create({ name: "flow", initialState: "s1" });
    await t1.flows.addState(f1.id, { name: "s1" });
    await t1.flows.addState(f1.id, { name: "s2" });
    await t1.flows.addTransition(f1.id, { fromState: "s1", toState: "s2", trigger: "go" });

    const f2 = await t2.flows.create({ name: "flow", initialState: "s1" });
    await t2.flows.addState(f2.id, { name: "s1" });
    await t2.flows.addState(f2.id, { name: "s2" });
    await t2.flows.addTransition(f2.id, { fromState: "s1", toState: "s2", trigger: "go" });

    const e1 = await t1.entities.create(f1.id, "s1");
    const e2 = await t2.entities.create(f2.id, "s1");

    const makeEngine = (repos: ScopedRepos, tenantId: string, emitter: EventEmitter) =>
      new Engine({
        entityRepo: repos.entities,
        flowRepo: repos.flows,
        invocationRepo: repos.invocations,
        gateRepo: repos.gates,
        transitionLogRepo: repos.transitionLog,
        adapters: new Map(),
        eventEmitter: emitter,
        withTransaction: (fn) => db.transaction(async (tx) => fn(tx)),
        repoFactory: (tx) => {
          const r = createScopedRepos(tx, tenantId);
          return {
            entityRepo: r.entities,
            flowRepo: r.flows,
            invocationRepo: r.invocations,
            gateRepo: r.gates,
            transitionLogRepo: r.transitionLog,
            domainEvents: r.domainEvents,
          };
        },
        domainEvents: repos.domainEvents,
      });

    const eng1 = makeEngine(t1, "tenant-1", emitter1);
    const eng2 = makeEngine(t2, "tenant-2", emitter2);

    await eng1.processSignal(e1.id, "go");
    await eng2.processSignal(e2.id, "go");

    // Each engine's events only contain its own entity
    const entityIds1 = events1.filter((e) => "entityId" in e).map((e) => (e as { entityId: string }).entityId);
    const entityIds2 = events2.filter((e) => "entityId" in e).map((e) => (e as { entityId: string }).entityId);

    expect(entityIds1.every((id) => id === e1.id)).toBe(true);
    expect(entityIds2.every((id) => id === e2.id)).toBe(true);

    // No cross-contamination
    expect(entityIds1).not.toContain(e2.id);
    expect(entityIds2).not.toContain(e1.id);
  });
});

// ─── Admin-auth tenant restriction (HTTP API) ───

describe("tenant isolation — admin auth downgrade", () => {
  it("non-admin caller with X-Tenant-Id is silently downgraded to default", async () => {
    const defaultTenant = "default";
    const repos = createScopedRepos(db, defaultTenant);
    const emitter = new EventEmitter();
    const engine = new Engine({
      entityRepo: repos.entities,
      flowRepo: repos.flows,
      invocationRepo: repos.invocations,
      gateRepo: repos.gates,
      transitionLogRepo: repos.transitionLog,
      adapters: new Map(),
      eventEmitter: emitter,
      withTransaction: (fn) => db.transaction(async (tx: TestDb) => fn(tx)),
      repoFactory: (tx: TestDb) => {
        const r = createScopedRepos(tx, defaultTenant);
        return {
          entityRepo: r.entities,
          flowRepo: r.flows,
          invocationRepo: r.invocations,
          gateRepo: r.gates,
          transitionLogRepo: r.transitionLog,
          domainEvents: r.domainEvents,
        };
      },
      domainEvents: repos.domainEvents,
    });

    const adminToken = "secret-admin-token";
    // Don't pass `db` — the non-admin caller will be downgraded to the boot
    // tenant anyway, so no dynamic tenant creation is needed.
    const app = createHonoApp({
      engine,
      mcpDeps: {
        entities: repos.entities,
        flows: repos.flows,
        invocations: repos.invocations,
        gates: repos.gates,
        transitions: repos.transitionLog,
        eventRepo: repos.events,
        domainEvents: repos.domainEvents,
        engine,
        withTransaction: (fn) => db.transaction(async (tx: TestDb) => fn(tx)),
      },
      defaultTenantId: defaultTenant,
      adminToken,
      workerToken: "worker-token",
    });

    // Create a flow in the default tenant
    await repos.flows.create({ name: "test-flow", initialState: "s1" });

    // Non-admin caller with X-Tenant-Id header → should see default tenant data
    const res = await app.request("/api/flows", {
      headers: { "x-tenant-id": "other-tenant" },
    });
    expect(res.status).toBe(200);
    const flows = (await res.json()) as Array<{ name: string }>;
    expect(flows).toHaveLength(1);
    expect(flows[0].name).toBe("test-flow");
  });

  it("admin caller with X-Tenant-Id gets the requested tenant", async () => {
    const defaultTenant = "default";
    const repos = createScopedRepos(db, defaultTenant);
    const emitter = new EventEmitter();
    const engine = new Engine({
      entityRepo: repos.entities,
      flowRepo: repos.flows,
      invocationRepo: repos.invocations,
      gateRepo: repos.gates,
      transitionLogRepo: repos.transitionLog,
      adapters: new Map(),
      eventEmitter: emitter,
      withTransaction: (fn) => db.transaction(async (tx: TestDb) => fn(tx)),
      repoFactory: (tx: TestDb) => {
        const r = createScopedRepos(tx, defaultTenant);
        return {
          entityRepo: r.entities,
          flowRepo: r.flows,
          invocationRepo: r.invocations,
          gateRepo: r.gates,
          transitionLogRepo: r.transitionLog,
          domainEvents: r.domainEvents,
        };
      },
      domainEvents: repos.domainEvents,
    });

    const adminToken = "secret-admin-token";
    // Prevent the dynamic tenant engine's reaper from firing after PGlite closes.
    const reaperSpy = vi.spyOn(Engine.prototype, "startReaper").mockReturnValue(async () => {});
    const app = createHonoApp({
      engine,
      mcpDeps: {
        entities: repos.entities,
        flows: repos.flows,
        invocations: repos.invocations,
        gates: repos.gates,
        transitions: repos.transitionLog,
        eventRepo: repos.events,
        domainEvents: repos.domainEvents,
        engine,
        withTransaction: (fn) => db.transaction(async (tx: TestDb) => fn(tx)),
      },
      db,
      defaultTenantId: defaultTenant,
      adminToken,
      workerToken: "worker-token",
    });

    // Admin caller requesting other-tenant → should create a dynamic tenant
    // engine and see empty results (no flows in other-tenant).
    const res = await app.request("/api/flows", {
      headers: {
        "x-tenant-id": "other-tenant",
        authorization: `Bearer ${adminToken}`,
      },
    });
    expect(res.status).toBe(200);
    const flows = (await res.json()) as Array<{ name: string }>;
    expect(flows).toHaveLength(0);
    reaperSpy.mockRestore();
  });
});
