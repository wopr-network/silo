import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { executeOnEnter } from "../src/engine/on-enter.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
import * as schema from "../src/repositories/drizzle/schema.js";
import type { Entity, IEntityRepository, IEventBusAdapter, ITransitionLogRepository, OnEnterConfig } from "../src/repositories/interfaces.js";

function makeEntity(overrides?: Partial<Entity>): Entity {
  return {
    id: "entity-1",
    flowId: "flow-1",
    state: "coding",
    refs: { github: { adapter: "github", id: "wopr-network/wopr", repo: "wopr-network/wopr" } },
    artifacts: null,
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

function makeEntityRepo(): IEntityRepository & { updatedArtifacts: Record<string, unknown>[] } {
  const repo = {
    updatedArtifacts: [] as Record<string, unknown>[],
    updateArtifacts: vi.fn(async (_id: string, artifacts: Record<string, unknown>) => {
      repo.updatedArtifacts.push(artifacts);
    }),
    create: vi.fn(),
    get: vi.fn(),
    findByFlowAndState: vi.fn(),
    transition: vi.fn(),
    claim: vi.fn(),
    claimById: vi.fn(),
    release: vi.fn(),
    reapExpired: vi.fn(),
    setAffinity: vi.fn(),
    clearExpiredAffinity: vi.fn(),
    appendSpawnedChild: vi.fn(),
  };
  return repo as unknown as IEntityRepository & { updatedArtifacts: Record<string, unknown>[] };
}

describe("executeOnEnter", () => {
  it("skips when all named artifacts already exist on entity", async () => {
    const entity = makeEntity({ artifacts: { worktreePath: "/tmp/wt", branch: "fix-123" } });
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: "echo should-not-run",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(true);
    expect(result.error).toBeNull();
    expect(repo.updateArtifacts).not.toHaveBeenCalled();
  });

  it("runs command and merges artifacts on success", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: `echo '{"worktreePath":"/tmp/wt","branch":"fix-123"}'`,
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeNull();
    expect(result.artifacts).toEqual({ worktreePath: "/tmp/wt", branch: "fix-123" });
    expect(repo.updateArtifacts).toHaveBeenCalledWith("entity-1", {
      worktreePath: "/tmp/wt",
      branch: "fix-123",
    });
  });

  it("does not re-run when re-entering state with all artifacts present", async () => {
    const entity = makeEntity({
      artifacts: { worktreePath: "/tmp/wt", branch: "fix-123", other: "stuff" },
    });
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: "echo should-not-run",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);
    expect(result.skipped).toBe(true);
  });

  it("records error when command fails (non-zero exit)", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: "false",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.artifacts).toBeNull();
    expect(repo.updateArtifacts).toHaveBeenCalledWith("entity-1", {
      onEnter_error: expect.objectContaining({
        command: "false",
        error: expect.any(String),
        failedAt: expect.any(String),
      }),
    });
  });

  it("preserves actual exit code from failed command (not hardcoded 1)", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: "exit 42",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.error).toMatch(/42/);
    expect(result.artifacts).toBeNull();
  });

  it("records error when stdout is not valid JSON", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: "echo not-json",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.artifacts).toBeNull();
  });

  it("records error when expected artifact key is missing from stdout", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: `echo '{"worktreePath":"/tmp/wt"}'`,
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.error).toContain("branch");
    expect(result.artifacts).toBeNull();
  });

  it("times out when command exceeds timeout_ms", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: "sleep 10",
      artifacts: ["worktreePath"],
      timeout_ms: 100,
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toBeTruthy();
  });

  it("runs when only some artifacts exist (not all)", async () => {
    const entity = makeEntity({ artifacts: { worktreePath: "/tmp/wt" } });
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      command: `echo '{"worktreePath":"/tmp/wt2","branch":"fix-456"}'`,
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeNull();
    expect(result.artifacts).toEqual({ worktreePath: "/tmp/wt2", branch: "fix-456" });
  });
});

