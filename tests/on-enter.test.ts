import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/pg-test-db.js";
import { Engine } from "../src/engine/engine.js";
import { executeOnEnter } from "../src/engine/on-enter.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
import { DrizzleIntegrationRepository } from "../src/integrations/repo.js";
import type { AdapterRegistry } from "../src/integrations/registry.js";
import type { Entity, IEntityRepository, IEventBusAdapter, ITransitionLogRepository, OnEnterConfig } from "../src/repositories/interfaces.js";

const TEST_TENANT = "test-tenant";

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
    removeArtifactKeys: vi.fn().mockResolvedValue(undefined),
  };
  return repo as unknown as IEntityRepository & { updatedArtifacts: Record<string, unknown>[] };
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

function makeRegistry(result: Record<string, unknown>): AdapterRegistry {
  return { execute: vi.fn().mockResolvedValue(result) } as unknown as AdapterRegistry;
}

describe("executeOnEnter", () => {
  it("skips when all named artifacts already exist on entity", async () => {
    const entity = makeEntity({ artifacts: { worktreePath: "/tmp/wt", branch: "fix-123" } });
    const repo = makeEntityRepo();
    const registry = makeRegistry({});
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), registry);

    expect(result.skipped).toBe(true);
    expect(result.error).toBeNull();
    expect(repo.updateArtifacts).not.toHaveBeenCalled();
  });

  it("runs op and merges artifacts on success", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const registry = makeRegistry({ worktreePath: "/tmp/wt", branch: "fix-123" });
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      params: { repo: "{{entity.refs.github.repo}}" },
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), registry);

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
    const registry = makeRegistry({});
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), registry);
    expect(result.skipped).toBe(true);
  });

  it("records error when op fails", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const registry = { execute: vi.fn().mockRejectedValue(new Error("op failed")) } as unknown as AdapterRegistry;
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), registry);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.artifacts).toBeNull();
    expect(repo.updateArtifacts).toHaveBeenCalledWith("entity-1", {
      onEnter_error: expect.objectContaining({
        op: "vcs.provision_worktree",
        error: expect.any(String),
      }),
    });
  });

  it("records error when expected artifact key is missing from op result", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const registry = makeRegistry({ worktreePath: "/tmp/wt" });
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), registry);

    expect(result.skipped).toBe(false);
    expect(result.error).toContain("branch");
    expect(result.artifacts).toBeNull();
  });

  it("returns error when no adapterRegistry provided", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), null);

    expect(result.skipped).toBe(false);
    expect(result.error).toContain("AdapterRegistry");
    expect(result.artifacts).toBeNull();
  });

  it("returns error when flow has no vcs integration", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const registry = makeRegistry({});
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow({ vcsIntegrationId: undefined }), registry);

    expect(result.skipped).toBe(false);
    expect(result.error).toContain("vcs");
    expect(result.artifacts).toBeNull();
  });

  it("runs when only some artifacts exist (not all)", async () => {
    const entity = makeEntity({ artifacts: { worktreePath: "/tmp/wt" } });
    const repo = makeEntityRepo();
    const registry = makeRegistry({ worktreePath: "/tmp/wt2", branch: "fix-456" });
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), registry);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeNull();
    expect(result.artifacts).toEqual({ worktreePath: "/tmp/wt2", branch: "fix-456" });
  });
});

