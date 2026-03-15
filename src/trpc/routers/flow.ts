import type { IFlowRepository, UpdateFlowInput } from "../../repositories/interfaces.js";

export interface FlowRouterDeps {
  flows: IFlowRepository;
}

/** Flow procedures: list, get, update. */
export const flowRouter = {
  list: async (deps: FlowRouterDeps) => {
    return deps.flows.listAll();
  },

  get: async (deps: FlowRouterDeps, input: { name: string }) => {
    return deps.flows.getByName(input.name);
  },

  update: async (deps: FlowRouterDeps, input: { id: string; changes: UpdateFlowInput }) => {
    return deps.flows.update(input.id, input.changes);
  },
};
