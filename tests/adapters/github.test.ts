import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubCodeHostAdapter, MergeConflictError, PRNotFoundError } from "../../src/adapters/github.js";

type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

let mockExec: ReturnType<typeof vi.fn<ExecFn>>;
let adapter: GitHubCodeHostAdapter;

beforeEach(() => {
  mockExec = vi.fn<ExecFn>();
  adapter = new GitHubCodeHostAdapter(mockExec);
});

describe("GitHubCodeHostAdapter", () => {
  it("can be instantiated", () => {
    expect(adapter).toBeDefined();
  });
});

describe("getPR", () => {
  it("returns parsed JSON from gh pr view", async () => {
    const prJson = { number: 42, title: "Fix bug", state: "OPEN", url: "https://github.com/org/repo/pull/42" };
    mockExec.mockResolvedValueOnce({ stdout: JSON.stringify(prJson), stderr: "" });

    const result = await adapter.getPR("org/repo", 42);

    expect(mockExec).toHaveBeenCalledWith("gh", [
      "pr", "view", "42", "--repo", "org/repo", "--json",
      "number,title,state,body,author,baseRefName,headRefName,url,createdAt,updatedAt",
    ]);
    expect(result).toEqual(prJson);
  });

  it("throws PRNotFoundError when PR does not exist", async () => {
    mockExec.mockRejectedValueOnce(
      Object.assign(new Error("exit code 1"), { stderr: "Could not resolve to a PullRequest" }),
    );

    await expect(adapter.getPR("org/repo", 999)).rejects.toThrow(PRNotFoundError);
  });

  it("rethrows unexpected errors", async () => {
    mockExec.mockRejectedValueOnce(new Error("network timeout"));

    await expect(adapter.getPR("org/repo", 1)).rejects.toThrow("network timeout");
  });
});

describe("getDiff", () => {
  it("returns raw diff string from gh pr diff", async () => {
    const diff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new";
    mockExec.mockResolvedValueOnce({ stdout: diff, stderr: "" });

    const result = await adapter.getDiff("org/repo", 42);

    expect(mockExec).toHaveBeenCalledWith("gh", ["pr", "diff", "42", "--repo", "org/repo"]);
    expect(result).toBe(diff.trim());
  });

  it("throws PRNotFoundError when PR does not exist", async () => {
    mockExec.mockRejectedValueOnce(
      Object.assign(new Error("exit code 1"), { stderr: "Could not resolve to a PullRequest" }),
    );

    await expect(adapter.getDiff("org/repo", 999)).rejects.toThrow(PRNotFoundError);
  });
});

describe("getChecks", () => {
  it("parses gh pr checks JSON output", async () => {
    const checksJson = [
      { name: "Build", state: "SUCCESS", conclusion: "success" },
      { name: "Lint", state: "PENDING", conclusion: "pending" },
    ];
    mockExec.mockResolvedValueOnce({ stdout: JSON.stringify(checksJson), stderr: "" });

    const result = await adapter.getChecks("org/repo", 42);

    expect(mockExec).toHaveBeenCalledWith("gh", [
      "pr", "checks", "42", "--repo", "org/repo", "--json", "name,state,conclusion",
    ]);
    expect(result).toEqual([
      { name: "Build", status: "SUCCESS", conclusion: "success" },
      { name: "Lint", status: "PENDING", conclusion: "pending" },
    ]);
  });

  it("returns empty array when no checks exist", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "[]", stderr: "" });

    const result = await adapter.getChecks("org/repo", 42);
    expect(result).toEqual([]);
  });
});

describe("createPR", () => {
  it("creates PR and returns number + url", async () => {
    const createOutput = JSON.stringify({ number: 99, url: "https://github.com/org/repo/pull/99" });
    mockExec.mockResolvedValueOnce({ stdout: createOutput, stderr: "" });

    const result = await adapter.createPR("org/repo", {
      title: "My PR",
      body: "Description",
      head: "feat-branch",
      base: "main",
    });

    expect(mockExec).toHaveBeenCalledWith("gh", [
      "pr", "create", "--repo", "org/repo",
      "--title", "My PR", "--body", "Description",
      "--head", "feat-branch", "--base", "main",
      "--json", "number,url",
    ]);
    expect(result).toEqual({ number: 99, url: "https://github.com/org/repo/pull/99" });
  });
});

describe("mergePR", () => {
  it("merges with squash strategy and auto flag", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await adapter.mergePR("org/repo", 42, "squash");

    expect(mockExec).toHaveBeenCalledWith("gh", [
      "pr", "merge", "42", "--repo", "org/repo", "--squash", "--auto",
    ]);
  });

  it("merges with merge strategy", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await adapter.mergePR("org/repo", 42, "merge");

    expect(mockExec).toHaveBeenCalledWith("gh", [
      "pr", "merge", "42", "--repo", "org/repo", "--merge", "--auto",
    ]);
  });

  it("merges with rebase strategy", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await adapter.mergePR("org/repo", 42, "rebase");

    expect(mockExec).toHaveBeenCalledWith("gh", [
      "pr", "merge", "42", "--repo", "org/repo", "--rebase", "--auto",
    ]);
  });

  it("throws MergeConflictError on conflict", async () => {
    mockExec.mockRejectedValueOnce(
      Object.assign(new Error("exit code 1"), { stderr: "is not mergeable" }),
    );

    await expect(adapter.mergePR("org/repo", 42, "squash")).rejects.toThrow(MergeConflictError);
  });
});

describe("createWorktree", () => {
  it("calls git worktree add and returns the path", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "" });

    const result = await adapter.createWorktree("/home/user/repos/org-repo", "feat-branch", "/tmp/wt/feat");

    expect(mockExec).toHaveBeenCalledWith("git", [
      "-C", "/home/user/repos/org-repo", "worktree", "add", "-b", "feat-branch", "/tmp/wt/feat",
    ]);
    expect(result).toBe("/tmp/wt/feat");
  });
});

describe("removeWorktree", () => {
  it("calls git worktree remove --force then prune with repo context", async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    await adapter.removeWorktree("/tmp/wt/feat", "/home/user/repos/org-repo");

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenNthCalledWith(1, "git", [
      "-C", "/home/user/repos/org-repo", "worktree", "remove", "--force", "/tmp/wt/feat",
    ]);
    expect(mockExec).toHaveBeenNthCalledWith(2, "git", [
      "-C", "/home/user/repos/org-repo", "worktree", "prune",
    ]);
  });
});
