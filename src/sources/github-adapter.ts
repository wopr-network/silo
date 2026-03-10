import { resolve } from "node:path";
import { getWorktreeBase, validateBranchName, validateWorktreePath } from "./validation.js";

export interface GitHubSourceAdapterConfig {
  worktreeBase?: string;
}

export class GitHubSourceAdapter {
  private worktreeBase: string;

  constructor(config?: GitHubSourceAdapterConfig) {
    this.worktreeBase = config?.worktreeBase ? resolve(config.worktreeBase) : getWorktreeBase();
  }

  resolveWorktreePath(subpath: string): string {
    return validateWorktreePath(resolve(this.worktreeBase, subpath), this.worktreeBase);
  }

  validateBranch(name: string): string {
    return validateBranchName(name);
  }
}
