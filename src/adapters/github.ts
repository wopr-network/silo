import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ICodeHostAdapter } from "./interfaces.js";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export class MergeConflictError extends Error {
  constructor(repo: string, pr: number) {
    super(`Merge conflict on ${repo}#${pr}`);
    this.name = "MergeConflictError";
  }
}

export class PRNotFoundError extends Error {
  constructor(repo: string, pr: number) {
    super(`PR not found: ${repo}#${pr}`);
    this.name = "PRNotFoundError";
  }
}

function defaultExec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args);
}

export class GitHubCodeHostAdapter implements ICodeHostAdapter {
  private exec: ExecFn;

  constructor(exec?: ExecFn) {
    this.exec = exec ?? defaultExec;
  }

  private async gh(args: string[]): Promise<string> {
    const { stdout } = await this.exec("gh", args);
    return stdout.trim();
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await this.exec("git", args);
    return stdout.trim();
  }

  async getPR(repo: string, number: number): Promise<Record<string, unknown>> {
    try {
      const raw = await this.gh([
        "pr",
        "view",
        String(number),
        "--repo",
        repo,
        "--json",
        "number,title,state,body,author,baseRefName,headRefName,url,createdAt,updatedAt",
      ]);
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err: unknown) {
      const stderr = String((err as { stderr?: unknown }).stderr ?? "");
      if (stderr.includes("Could not resolve")) {
        throw new PRNotFoundError(repo, number);
      }
      throw err;
    }
  }

  async getDiff(repo: string, number: number): Promise<string> {
    try {
      return await this.gh(["pr", "diff", String(number), "--repo", repo]);
    } catch (err: unknown) {
      const stderr = String((err as { stderr?: unknown }).stderr ?? "");
      if (stderr.includes("Could not resolve")) {
        throw new PRNotFoundError(repo, number);
      }
      throw err;
    }
  }

  async getChecks(repo: string, number: number): Promise<{ name: string; status: string; conclusion?: string }[]> {
    const raw = await this.gh(["pr", "checks", String(number), "--repo", repo, "--json", "name,state,conclusion"]);
    const checks = JSON.parse(raw) as { name: string; state: string; conclusion: string }[];
    return checks.map((c) => ({
      name: c.name,
      status: c.state,
      conclusion: c.conclusion,
    }));
  }

  async createPR(repo: string, data: Record<string, unknown>): Promise<{ number: number; url: string }> {
    const title = String(data.title ?? "");
    const body = String(data.body ?? "");
    const head = String(data.head ?? "");
    const base = String(data.base ?? "main");

    const raw = await this.gh([
      "pr",
      "create",
      "--repo",
      repo,
      "--title",
      title,
      "--body",
      body,
      "--head",
      head,
      "--base",
      base,
      "--json",
      "number,url",
    ]);
    return JSON.parse(raw) as { number: number; url: string };
  }

  async mergePR(repo: string, number: number, strategy: "merge" | "squash" | "rebase"): Promise<void> {
    try {
      await this.gh(["pr", "merge", String(number), "--repo", repo, `--${strategy}`, "--auto"]);
    } catch (err: unknown) {
      const stderr = String((err as { stderr?: unknown }).stderr ?? "");
      if (stderr.includes("not mergeable") || stderr.includes("merge conflict")) {
        throw new MergeConflictError(repo, number);
      }
      throw err;
    }
  }

  async createWorktree(localRepoPath: string, branch: string, path: string): Promise<string> {
    await this.git(["-C", localRepoPath, "worktree", "add", "-b", branch, path]);
    return path;
  }

  async removeWorktree(path: string, localRepoPath: string): Promise<void> {
    await this.git(["-C", localRepoPath, "worktree", "remove", "--force", path]);
    await this.git(["-C", localRepoPath, "worktree", "prune"]);
  }
}
