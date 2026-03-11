import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/pg-test-db.js";
import { Engine } from "../src/engine/engine.js";
import { executeOnExit } from "../src/engine/on-exit.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
import { DrizzleIntegrationRepository } from "../src/integrations/repo.js";
import type { AdapterRegistry } from "../src/integrations/registry.js";
import type {
  Entity,
  IEventBusAdapter,
  ITransitionLogRepository,
  OnExitConfig,
} from "../src/repositories/interfaces.js";

const TEST_TENANT = "test-tenant";

function makeEntity(overrides?: Partial<Entity>): Entity {
  return {
    id: "entity-1",
    flowId: "flow-1",
    state: "coding",
    refs: { github: { adapter: "github", id: "wopr-network/wopr", repo: "wopr-network/wopr" } },
    artifacts: { worktreePath: "/tmp/wt-123" },
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    affinityWorkerId: null,
    affinityRole: null,
    affinityExpiresAt: null,
    ...overrides,
  };
}

function makeFlow(overrides?: object) {
  return {
    id: "flow-1",
    name: "test-flow",
    vcsIntegrationId: "vcs-integration-1",
    issueTrackerIntegrationId: "it-integration-1",
    ...overrides,
  };
}

function makeRegistry(): AdapterRegistry {
  return { execute: vi.fn().mockResolvedValue({}) } as unknown as AdapterRegistry;
}

describe("executeOnExit", () => {
  it("executes a primitive op and returns success", async () => {
    const registry = makeRegistry();
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(registry.execute).toHaveBeenCalledOnce();
  });

  it("renders Handlebars template params from entity", async () => {
    const registry = makeRegistry();
    const config: OnExitConfig = {
      op: "vcs.cleanup_worktree",
      params: { path: "{{entity.artifacts.worktreePath}}" },
    };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toBeNull();
    expect(registry.execute).toHaveBeenCalledWith(
      "vcs-integration-1",
      "vcs.cleanup_worktree",
      { path: "/tmp/wt-123" },
    );
  });

  it("returns error when op throws", async () => {
    const registry = {
      execute: vi.fn().mockRejectedValue(new Error("op failed")),
    } as unknown as AdapterRegistry;
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toContain("op failed");
    expect(result.timedOut).toBe(false);
  });

  it("returns error on template rendering failure", async () => {
    const registry = makeRegistry();
    const config: OnExitConfig = {
      op: "vcs.cleanup_worktree",
      params: { path: "{{#each broken" },
    };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toContain("onExit template error");
    expect(result.timedOut).toBe(false);
  });

  it("returns error when no adapterRegistry provided", async () => {
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), null);
    expect(result.error).toContain("AdapterRegistry");
    expect(result.timedOut).toBe(false);
  });

  it("returns error when flow has no vcs integration", async () => {
    const registry = makeRegistry();
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow({ vcsIntegrationId: undefined }), registry);
    expect(result.error).toContain("vcs");
    expect(result.timedOut).toBe(false);
  });
});

