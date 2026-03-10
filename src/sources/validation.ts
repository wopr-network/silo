import { resolve, sep } from "node:path";

export const BRANCH_NAME_REGEX = /^(?!.*\.\.)[a-zA-Z0-9/._-]+$/;

export function getWorktreeBase(): string {
  return resolve(process.env.WORKTREE_DIR || "./worktrees");
}

export function validateWorktreePath(target: string, base?: string): string {
  const resolvedBase = base !== undefined ? resolve(base) : getWorktreeBase();
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`Worktree path must be within ${resolvedBase}, got: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

export function validateBranchName(name: string): string {
  if (!BRANCH_NAME_REGEX.test(name)) {
    throw new Error(`Invalid branch name: "${name}". Must match ${BRANCH_NAME_REGEX}`);
  }
  return name;
}
