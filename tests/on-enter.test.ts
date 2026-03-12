import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/pg-test-db.js";
import { Engine } from "../src/engine/engine.js";
import { executeOnEnter } from "../src/engine/on-enter.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
import type { Entity, Flow, IEntityRepository, IEventBusAdapter, ITransitionLogRepository, OnEnterConfig } from "../src/repositories/interfaces.js";
import type { AdapterRegistry } from "../src/integrations/registry.js";

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
    parentEntityId: null,
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
    hasAnyInFlowAndState: vi.fn(),
    findByParentId: vi.fn(),
    cancelEntity: vi.fn(),
    resetEntity: vi.fn(),
    updateFlowVersion: vi.fn(),
  };
  return repo as unknown as IEntityRepository & { updatedArtifacts: Record<string, unknown>[] };
}

function makeFlow(overrides?: Partial<Flow>): Flow {
  return {
    id: "flow-1",
    name: "test-flow",
    description: null,
    entitySchema: null,
    initialState: "triage",
    maxConcurrent: 0,
    maxConcurrentPerRepo: 0,
    affinityWindowMs: 300000,
    claimRetryAfterMs: null,
    gateTimeoutMs: null,
    version: 1,
    createdBy: null,
    discipline: null,
    defaultModelTier: null,
    timeoutPrompt: null,
    paused: false,
    issueTrackerIntegrationId: null,
    vcsIntegrationId: "vcs-integration-1",
    createdAt: null,
    updatedAt: null,
    states: [],
    transitions: [],
    ...overrides,
  };
}

function makeMockAdapterRegistry(result: Record<string, unknown> = {}): AdapterRegistry {
  return {
    execute: vi.fn().mockResolvedValue(result),
  } as unknown as AdapterRegistry;
}

describe("executeOnEnter", () => {
  it("skips when all named artifacts already exist on entity", async () => {
    const entity = makeEntity({ artifacts: { worktreePath: "/tmp/wt", branch: "fix-123" } });
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);

    expect(result.skipped).toBe(true);
    expect(result.error).toBeNull();
    expect(repo.updateArtifacts).not.toHaveBeenCalled();
  });

  it("dispatches op via adapter registry and merges artifacts", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const flow = makeFlow();
    const registry = makeMockAdapterRegistry({ worktreePath: "/tmp/wt", branch: "fix-123" });
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
      params: { repo: "{{entity.refs.github.repo}}" },
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.skipped).toBe(false);
    expect(result.error).toBeNull();
    expect(result.artifacts).toEqual({ worktreePath: "/tmp/wt", branch: "fix-123" });
    expect(registry.execute).toHaveBeenCalledWith(
      "vcs-integration-1",
      "vcs.provision_worktree",
      { repo: "wopr-network/wopr" },
      expect.any(AbortSignal),
    );
    expect(repo.updateArtifacts).toHaveBeenCalledWith("entity-1", {
      worktreePath: "/tmp/wt",
      branch: "fix-123",
    });
  });

  it("returns error when adapter registry is not available", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, makeFlow(), null);

    expect(result.error).toContain("AdapterRegistry not available");
    expect(result.artifacts).toBeNull();
  });

  it("returns error when flow has no matching integration", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const flow = makeFlow({ vcsIntegrationId: null });
    const registry = makeMockAdapterRegistry();
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.error).toContain("no vcs integration configured");
  });

  it("returns error when op fails", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const flow = makeFlow();
    const registry = {
      execute: vi.fn().mockRejectedValue(new Error("adapter boom")),
    } as unknown as AdapterRegistry;
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.error).toContain("adapter boom");
    expect(result.timedOut).toBe(false);
  });

  it("returns timedOut when op throws TimeoutError", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const flow = makeFlow();
    const timeoutErr = new DOMException("signal timed out", "TimeoutError");
    const registry = {
      execute: vi.fn().mockRejectedValue(timeoutErr),
    } as unknown as AdapterRegistry;
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
      timeout_ms: 100,
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.timedOut).toBe(true);
    expect(result.error).toContain("timed out");
  });

  it("returns error when expected artifact keys are missing from op result", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const flow = makeFlow();
    const registry = makeMockAdapterRegistry({ worktreePath: "/tmp/wt" });
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.error).toContain("branch");
    expect(result.artifacts).toBeNull();
  });

  it("renders Handlebars params with entity data", async () => {
    const entity = makeEntity({ artifacts: { refs: { linear: { id: "LIN-123" } } } });
    const repo = makeEntityRepo();
    const flow = makeFlow({ issueTrackerIntegrationId: "it-1" });
    const registry = makeMockAdapterRegistry({ comment: "hello" });
    const onEnter: OnEnterConfig = {
      op: "issue_tracker.fetch_comment",
      artifacts: ["comment"],
      params: { issueId: "{{entity.refs.linear.id}}" },
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.error).toBeNull();
    expect(registry.execute).toHaveBeenCalledWith(
      "it-1",
      "issue_tracker.fetch_comment",
      expect.objectContaining({ issueId: "LIN-123" }),
      expect.any(AbortSignal),
    );
  });

  it("returns error on Handlebars template failure", async () => {
    const entity = makeEntity();
    const repo = makeEntityRepo();
    const flow = makeFlow();
    const registry = makeMockAdapterRegistry();
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath"],
      params: { bad: "{{#each broken" },
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

    expect(result.error).toContain("template error");
  });

  it("does not re-run when re-entering state with all artifacts present", async () => {
    const entity = makeEntity({
      artifacts: { worktreePath: "/tmp/wt", branch: "fix-123", other: "stuff" },
    });
    const repo = makeEntityRepo();
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo);
    expect(result.skipped).toBe(true);
  });

  it("runs when only some artifacts exist (not all)", async () => {
    const entity = makeEntity({ artifacts: { worktreePath: "/tmp/wt" } });
    const repo = makeEntityRepo();
    const flow = makeFlow();
    const registry = makeMockAdapterRegistry({ worktreePath: "/tmp/wt2", branch: "fix-456" });
    const onEnter: OnEnterConfig = {
      op: "vcs.provision_worktree",
      artifacts: ["worktreePath", "branch"],
    };

    const result = await executeOnEnter(onEnter, entity, repo, flow, registry);

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

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    entityRepo = new DrizzleEntityRepository(db, TEST_TENANT);
    flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
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

  afterEach(async () => {
    await close();
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

    // Should not throw
    await entityRepo.removeArtifactKeys(entity.id, ["nonexistent"]);

    const updated = await entityRepo.get(entity.id);
    expect(updated).toBeTruthy();
  });
});
