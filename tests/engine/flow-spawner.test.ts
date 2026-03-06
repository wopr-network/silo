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
    const entityRepo = { create: vi.fn().mockResolvedValue(spawnedEntity) } as unknown as IEntityRepository;

    const result = await executeSpawn(transition, parentEntity, flowRepo, entityRepo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ent-2");
    expect(flowRepo.getByName).toHaveBeenCalledWith("deploy-flow");
    expect(entityRepo.create).toHaveBeenCalledWith("flow-2", "pending", parentEntity.refs);
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
