import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/pg-test-db.js";
import * as schema from "../src/repositories/drizzle/schema.js";
import { entities as entitiesTable } from "../src/repositories/drizzle/schema.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleEventRepository } from "../src/repositories/drizzle/event.repo.js";
import { DrizzleTransitionLogRepository } from "../src/repositories/drizzle/transition-log.repo.js";
import { Engine } from "../src/engine/engine.js";
import { EventEmitter } from "../src/engine/event-emitter.js";
import { callToolHandler } from "../src/execution/mcp-server.js";
import type { McpServerDeps } from "../src/execution/mcp-server.js";

const TEST_TENANT = "test-tenant";

function makeDeps(db: TestDb) {
  const entityRepo = new DrizzleEntityRepository(db, TEST_TENANT);
  const flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
  const invocationRepo = new DrizzleInvocationRepository(db, TEST_TENANT);
  const gateRepo = new DrizzleGateRepository(db, TEST_TENANT);
  const transitionLogRepo = new DrizzleTransitionLogRepository(db, TEST_TENANT);
  const eventRepo = new DrizzleEventRepository(db, TEST_TENANT);
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
  const deps: McpServerDeps = {
    entities: entityRepo,
    flows: flowRepo,
    invocations: invocationRepo,
    gates: gateRepo,
    transitions: transitionLogRepo,
    eventRepo,
    engine,
  };
  return { deps, engine, flowRepo, entityRepo, db };
}

