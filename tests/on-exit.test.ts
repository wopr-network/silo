import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/pg-test-db.js";
import { Engine } from "../src/engine/engine.js";
import { executeOnExit } from "../src/engine/on-exit.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
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

describe("executeOnExit", () => {
  it("runs a command and returns success", async () => {
    const config: OnExitConfig = { command: "echo hello", timeout_ms: 5000 };
    const result = await executeOnExit(config, makeEntity());
    expect(result.error).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it("renders Handlebars template vars from entity", async () => {
    const config: OnExitConfig = { command: "echo {{entity.artifacts.worktreePath}}" };
    const result = await executeOnExit(config, makeEntity());
    expect(result.error).toBeNull();
  });

  it("returns error on non-zero exit code without throwing", async () => {
    const config: OnExitConfig = { command: "exit 1" };
    const result = await executeOnExit(config, makeEntity());
    expect(result.error).toContain("exited with code");
    expect(result.timedOut).toBe(false);
  });

  it("returns timedOut on timeout without throwing", async () => {
    const config: OnExitConfig = { command: "sleep 10", timeout_ms: 50 };
    const result = await executeOnExit(config, makeEntity());
    expect(result.error).toContain("timed out");
    expect(result.timedOut).toBe(true);
  });

  it("returns error on template rendering failure without throwing", async () => {
    const config: OnExitConfig = { command: "echo {{#each broken" };
    const result = await executeOnExit(config, makeEntity());
    expect(result.error).toContain("onExit template error");
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

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
    entityRepo = new DrizzleEntityRepository(db, TEST_TENANT);
    const invocationRepo = new DrizzleInvocationRepository(db, TEST_TENANT);
    const gateRepo = new DrizzleGateRepository(db, TEST_TENANT);
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

    engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo,
      adapters: new Map(),
      eventEmitter,
    });
  });

  afterEach(async () => {
    await close();
  });

  it("runs onExit on the departing state when gate passes", async () => {
    const flow = await flowRepo.create({
      name: "test-flow",
      initialState: "coding",
      discipline: "engineering",
    });
    await flowRepo.addState(flow.id, {
      name: "coding",
      mode: "active",
      promptTemplate: "do coding",
      onExit: { command: "echo exiting", timeout_ms: 5000 },
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
  });

  it("does not block transition when onExit fails", async () => {
    const flow = await flowRepo.create({
      name: "test-flow-2",
      initialState: "coding",
      discipline: "engineering",
    });
    await flowRepo.addState(flow.id, {
      name: "coding",
      mode: "active",
      promptTemplate: "do coding",
      onExit: { command: "exit 1", timeout_ms: 5000 },
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
});
