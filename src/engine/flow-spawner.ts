import type { Entity, IEntityRepository, IFlowRepository, Transition } from "../repositories/interfaces.js";

/**
 * If the transition has a spawnFlow, look up that flow and create a new entity in it.
 * The spawned entity inherits the parent entity's refs.
 * Returns the spawned entity, or null if no spawn is configured.
 */
export async function executeSpawn(
  transition: Transition,
  parentEntity: Entity,
  flowRepo: IFlowRepository,
  entityRepo: IEntityRepository,
): Promise<Entity | null> {
  if (!transition.spawnFlow) return null;

  const flow = await flowRepo.getByName(transition.spawnFlow);
  if (!flow) throw new Error(`Spawn flow "${transition.spawnFlow}" not found`);

  const childEntity = await entityRepo.create(flow.id, flow.initialState, parentEntity.refs ?? undefined);

  // Optimistic concurrency with retry: re-fetch parent before each attempt so
  // concurrent spawns don't overwrite each other's spawnedChildren entries.
  const MAX_RETRIES = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const freshParent = await entityRepo.get(parentEntity.id);
    const rawChildren = freshParent?.artifacts?.spawnedChildren;
    const existing = (Array.isArray(rawChildren) ? rawChildren : []).filter(
      (c): c is { childId: string; childFlow: string; spawnedAt: string } =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).childId === "string" &&
        typeof (c as Record<string, unknown>).childFlow === "string" &&
        typeof (c as Record<string, unknown>).spawnedAt === "string",
    );
    try {
      await entityRepo.updateArtifacts(parentEntity.id, {
        spawnedChildren: [
          ...existing,
          { childId: childEntity.id, childFlow: transition.spawnFlow, spawnedAt: new Date().toISOString() },
        ],
      });
      return childEntity;
    } catch (err) {
      lastErr = err;
    }
  }

  // All retries exhausted — log orphan so it can be manually cleaned up.
  console.error(
    `[flow-spawner] ORPHAN child entity ${childEntity.id} (flow: ${transition.spawnFlow}) — ` +
      `failed to register on parent ${parentEntity.id} after ${MAX_RETRIES} attempts: ${String(lastErr)}`,
  );
  throw new Error(
    `updateArtifacts failed for parent ${parentEntity.id} after creating orphan child ${childEntity.id}: ${String(lastErr)}`,
  );
}
