import { describe, it, expect, vi } from "vitest";
import { executeSpawn } from "../../src/engine/flow-spawner.js";
import type { Transition, Entity, IFlowRepository, IEntityRepository } from "../../src/repositories/interfaces.js";

describe("executeSpawn", () => {
  it("creates a new entity in the spawned flow", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: { github: { adapter: "github", id: "pr-42" } },
      artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };

    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: parentEntity.refs, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    };

    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
    expect(flowRepo.getByName).toHaveBeenCalledWith("deploy-flow");
    expect(entityRepo.create).toHaveBeenCalledWith("flow-2", "pending", parentEntity.refs);
  });

  it("records the spawned child on the parent entity's artifacts", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: { github: { adapter: "github", id: "pr-42" } },
      artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };

    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: parentEntity.refs, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    };

    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    expect(entityRepo.updateArtifacts).toHaveBeenCalledWith("ent-1", {
      spawnedChildren: [
        { childId: "ent-2", childFlow: "deploy-flow", spawnedAt: expect.any(String) },
      ],
    });
  });

  it("appends to existing spawnedChildren array", async () => {
    const existingChild = { childId: "ent-0", childFlow: "build-flow", spawnedAt: "2025-01-01T00:00:00.000Z" };
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null,
      artifacts: { spawnedChildren: [existingChild] },
      claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };

    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1,
      createdAt: new Date(), updatedAt: new Date(),
    };

    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    expect(entityRepo.updateArtifacts).toHaveBeenCalledWith("ent-1", {
      spawnedChildren: [
        existingChild,
        { childId: "ent-2", childFlow: "deploy-flow", spawnedAt: expect.any(String) },
      ],
    });
  });

  it("reads fresh entity from DB before building spawnedChildren (TOCTOU)", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    // parentEntity passed in has stale artifacts (no children yet)
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    // DB has a fresher version with an existing child
    const freshEntity: Entity = {
      ...parentEntity,
      artifacts: { spawnedChildren: [{ childId: "ent-0", childFlow: "build-flow", spawnedAt: "2025-01-01T00:00:00.000Z" }] },
    };
    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(freshEntity),
      updateArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    // Must have fetched fresh entity and included the pre-existing child
    expect(entityRepo.get).toHaveBeenCalledWith("ent-1");
    expect(entityRepo.updateArtifacts).toHaveBeenCalledWith("ent-1", {
      spawnedChildren: [
        { childId: "ent-0", childFlow: "build-flow", spawnedAt: "2025-01-01T00:00:00.000Z" },
        { childId: "ent-2", childFlow: "deploy-flow", spawnedAt: expect.any(String) },
      ],
    });
  });

  it("throws if updateArtifacts fails after create (orphan guard)", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts: vi.fn().mockRejectedValue(new Error("DB write failed")),
    } as unknown as IEntityRepository;

    await expect(executeSpawn(transition, parentEntity, flowRepo, entityRepo)).rejects.toThrow(
      /orphan.*ent-2|updateArtifacts.*ent-1/i,
    );
  });

  it("retries updateArtifacts up to 3 times on failure then throws", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const updateArtifacts = vi.fn().mockRejectedValue(new Error("concurrent modification"));
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts,
    } as unknown as IEntityRepository;

    await expect(executeSpawn(transition, parentEntity, flowRepo, entityRepo)).rejects.toThrow(/orphan.*ent-2/i);
    // Should have retried 3 times (3 calls to updateArtifacts)
    expect(updateArtifacts).toHaveBeenCalledTimes(3);
    // Should have re-fetched parent before each retry
    expect(entityRepo.get).toHaveBeenCalledTimes(3);
  });

  it("succeeds on second attempt after transient updateArtifacts failure", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const updateArtifacts = vi.fn()
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValue(undefined);
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts,
    } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
    // Called twice: once failing, once succeeding
    expect(updateArtifacts).toHaveBeenCalledTimes(2);
  });

  it("logs orphan child ID at ERROR level when all retries exhausted", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts: vi.fn().mockRejectedValue(new Error("DB write failed")),
    } as unknown as IEntityRepository;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(executeSpawn(transition, parentEntity, flowRepo, entityRepo)).rejects.toThrow();
      // Must log the orphan child ID at ERROR level
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ent-2"));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("parses spawnedChildren safely without unsafe cast", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    // artifacts.spawnedChildren contains an invalid entry (not the expected shape)
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null,
      artifacts: { spawnedChildren: ["not-an-object", 42, null] },
      claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const spawnedFlow = {
      id: "flow-2", name: "deploy-flow", description: null, entitySchema: null,
      initialState: "pending", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, createdBy: null, createdAt: null, updatedAt: null,
      states: [], transitions: [],
    };
    const spawnedEntity: Entity = {
      id: "ent-2", flowId: "flow-2", state: "pending",
      refs: null, artifacts: null, claimedBy: null, claimedAt: null,
      flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    const flowRepo = { getByName: vi.fn().mockResolvedValue(spawnedFlow) } as unknown as IFlowRepository;
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      get: vi.fn().mockResolvedValue(parentEntity),
      updateArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    // Should not throw even with malformed existing children — filter out invalid entries
    await expect(executeSpawn(transition, parentEntity, flowRepo, entityRepo)).resolves.not.toBeNull();
  });

  it("returns null when transition has no spawnFlow", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "a", toState: "b",
      trigger: "go", gateId: null, condition: null, priority: 0,
      spawnFlow: null, spawnTemplate: null, createdAt: null,
    };
    const entity = {} as Entity;
    const flowRepo = {} as IFlowRepository;
    const entityRepo = {} as IEntityRepository;

    const result = await executeSpawn(transition, entity, flowRepo, entityRepo);
    expect(result).toBeNull();
  });

  it("throws when spawned flow is not found", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "a", toState: "b",
      trigger: "go", gateId: null, condition: null, priority: 0,
      spawnFlow: "nonexistent", spawnTemplate: null, createdAt: null,
    };
    const entity = {} as Entity;
    const flowRepo = { getByName: vi.fn().mockResolvedValue(null) } as unknown as IFlowRepository;
    const entityRepo = {} as IEntityRepository;

    await expect(executeSpawn(transition, entity, flowRepo, entityRepo)).rejects.toThrow("not found");
  });
});
