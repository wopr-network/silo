import type { IGitHubInstallationRepository } from "../../github/installation-repo.js";

export interface GitHubRouterDeps {
  installationRepo: IGitHubInstallationRepository;
  tenantId: string;
}

/** GitHub procedures: installations, removeInstallation. */
export const githubRouter = {
  installations: async (deps: GitHubRouterDeps) => {
    return deps.installationRepo.listByTenant(deps.tenantId);
  },

  removeInstallation: async (deps: GitHubRouterDeps, input: { installationId: number }) => {
    await deps.installationRepo.remove(input.installationId);
    return { removed: true };
  },
};
