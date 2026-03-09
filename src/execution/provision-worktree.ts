/**
 * @deprecated provision-worktree is superseded by nuke containerized workers (WOP-2014).
 * Nuke containers provision their own workspace inside the container.
 * TODO: remove this file once nuke is deployed and stable.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ProvisionWorktreeResult {
  worktreePath: string;
  branch: string;
  repo: string;
}

export function parseIssueNumber(issueKey: string): string {
  const match = issueKey.match(/^[A-Za-z]+[-](\d+)$/);
  if (!match) {
    throw new Error(`Invalid issue key: ${issueKey}. Expected format: WOP-123`);
  }
  return match[1];
}

export function repoName(repo: string): string {
  const parts = repo.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || repo;
}

export function validateRepoName(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid repo name: ${name}`);
  }
  if (name === "." || name === "..") {
    throw new Error(`Invalid repo name: ${name}`);
  }
  return name;
}

export function buildBranch(issueKey: string): string {
  const num = parseIssueNumber(issueKey);
  return `agent/coder-${num}/${issueKey.toLowerCase()}`;
}

export function buildWorktreePath(repo: string, issueKey: string, basePath: string): string {
  const name = repoName(repo);
  const num = parseIssueNumber(issueKey);
  return join(basePath, `wopr-${name}-coder-${num}`);
}

function run(cmd: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    throw new Error(`${cmd} ${args.join(" ")} failed: ${e.stderr ?? e.message ?? String(err)}`);
  }
}

export function provisionWorktree(opts: {
  repo: string;
  issueKey: string;
  basePath?: string;
  cloneRoot?: string;
}): ProvisionWorktreeResult {
  const basePath = opts.basePath ?? join(homedir(), "worktrees");
  const cloneRoot = opts.cloneRoot ?? homedir();
  const name = validateRepoName(repoName(opts.repo));
  const clonePath = join(cloneRoot, name);
  if (!resolve(clonePath).startsWith(`${resolve(cloneRoot)}/`) && resolve(clonePath) !== resolve(cloneRoot)) {
    throw new Error(`Repo name escapes cloneRoot: ${name}`);
  }
  const worktreePath = buildWorktreePath(opts.repo, opts.issueKey, basePath);
  const branch = buildBranch(opts.issueKey);

  // Idempotent: if worktree already exists, verify and return
  if (existsSync(worktreePath)) {
    try {
      run("git", ["rev-parse", "--git-dir"], worktreePath);
      const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
      if (currentBranch !== branch) {
        throw new Error(`Worktree at ${worktreePath} is on branch ${currentBranch}, expected ${branch}`);
      }
      const remoteUrl = run("git", ["remote", "get-url", "origin"], worktreePath);
      const repoPath = opts.repo.replace(/\.git$/, "");
      const urlMatchesRepo =
        remoteUrl.endsWith(`/${repoPath}`) ||
        remoteUrl.endsWith(`/${repoPath}.git`) ||
        remoteUrl.endsWith(`:${repoPath}`) ||
        remoteUrl.endsWith(`:${repoPath}.git`);
      if (!urlMatchesRepo) {
        throw new Error(
          `Worktree at ${worktreePath} has unexpected remote: ${remoteUrl} (expected to contain ${opts.repo})`,
        );
      }
      return { worktreePath, branch, repo: opts.repo };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Worktree at")) {
        throw err;
      }
      throw new Error(`Path ${worktreePath} exists but is not a git worktree`);
    }
  }

  // Clone if repo not present
  if (!existsSync(clonePath)) {
    const cloneUrl = `https://github.com/${opts.repo}.git`;
    process.stderr.write(`Cloning ${cloneUrl} to ${clonePath}...\n`);
    run("git", ["clone", cloneUrl, clonePath]);
  }

  // Fetch latest
  process.stderr.write(`Fetching origin in ${clonePath}...\n`);
  run("git", ["fetch", "origin"], clonePath);

  // Create worktree
  process.stderr.write(`Creating worktree at ${worktreePath}...\n`);
  const defaultBranchRef = run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], clonePath);
  const defaultBranch = defaultBranchRef.replace("origin/", "");
  try {
    run("git", ["worktree", "add", worktreePath, "-b", branch, `origin/${defaultBranch}`], clonePath);
  } catch (err) {
    // Branch may already exist — check if a worktree with the right branch is now present
    if (existsSync(worktreePath)) {
      try {
        run("git", ["rev-parse", "--git-dir"], worktreePath);
        const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
        if (currentBranch === branch) {
          // Worktree already exists on the correct branch — idempotent success
          return { worktreePath, branch, repo: opts.repo };
        }
      } catch {
        // fall through to rethrow original error
      }
    }
    throw err;
  }

  // Install dependencies
  const hasPnpmLock = existsSync(join(worktreePath, "pnpm-lock.yaml"));
  const hasYarnLock = existsSync(join(worktreePath, "yarn.lock"));
  const installCmd = hasPnpmLock ? "pnpm" : hasYarnLock ? "yarn" : "npm";
  process.stderr.write(`Running ${installCmd} install in ${worktreePath}...\n`);
  execFileSync(installCmd, ["install"], { cwd: worktreePath, stdio: "inherit" });

  return { worktreePath, branch, repo: opts.repo };
}
