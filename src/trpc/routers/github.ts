import { z } from "zod";
import type { GitHubInstallationRepo } from "../../github/installation-repo.js";

// biome-ignore lint/suspicious/noExplicitAny: tRPC router/procedure types
type Router = any;
// biome-ignore lint/suspicious/noExplicitAny: tRPC procedure builder
type Procedure = any;

let installationRepo: GitHubInstallationRepo | null = null;

export function setGithubRouterDeps(deps: { installationRepo: GitHubInstallationRepo }) {
  installationRepo = deps.installationRepo;
}

export function createGithubRouter(router: Router, protectedProcedure: Procedure) {
  return router({
    installations: protectedProcedure.query(async () => {
      if (!installationRepo) throw new Error("GitHub router not initialized");
      // TODO: resolve tenantId from session context
      const tenantId = "default";
      return installationRepo.getByTenantId(tenantId);
    }),

    removeInstallation: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }: { input: { id: string } }) => {
        if (!installationRepo) throw new Error("GitHub router not initialized");
        await installationRepo.delete(input.id);
        return { ok: true };
      }),
  });
}
