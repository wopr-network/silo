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
      appendSpawnedChild: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
    expect(flowRepo.getByName).toHaveBeenCalledWith("deploy-flow");
    expect(entityRepo.create).toHaveBeenCalledWith("flow-2", "pending", parentEntity.refs, undefined, "ent-1");
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
    const appendSpawnedChild = vi.fn().mockResolvedValue(undefined);
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      appendSpawnedChild,
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    expect(appendSpawnedChild).toHaveBeenCalledWith("ent-1", {
      childId: "ent-2", childFlow: "deploy-flow", spawnedAt: expect.any(String),
    });
  });

  it("delegates array-append atomicity to appendSpawnedChild", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null,
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
    const appendSpawnedChild = vi.fn().mockResolvedValue(undefined);
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      appendSpawnedChild,
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    // appendSpawnedChild is called exactly once with the new child entry
    expect(appendSpawnedChild).toHaveBeenCalledTimes(1);
    expect(appendSpawnedChild).toHaveBeenCalledWith("ent-1", {
      childId: "ent-2", childFlow: "deploy-flow", spawnedAt: expect.any(String),
    });
  });

  it("calls appendSpawnedChild with the correct entry shape", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null,
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
    const appendSpawnedChild = vi.fn().mockResolvedValue(undefined);
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      appendSpawnedChild,
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    expect(appendSpawnedChild).toHaveBeenCalledWith("ent-1", {
      childId: "ent-2",
      childFlow: "deploy-flow",
      spawnedAt: expect.any(String),
    });
  });

  it("delegates TOCTOU safety to appendSpawnedChild (no get call needed in spawner)", async () => {
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
    const appendSpawnedChild = vi.fn().mockResolvedValue(undefined);
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      appendSpawnedChild,
    } as unknown as IEntityRepository;

    await executeSpawn(transition, parentEntity, flowRepo, entityRepo);

    // The spawner delegates read-modify-write to appendSpawnedChild — no get call required
    expect(appendSpawnedChild).toHaveBeenCalledWith("ent-1", {
      childId: "ent-2", childFlow: "deploy-flow", spawnedAt: expect.any(String),
    });
  });

  it("returns child entity if appendSpawnedChild fails after create (orphan guard — non-throwing)", async () => {
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
      appendSpawnedChild: vi.fn().mockRejectedValue(new Error("DB write failed")),
    } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    // Child was created successfully; only parent bookkeeping failed — should not throw
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
  });

  it("calls appendSpawnedChild exactly once (no retry loop — atomicity handled by transaction)", async () => {
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
    const appendSpawnedChild = vi.fn().mockResolvedValue(undefined);
    const entityRepo = {
      create: vi.fn().mockResolvedValue(spawnedEntity),
      appendSpawnedChild,
    } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    expect(appendSpawnedChild).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
  });

  it("returns child entity when appendSpawnedChild succeeds", async () => {
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
      appendSpawnedChild: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
  });

  it("logs orphan child ID at ERROR level when appendSpawnedChild fails", async () => {
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
      appendSpawnedChild: vi.fn().mockRejectedValue(new Error("DB write failed")),
    } as unknown as IEntityRepository;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
      // Must log the orphan child ID at ERROR level
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ent-2"));
      // Must still return the child entity (non-throwing)
      expect(result).not.toBeNull();
      expect(result!.id).toBe("ent-2");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not throw when appendSpawnedChild resolves (malformed existing children handled by repo layer)", async () => {
    const transition: Transition = {
      id: "t-1", flowId: "flow-1", fromState: "review", toState: "done",
      trigger: "approved", gateId: null, condition: null, priority: 0,
      spawnFlow: "deploy-flow", spawnTemplate: null, createdAt: null,
    };
    const parentEntity: Entity = {
      id: "ent-1", flowId: "flow-1", state: "done",
      refs: null, artifacts: null,
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
      appendSpawnedChild: vi.fn().mockResolvedValue(undefined),
    } as unknown as IEntityRepository;

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
