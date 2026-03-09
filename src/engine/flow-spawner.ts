import { NotFoundError } from "../errors.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { Entity, IEntityRepository, IFlowRepository } from "../repositories/interfaces.js";

/**
 * If the transition has a spawnFlow, look up that flow and create a new entity in it.
 * The spawned entity inherits the parent entity's refs.
 * Returns the spawned entity, or null if no spawn is configured.
 */
export async function executeSpawn(
  transition: { spawnFlow: string | null | undefined },
  parentEntity: Entity,
  flowRepo: IFlowRepository,
  entityRepo: IEntityRepository,
  logger: Logger = consoleLogger,
): Promise<Entity | null> {
  if (!transition.spawnFlow) return null;

  const flow = await flowRepo.getByName(transition.spawnFlow);
  if (!flow) throw new NotFoundError(`Spawn flow "${transition.spawnFlow}" not found`);

  const childEntity = await entityRepo.create(
    flow.id,
    flow.initialState,
    parentEntity.refs ?? undefined,
    undefined,
    parentEntity.id,
  );

  try {
    await entityRepo.appendSpawnedChild(parentEntity.id, {
      childId: childEntity.id,
      childFlow: transition.spawnFlow,
      spawnedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Log orphan so it can be manually cleaned up.
    // The child entity is real and functional; only parent artifact bookkeeping failed.
    logger.error(
      `[flow-spawner] ORPHAN child entity ${childEntity.id} (flow: ${transition.spawnFlow}) — ` +
        `failed to register on parent ${parentEntity.id}: ${String(err)}`,
    );
  }
  return childEntity;
}