describe("Engine onEnter integration", () => {
  let engine: Engine;
  let entityRepo: DrizzleEntityRepository;
  let flowRepo: DrizzleFlowRepository;
  let events: Array<{ type: string }>;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });

    entityRepo = new DrizzleEntityRepository(db as Parameters<typeof DrizzleEntityRepository>[0]);
    flowRepo = new DrizzleFlowRepository(db as Parameters<typeof DrizzleFlowRepository>[0]);
    const invocationRepo = new DrizzleInvocationRepository(db as Parameters<typeof DrizzleInvocationRepository>[0]);
    const gateRepo = new DrizzleGateRepository(db as Parameters<typeof DrizzleGateRepository>[0]);
    const transitionRepo: ITransitionLogRepository = {
      record: async (log) => ({ id: crypto.randomUUID(), ...log }),
      historyFor: async () => [],
    };
    events = [];
    const eventEmitter: IEventBusAdapter = {
      emit: async (event) => {
        events.push(event);
      },
    };

    engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo: transitionRepo,
      adapters: new Map(),
      eventEmitter,
    });
  });

  it("onEnter runs and artifacts are merged before invocation creation", async () => {
    const flow = await flowRepo.create({ name: "test-flow", initialState: "triage" });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage this" });
    await flowRepo.addState(flow.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code at {{entity.artifacts.worktreePath}}",
      onEnter: {
        command: `echo '{"worktreePath":"/tmp/wt","branch":"fix-1"}'`,
        artifacts: ["worktreePath", "branch"],
      },
    });
    await flowRepo.addTransition(flow.id, { fromState: "triage", toState: "coding", trigger: "approved" });

    const entity = await engine.createEntity("test-flow");
    const result = await engine.processSignal(entity.id, "approved");

    expect(result.gated).toBe(false);
    expect(result.newState).toBe("coding");
    expect(typeof result.invocationId).toBe("string");
    expect(result.invocationId!.length).toBeGreaterThan(0);

    const updatedEntity = await entityRepo.get(entity.id);
    expect(updatedEntity?.artifacts).toMatchObject({
      worktreePath: "/tmp/wt",
      branch: "fix-1",
    });

    expect(events).toContainEqual(expect.objectContaining({ type: "onEnter.completed" }));
  });

  it("onEnter skipped on re-entry when artifacts present", async () => {
    const flow = await flowRepo.create({ name: "test-flow2", initialState: "triage" });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo.addState(flow.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code",
      onEnter: {
        command: `echo '{"worktreePath":"/tmp/wt","branch":"fix-1"}'`,
        artifacts: ["worktreePath", "branch"],
      },
    });
    await flowRepo.addState(flow.id, { name: "review", agentRole: "reviewer", promptTemplate: "review" });
    await flowRepo.addTransition(flow.id, { fromState: "triage", toState: "coding", trigger: "approved" });
    await flowRepo.addTransition(flow.id, { fromState: "coding", toState: "review", trigger: "done" });
    await flowRepo.addTransition(flow.id, { fromState: "review", toState: "coding", trigger: "fix" });

    const entity = await engine.createEntity("test-flow2");
    await engine.processSignal(entity.id, "approved");
    await engine.processSignal(entity.id, "done");
    events.length = 0;
    await engine.processSignal(entity.id, "fix");

    expect(events).toContainEqual(expect.objectContaining({ type: "onEnter.skipped" }));
    expect(events.some((e) => e.type === "onEnter.completed")).toBe(false);
  });

  it("onEnter failure gates the entity", async () => {
    const flow = await flowRepo.create({ name: "test-flow3", initialState: "triage" });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo.addState(flow.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code",
      onEnter: {
        command: "false",
        artifacts: ["worktreePath"],
      },
    });
    await flowRepo.addTransition(flow.id, { fromState: "triage", toState: "coding", trigger: "approved" });

    const entity = await engine.createEntity("test-flow3");
    const result = await engine.processSignal(entity.id, "approved");

    expect(result.gated).toBe(false);
    expect(result.onEnterFailed).toBe(true);
    expect(result.gateOutput).toContain("onEnter");
    expect(result.invocationId).toBeUndefined();

    const updatedEntity = await entityRepo.get(entity.id);
    expect(updatedEntity?.artifacts).toHaveProperty("onEnter_error");
  });

  it("transitionLogRepo.record is called even when onEnter fails", async () => {
    const transitionRecordSpy = vi.fn(async (log: unknown) => ({ id: crypto.randomUUID(), ...(log as object) }));
    const spyTransitionRepo: ITransitionLogRepository = {
      record: transitionRecordSpy,
      historyFor: async () => [],
    };

    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db2 = drizzle(sqlite, { schema });
    migrate(db2, { migrationsFolder: "./drizzle" });

    const entityRepo2 = new DrizzleEntityRepository(db2 as Parameters<typeof DrizzleEntityRepository>[0]);
    const flowRepo2 = new DrizzleFlowRepository(db2 as Parameters<typeof DrizzleFlowRepository>[0]);
    const invocationRepo2 = new DrizzleInvocationRepository(db2 as Parameters<typeof DrizzleInvocationRepository>[0]);
    const gateRepo2 = new DrizzleGateRepository(db2 as Parameters<typeof DrizzleGateRepository>[0]);

    const engine2 = new Engine({
      entityRepo: entityRepo2,
      flowRepo: flowRepo2,
      invocationRepo: invocationRepo2,
      gateRepo: gateRepo2,
      transitionLogRepo: spyTransitionRepo,
      adapters: new Map(),
      eventEmitter: { emit: async () => {} },
    });

    const flow2 = await flowRepo2.create({ name: "test-flow4b", initialState: "triage" });
    await flowRepo2.addState(flow2.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo2.addState(flow2.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code",
      onEnter: { command: "false", artifacts: ["worktreePath"] },
    });
    await flowRepo2.addTransition(flow2.id, { fromState: "triage", toState: "coding", trigger: "approved" });

    const entity = await engine2.createEntity("test-flow4b");
    const result = await engine2.processSignal(entity.id, "approved");

    expect(result.onEnterFailed).toBe(true);
    expect(transitionRecordSpy).toHaveBeenCalledOnce();
    expect(transitionRecordSpy).toHaveBeenCalledWith(expect.objectContaining({
      entityId: entity.id,
      fromState: "triage",
      toState: "coding",
    }));
  });

  it("createEntity throws when onEnter fails on initial state", async () => {
    const flow = await flowRepo.create({ name: "test-flow5", initialState: "setup" });
    await flowRepo.addState(flow.id, {
      name: "setup",
      agentRole: "setupper",
      promptTemplate: "setup",
      onEnter: { command: "false", artifacts: ["worktreePath"] },
    });

    await expect(engine.createEntity("test-flow5")).rejects.toThrow("onEnter failed");
  });
});
