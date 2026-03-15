import type { Engine } from "../../engine/engine.js";
import type { IEntityRepository } from "../../repositories/interfaces.js";

export interface EntityRouterDeps {
  entities: IEntityRepository;
  engine: Engine;
}

/** Entity procedures: list, get, shipIt, status. */
export const entityRouter = {
  list: async (deps: EntityRouterDeps, input: { flowId: string; state: string; limit?: number }) => {
    return deps.entities.findByFlowAndState(input.flowId, input.state, input.limit);
  },

  get: async (deps: EntityRouterDeps, input: { id: string }) => {
    return deps.entities.get(input.id);
  },

  shipIt: async (
    deps: EntityRouterDeps,
    input: {
      flowName: string;
      refs?: Record<string, { adapter: string; id: string }>;
      payload?: Record<string, unknown>;
    },
  ) => {
    return deps.engine.createEntity(input.flowName, input.refs, input.payload);
  },

  status: async (deps: EntityRouterDeps) => {
    return deps.engine.getStatus();
  },
};
