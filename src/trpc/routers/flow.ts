import { z } from "zod";
import type { IFlowRepository } from "../../repositories/interfaces.js";

// biome-ignore lint/suspicious/noExplicitAny: tRPC router/procedure types from platform-core
type Router = any;
// biome-ignore lint/suspicious/noExplicitAny: tRPC procedure builder
type Procedure = any;

let flowRepo: IFlowRepository | null = null;

export function setFlowRouterDeps(deps: { flowRepo: IFlowRepository }) {
  flowRepo = deps.flowRepo;
}

export function createFlowRouter(router: Router, protectedProcedure: Procedure) {
  return router({
    list: protectedProcedure.query(async () => {
      if (!flowRepo) throw new Error("Flow router not initialized");
      return flowRepo.listAll();
    }),

    get: protectedProcedure
      .input(z.object({ name: z.string() }))
      .query(async ({ input }: { input: { name: string } }) => {
        if (!flowRepo) throw new Error("Flow router not initialized");
        return flowRepo.getByName(input.name);
      }),

    update: protectedProcedure
      .input(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          paused: z.boolean().optional(),
          maxCreditsPerEntity: z.number().optional(),
          maxInvocationsPerEntity: z.number().optional(),
        }),
      )
      .mutation(
        async ({
          input,
        }: {
          input: {
            name: string;
            description?: string;
            paused?: boolean;
            maxCreditsPerEntity?: number;
            maxInvocationsPerEntity?: number;
          };
        }) => {
          if (!flowRepo) throw new Error("Flow router not initialized");
          const flow = await flowRepo.getByName(input.name);
          if (!flow) throw new Error(`Flow "${input.name}" not found`);
          const { name: _, ...changes } = input;
          return flowRepo.update(flow.id, changes);
        },
      ),
  });
}
