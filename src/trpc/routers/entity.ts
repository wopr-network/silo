import { z } from "zod";
import type { Engine } from "../../engine/engine.js";
import type {
  IEntityRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
} from "../../repositories/interfaces.js";

// biome-ignore lint/suspicious/noExplicitAny: tRPC router/procedure types
type Router = any;
// biome-ignore lint/suspicious/noExplicitAny: tRPC procedure builder
type Procedure = any;

let deps: {
  engine: Engine;
  entityRepo: IEntityRepository;
  flowRepo: IFlowRepository;
  invocationRepo: IInvocationRepository;
  gateRepo: IGateRepository;
} | null = null;

export function setEntityRouterDeps(d: typeof deps) {
  deps = d;
}

export function createEntityRouter(router: Router, protectedProcedure: Procedure) {
  return router({
    list: protectedProcedure
      .input(z.object({ flow: z.string(), state: z.string().optional(), limit: z.number().optional() }))
      .query(async ({ input }: { input: { flow: string; state?: string; limit?: number } }) => {
        if (!deps) throw new Error("Entity router not initialized");
        const flow = await deps.flowRepo.getByName(input.flow);
        if (!flow) return [];
        if (input.state) {
          return deps.entityRepo.findByFlowAndState(flow.id, input.state, input.limit);
        }
        // Return entities across all states
        const entities = await Promise.all(
          flow.states.map((s) => deps?.entityRepo.findByFlowAndState(flow.id, s.name)),
        );
        return entities.flat().slice(0, input.limit ?? 100);
      }),

    get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }: { input: { id: string } }) => {
      if (!deps) throw new Error("Entity router not initialized");
      const entity = await deps.entityRepo.get(input.id);
      if (!entity) return null;
      const [invocations, gateResults] = await Promise.all([
        deps.invocationRepo.findByEntity(input.id),
        deps.gateRepo.resultsFor(input.id),
      ]);
      return { ...entity, invocations, gateResults };
    }),

    shipIt: protectedProcedure
      .input(
        z.object({
          issueUrl: z.string().optional(),
          owner: z.string().optional(),
          repo: z.string().optional(),
          issueNumber: z.number().optional(),
        }),
      )
      .mutation(
        async ({
          input: _input,
        }: {
          input: { issueUrl?: string; owner?: string; repo?: string; issueNumber?: number };
        }) => {
          if (!deps) throw new Error("Entity router not initialized");
          return { ok: true, message: "Ship It endpoint not yet wired via tRPC" };
        },
      ),

    status: protectedProcedure.query(async () => {
      if (!deps) throw new Error("Entity router not initialized");
      return deps.engine.getStatus();
    }),
  });
}