describe("Engine.processSignal onExit integration", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let engine: Engine;
  let flowRepo: DrizzleFlowRepository;
  let entityRepo: DrizzleEntityRepository;
  let emittedEvents: Array<{ type: string; [key: string]: unknown }>;
  let mockRegistry: AdapterRegistry;
  let vcsIntegrationId: string;

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
    entityRepo = new DrizzleEntityRepository(db, TEST_TENANT);
    const integrationRepo = new DrizzleIntegrationRepository(db, TEST_TENANT);
    const invocationRepo = new DrizzleInvocationRepository(db, TEST_TENANT);
    const gateRepo = new DrizzleGateRepository(db, TEST_TENANT);

    const vcsInt = await integrationRepo.create({
      name: "test-vcs",
      category: "vcs",
      provider: "github",
      credentials: { provider: "github", accessToken: "test-token" },
    });
    vcsIntegrationId = vcsInt.id;

    emittedEvents = [];
    const eventEmitter: IEventBusAdapter = {
      emit: async (event) => {
        emittedEvents.push(event as Record<string, unknown> & { type: string });
      },
    };
    const transitionLogRepo: ITransitionLogRepository = {
      record: vi.fn(async () => ({
        id: "log-1",
        entityId: "entity-1",
        fromState: "coding",
        toState: "review",
        trigger: "spec_ready",
        invocationId: null,
        timestamp: new Date(),
      })),
      historyFor: vi.fn(async () => []),
    };

    mockRegistry = {
      execute: vi.fn().mockResolvedValue({}),
    } as unknown as AdapterRegistry;

    engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo,
      adapters: new Map(),
      eventEmitter,
      adapterRegistry: mockRegistry,
    });
  });

  afterEach(async () => {
    await close();
  });

  it("runs onExit on the departing state when transitioning", async () => {
    const flow = await flowRepo.create({
      name: "test-flow",
      initialState: "coding",
      discipline: "engineering",
      vcsIntegrationId,
    });
    await flowRepo.addState(flow.id, {
      name: "coding",
      mode: "active",
      promptTemplate: "do coding",
      onExit: { op: "vcs.cleanup_worktree" },
    });
    await flowRepo.addState(flow.id, { name: "review", mode: "passive" });
    await flowRepo.addTransition(flow.id, {
      fromState: "coding",
      toState: "review",
      trigger: "spec_ready",
    });

    const entity = await entityRepo.create(flow.id, "coding");
    await engine.processSignal(entity.id, "spec_ready");

    const exitEvents = emittedEvents.filter((e) => e.type === "onExit.completed");
    expect(exitEvents).toHaveLength(1);
    expect(exitEvents[0].state).toBe("coding");
    expect(mockRegistry.execute).toHaveBeenCalledOnce();
  });

  it("does not block transition when onExit fails", async () => {
    (mockRegistry.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("op failed"));

    const flow = await flowRepo.create({
      name: "test-flow-2",
      initialState: "coding",
      discipline: "engineering",
      vcsIntegrationId,
    });
    await flowRepo.addState(flow.id, {
      name: "coding",
      mode: "active",
      promptTemplate: "do coding",
      onExit: { op: "vcs.cleanup_worktree" },
    });
    await flowRepo.addState(flow.id, { name: "review", mode: "passive" });
    await flowRepo.addTransition(flow.id, {
      fromState: "coding",
      toState: "review",
      trigger: "spec_ready",
    });

    const entity = await entityRepo.create(flow.id, "coding");
    const result = await engine.processSignal(entity.id, "spec_ready");

    // Transition still happened despite onExit failure
    expect(result.newState).toBe("review");
    const failEvents = emittedEvents.filter((e) => e.type === "onExit.failed");
    expect(failEvents).toHaveLength(1);
  });

  it("skips onExit when not configured on departing state", async () => {
    const flow = await flowRepo.create({
      name: "test-flow-3",
      initialState: "coding",
      discipline: "engineering",
    });
    await flowRepo.addState(flow.id, { name: "coding", mode: "active", promptTemplate: "do coding" });
    await flowRepo.addState(flow.id, { name: "review", mode: "passive" });
    await flowRepo.addTransition(flow.id, {
      fromState: "coding",
      toState: "review",
      trigger: "spec_ready",
    });

    const entity = await entityRepo.create(flow.id, "coding");
    const result = await engine.processSignal(entity.id, "spec_ready");

    expect(result.newState).toBe("review");
    const exitEvents = emittedEvents.filter((e) => e.type.startsWith("onExit."));
    expect(exitEvents).toHaveLength(0);
  });

  it("passes rendered params to the adapter", async () => {
    const flow = await flowRepo.create({
      name: "test-flow-params",
      initialState: "coding",
      discipline: "engineering",
      vcsIntegrationId,
    });
    await flowRepo.addState(flow.id, {
      name: "coding",
      mode: "active",
      promptTemplate: "do coding",
      onExit: {
        op: "vcs.cleanup_worktree",
        params: { entityId: "{{entity.id}}" },
      },
    });
    await flowRepo.addState(flow.id, { name: "review", mode: "passive" });
    await flowRepo.addTransition(flow.id, {
      fromState: "coding",
      toState: "review",
      trigger: "spec_ready",
    });

    const entity = await entityRepo.create(flow.id, "coding");
    await engine.processSignal(entity.id, "spec_ready");

    expect(mockRegistry.execute).toHaveBeenCalledWith(
      vcsIntegrationId,
      "vcs.cleanup_worktree",
      { entityId: entity.id },
    );
  });
});