describe("Engine onEnter integration", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let engine: Engine;
  let entityRepo: DrizzleEntityRepository;
  let flowRepo: DrizzleFlowRepository;
  let events: Array<{ type: string }>;
  let mockRegistry: AdapterRegistry;
  let vcsIntegrationId: string;

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    entityRepo = new DrizzleEntityRepository(db, TEST_TENANT);
    flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
    const integrationRepo = new DrizzleIntegrationRepository(db, TEST_TENANT);
    const invocationRepo = new DrizzleInvocationRepository(db, TEST_TENANT);
    const gateRepo = new DrizzleGateRepository(db, TEST_TENANT);
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

    const vcsInt = await integrationRepo.create({
      name: "test-vcs",
      category: "vcs",
      provider: "github",
      credentials: { provider: "github", accessToken: "test-token" },
    });
    vcsIntegrationId = vcsInt.id;

    mockRegistry = {
      execute: vi.fn().mockResolvedValue({ worktreePath: "/tmp/wt", branch: "fix-1" }),
    } as unknown as AdapterRegistry;

    engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo: transitionRepo,
      adapters: new Map(),
      eventEmitter,
      adapterRegistry: mockRegistry,
    });
  });

  afterEach(async () => {
    await close();
  });

  it("onEnter runs and artifacts are merged before invocation creation", async () => {
    const flow = await flowRepo.create({ name: "test-flow", initialState: "triage", vcsIntegrationId });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage this" });
    await flowRepo.addState(flow.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code at {{entity.artifacts.worktreePath}}",
      onEnter: {
        op: "vcs.provision_worktree",
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

  it("onEnter re-runs on re-entry (stale artifacts are cleared)", async () => {
    const flow = await flowRepo.create({ name: "test-flow2", initialState: "triage", vcsIntegrationId });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo.addState(flow.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code",
      onEnter: {
        op: "vcs.provision_worktree",
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

    expect(events).toContainEqual(expect.objectContaining({ type: "onEnter.completed" }));
    expect(events.some((e) => e.type === "onEnter.skipped")).toBe(false);
  });

  it("onEnter failure gates the entity", async () => {
    (mockRegistry.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("op failed"));

    const flow = await flowRepo.create({ name: "test-flow3", initialState: "triage", vcsIntegrationId });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo.addState(flow.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code",
      onEnter: {
        op: "vcs.provision_worktree",
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

    const res2 = await createTestDb();
    const db2 = res2.db;
    const close2 = res2.close;

    const entityRepo2 = new DrizzleEntityRepository(db2, TEST_TENANT);
    const flowRepo2 = new DrizzleFlowRepository(db2, TEST_TENANT);
    const integrationRepo2 = new DrizzleIntegrationRepository(db2, TEST_TENANT);
    const invocationRepo2 = new DrizzleInvocationRepository(db2, TEST_TENANT);
    const gateRepo2 = new DrizzleGateRepository(db2, TEST_TENANT);

    const vcsInt2 = await integrationRepo2.create({
      name: "test-vcs",
      category: "vcs",
      provider: "github",
      credentials: { provider: "github", accessToken: "test-token" },
    });

    const failRegistry = {
      execute: vi.fn().mockRejectedValue(new Error("op failed")),
    } as unknown as AdapterRegistry;

    const engine2 = new Engine({
      entityRepo: entityRepo2,
      flowRepo: flowRepo2,
      invocationRepo: invocationRepo2,
      gateRepo: gateRepo2,
      transitionLogRepo: spyTransitionRepo,
      adapters: new Map(),
      eventEmitter: { emit: async () => {} },
      adapterRegistry: failRegistry,
    });

    const flow2 = await flowRepo2.create({ name: "test-flow4b", initialState: "triage", vcsIntegrationId: vcsInt2.id });
    await flowRepo2.addState(flow2.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo2.addState(flow2.id, {
      name: "coding",
      agentRole: "coder",
      promptTemplate: "code",
      onEnter: { op: "vcs.provision_worktree", artifacts: ["worktreePath"] },
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

    await close2();
  });

  it("createEntity throws when onEnter fails on initial state", async () => {
    (mockRegistry.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("op failed"));

    const flow = await flowRepo.create({ name: "test-flow5", initialState: "setup", vcsIntegrationId });
    await flowRepo.addState(flow.id, {
      name: "setup",
      agentRole: "setupper",
      promptTemplate: "setup",
      onEnter: { op: "vcs.provision_worktree", artifacts: ["worktreePath"] },
    });

    await expect(engine.createEntity("test-flow5")).rejects.toThrow("onEnter failed");
  });

  it("removeArtifactKeys deletes specified keys and preserves others", async () => {
    const flow = await flowRepo.create({ name: "test-rmkeys", initialState: "init" });
    await flowRepo.addState(flow.id, { name: "init", agentRole: "worker", promptTemplate: "go" });
    const entity = await engine.createEntity("test-rmkeys");

    await entityRepo.updateArtifacts(entity.id, {
      prDiff: "old-diff",
      prComments: "old-comments",
      prUrl: "https://github.com/org/repo/pull/1",
      prNumber: 1,
    });

    await entityRepo.removeArtifactKeys(entity.id, ["prDiff", "prComments"]);

    const updated = await entityRepo.get(entity.id);
    expect(updated?.artifacts).not.toHaveProperty("prDiff");
    expect(updated?.artifacts).not.toHaveProperty("prComments");
    expect(updated?.artifacts).toHaveProperty("prUrl", "https://github.com/org/repo/pull/1");
    expect(updated?.artifacts).toHaveProperty("prNumber", 1);
  });

  it("removeArtifactKeys is a no-op when entity has null artifacts", async () => {
    const flow = await flowRepo.create({ name: "test-rmkeys-null", initialState: "init" });
    await flowRepo.addState(flow.id, { name: "init", agentRole: "worker", promptTemplate: "go" });
    const entity = await engine.createEntity("test-rmkeys-null");

    await entityRepo.removeArtifactKeys(entity.id, ["nonexistent"]);

    const updated = await entityRepo.get(entity.id);
    expect(updated).toBeTruthy();
  });

  it("onEnter re-runs on re-entry after artifact keys are cleared", async () => {
    (mockRegistry.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ prDiff: "the-diff", prComments: "the-comments" });

    const flow = await flowRepo.create({ name: "test-reentry", initialState: "triage", vcsIntegrationId });
    await flowRepo.addState(flow.id, { name: "triage", agentRole: "triager", promptTemplate: "triage" });
    await flowRepo.addState(flow.id, {
      name: "reviewing",
      agentRole: "reviewer",
      promptTemplate: "review {{entity.artifacts.prDiff}}",
      onEnter: {
        op: "vcs.fetch_pr_diff",
        artifacts: ["prDiff", "prComments"],
      },
    });
    await flowRepo.addState(flow.id, { name: "fixing", agentRole: "coder", promptTemplate: "fix" });
    await flowRepo.addTransition(flow.id, { fromState: "triage", toState: "reviewing", trigger: "ready" });
    await flowRepo.addTransition(flow.id, { fromState: "reviewing", toState: "fixing", trigger: "needs_fix" });
    await flowRepo.addTransition(flow.id, { fromState: "fixing", toState: "reviewing", trigger: "fixed" });

    const entity = await engine.createEntity("test-reentry");

    const r1 = await engine.processSignal(entity.id, "ready");
    expect(r1.newState).toBe("reviewing");
    const e1 = await entityRepo.get(entity.id);
    expect(e1?.artifacts).toHaveProperty("prDiff");
    expect(e1?.artifacts).toHaveProperty("prComments");

    await engine.processSignal(entity.id, "needs_fix");
    const r2 = await engine.processSignal(entity.id, "fixed");
    expect(r2.newState).toBe("reviewing");

    const e2 = await entityRepo.get(entity.id);
    expect(e2?.artifacts).toHaveProperty("prDiff");
    expect(e2?.artifacts).toHaveProperty("prComments");

    const completedEvents = events.filter(
      (e) => e.type === "onEnter.completed" && (e as Record<string, unknown>)["state"] === "reviewing",
    );
    expect(completedEvents.length).toBe(2);
  });

  it("artifacts from other states are NOT cleared on re-entry", async () => {
    (mockRegistry.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ worktreePath: "/tmp/wt", branch: "fix-1" })
      .mockResolvedValue({ prDiff: "the-diff", prComments: "the-comments" });

    const flow = await flowRepo.create({ name: "test-reentry-preserve", initialState: "provisioning", vcsIntegrationId });
    await flowRepo.addState(flow.id, {
      name: "provisioning",
      agentRole: "provisioner",
      promptTemplate: "provision",
      onEnter: {
        op: "vcs.provision_worktree",
        artifacts: ["worktreePath", "branch"],
      },
    });
    await flowRepo.addState(flow.id, {
      name: "reviewing",
      agentRole: "reviewer",
      promptTemplate: "review",
      onEnter: {
        op: "vcs.fetch_pr_diff",
        artifacts: ["prDiff", "prComments"],
      },
    });
    await flowRepo.addState(flow.id, { name: "fixing", agentRole: "coder", promptTemplate: "fix" });
    await flowRepo.addTransition(flow.id, { fromState: "provisioning", toState: "reviewing", trigger: "ready" });
    await flowRepo.addTransition(flow.id, { fromState: "reviewing", toState: "fixing", trigger: "needs_fix" });
    await flowRepo.addTransition(flow.id, { fromState: "fixing", toState: "reviewing", trigger: "fixed" });

    const entity = await engine.createEntity("test-reentry-preserve");

    await engine.processSignal(entity.id, "ready");
    await engine.processSignal(entity.id, "needs_fix");
    await engine.processSignal(entity.id, "fixed");

    const final = await entityRepo.get(entity.id);
    expect(final?.artifacts).toHaveProperty("worktreePath", "/tmp/wt");
    expect(final?.artifacts).toHaveProperty("branch", "fix-1");
    expect(final?.artifacts).toHaveProperty("prDiff", "the-diff");
    expect(final?.artifacts).toHaveProperty("prComments", "the-comments");
  });
});
