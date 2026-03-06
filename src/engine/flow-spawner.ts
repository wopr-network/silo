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

  return entityRepo.create(flow.id, flow.initialState, parentEntity.refs ?? undefined);
}