describe("flow versioning", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let deps: McpServerDeps;
  let flowRepo: DrizzleFlowRepository;
  let entityRepo: DrizzleEntityRepository;
  let engine: Engine;

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;
    const made = makeDeps(db);
    deps = made.deps;
    engine = made.engine;
    flowRepo = made.flowRepo;
    entityRepo = made.entityRepo;
  });

  afterEach(async () => {
    await close();
  });

  it("getAtVersion returns snapshot for old version", async () => {
    // Create flow v1
    const flow = await flowRepo.create({ name: "test", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open" });
    await flowRepo.addState(flow.id, { name: "done" });
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "done", trigger: "finish" });

    // Snapshot (bumps to v2 after snapshot)
    await flowRepo.snapshot(flow.id);

    // Mutate flow — add new state
    await flowRepo.addState(flow.id, { name: "review" });
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "review", trigger: "review_requested" });

    // getAtVersion(1) should return flow WITHOUT "review" state
    const v1Flow = await flowRepo.getAtVersion(flow.id, 1);
    expect(v1Flow).not.toBeNull();
    expect(v1Flow!.states.map((s) => s.name).sort()).toEqual(["done", "open"]);
    expect(v1Flow!.transitions).toHaveLength(1);

    // get() returns latest with "review" state
    const latest = await flowRepo.get(flow.id);
    expect(latest!.states.map((s) => s.name).sort()).toEqual(["done", "open", "review"]);
  });

  it("getAtVersion on current version returns live flow", async () => {
    const flow = await flowRepo.create({ name: "live-test", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open" });

    const live = await flowRepo.getAtVersion(flow.id, flow.version);
    expect(live).not.toBeNull();
    expect(live!.states).toHaveLength(1);
  });

  it("entity is pinned to current flow version at creation", async () => {
    // Create flow and add states directly via repo (no snapshot calls)
    const flow = await flowRepo.create({ name: "pin-test", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open" });
    await flowRepo.addState(flow.id, { name: "done" });

    // Get current version
    const currentFlow = await flowRepo.get(flow.id);
    const v1 = currentFlow!.version;

    // Create entity — should be at current version
    const entity1 = await entityRepo.create(flow.id, "open", undefined, v1);
    expect(entity1.flowVersion).toBe(v1);

    // Snapshot bumps to v2
    await flowRepo.snapshot(flow.id);
    const afterSnapshot = await flowRepo.get(flow.id);
    const v2 = afterSnapshot!.version;
    expect(v2).toBe(v1 + 1);

    // Create another entity — should be at v2
    const entity2 = await entityRepo.create(flow.id, "open", undefined, v2);
    expect(entity2.flowVersion).toBe(v2);

    // First entity still v1
    const fetched = await entityRepo.get(entity1.id);
    expect(fetched!.flowVersion).toBe(v1);
  });

  it("processSignal uses pinned flow version, not latest", async () => {
    // Create flow with open -> done on "finish" using direct repo calls
    const flow = await flowRepo.create({ name: "versioned", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open", promptTemplate: "Do work", mode: "passive" });
    await flowRepo.addState(flow.id, { name: "done" });
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "done", trigger: "finish" });

    // Get current version and create entity pinned to it
    const currentFlow = await flowRepo.get(flow.id);
    const pinnedVersion = currentFlow!.version;
    const entity = await entityRepo.create(flow.id, "open", undefined, pinnedVersion);
    expect(entity.flowVersion).toBe(pinnedVersion);

    // Snapshot bumps to new version
    await flowRepo.snapshot(flow.id);
    const afterSnapshot = await flowRepo.get(flow.id);
    expect(afterSnapshot!.version).toBe(pinnedVersion + 1);

    // processSignal on the pinned entity should still use its snapshot's transitions (open->done)
    const result = await engine.processSignal(entity.id, "finish");
    expect(result.newState).toBe("done");
    expect(result.terminal).toBe(true);
  });

  it("entity on old version is unaffected by new version transitions", async () => {
    // Create flow via direct repo: open -> done on "finish"
    const flow = await flowRepo.create({ name: "isolation", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open", promptTemplate: "Work on it", mode: "passive" });
    await flowRepo.addState(flow.id, { name: "review", promptTemplate: "Review it", mode: "passive" });
    await flowRepo.addState(flow.id, { name: "done" });
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "done", trigger: "finish" });

    // Get current version and create entity pinned to it (v1)
    const v1Flow = await flowRepo.get(flow.id);
    const v1 = v1Flow!.version;
    const e1 = await entityRepo.create(flow.id, "open", undefined, v1);
    expect(e1.flowVersion).toBe(v1);

    // Snapshot (bumps to v2), then add a new transition
    await flowRepo.snapshot(flow.id);
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "review", trigger: "needs_review" });

    // Get current (v2) and create entity pinned to it
    const v2Flow = await flowRepo.get(flow.id);
    const v2 = v2Flow!.version;
    expect(v2).toBe(v1 + 1);
    const e2 = await entityRepo.create(flow.id, "open", undefined, v2);
    expect(e2.flowVersion).toBe(v2);

    // v1 entity should NOT see "needs_review" transition
    await expect(engine.processSignal(e1.id, "needs_review")).rejects.toThrow(/No transition/);

    // v2 entity CAN use "needs_review"
    const result = await engine.processSignal(e2.id, "needs_review");
    expect(result.newState).toBe("review");
  });

  it("admin.entity.migrate upgrades entity to latest flow version", async () => {
    const flow = await flowRepo.create({ name: "migrate-test", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open" });
    await flowRepo.addState(flow.id, { name: "done" });
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "done", trigger: "finish" });

    // Get current version and create entity pinned to it
    const v1Flow = await flowRepo.get(flow.id);
    const v1 = v1Flow!.version;
    const entity = await entityRepo.create(flow.id, "open", undefined, v1);
    expect(entity.flowVersion).toBe(v1);

    // Snapshot (bumps to v2)
    await flowRepo.snapshot(flow.id);
    const v2Flow = await flowRepo.get(flow.id);
    const v2 = v2Flow!.version;
    expect(v2).toBe(v1 + 1);

    // Migrate entity to latest
    const mr = await callToolHandler(deps, "admin.entity.migrate", { entity_id: entity.id });
    expect(mr.isError).toBeUndefined();
    const migrated = JSON.parse(mr.content[0].text);
    expect(migrated.flowVersion).toBe(v2);
  });

  it("admin.entity.migrate returns no-op if entity already on latest", async () => {
    const flow = await flowRepo.create({ name: "already-latest", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open" });
    await flowRepo.addState(flow.id, { name: "done" });

    const currentFlow = await flowRepo.get(flow.id);
    const entity = await entityRepo.create(flow.id, "open", undefined, currentFlow!.version);

    const mr = await callToolHandler(deps, "admin.entity.migrate", { entity_id: entity.id });
    expect(mr.isError).toBeUndefined();
    const result = JSON.parse(mr.content[0].text);
    expect(result.migrated).toBe(false);
  });

  it("admin.entity.migrate rejects if entity state missing in latest version", async () => {
    const flow = await flowRepo.create({ name: "bad-migrate", initialState: "alpha" });
    await flowRepo.addState(flow.id, { name: "alpha" });
    await flowRepo.addState(flow.id, { name: "beta" });
    await flowRepo.addState(flow.id, { name: "done" });

    const currentFlow = await flowRepo.get(flow.id);
    const entity = await entityRepo.create(flow.id, "alpha", undefined, currentFlow!.version);

    // Snapshot (bumps version)
    await flowRepo.snapshot(flow.id);

    // Manually set entity state to something that doesn't exist in the flow
    await db.update(entitiesTable).set({ state: "nonexistent" }).where(eq(entitiesTable.id, entity.id));

    const mr = await callToolHandler(deps, "admin.entity.migrate", { entity_id: entity.id });
    expect(mr.isError).toBe(true);
    expect(mr.content[0].text).toContain("nonexistent");
  });

  it("getStatus includes version distribution", async () => {
    const flow = await flowRepo.create({ name: "status-test", initialState: "open" });
    await flowRepo.addState(flow.id, { name: "open", promptTemplate: "work", mode: "passive" });
    await flowRepo.addState(flow.id, { name: "done" });
    await flowRepo.addTransition(flow.id, { fromState: "open", toState: "done", trigger: "finish" });

    // Get current version
    const currentFlow = await flowRepo.get(flow.id);
    const v1 = currentFlow!.version;

    // Create 2 entities on v1
    await entityRepo.create(flow.id, "open", undefined, v1);
    await entityRepo.create(flow.id, "open", undefined, v1);

    // Snapshot (bumps to v2)
    await flowRepo.snapshot(flow.id);
    const v2Flow = await flowRepo.get(flow.id);
    const v2 = v2Flow!.version;

    // Create 1 entity on v2
    await entityRepo.create(flow.id, "open", undefined, v2);

    const status = await engine.getStatus();
    expect(status.versionDistribution).toBeDefined();
    const dist = status.versionDistribution;
    expect(dist[flow.id]).toEqual({ [String(v1)]: 2, [String(v2)]: 1 });
  });
});
