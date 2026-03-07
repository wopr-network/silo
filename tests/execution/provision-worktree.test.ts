import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBranch,
  buildWorktreePath,
  parseIssueNumber,
  provisionWorktree,
  repoName,
  validateRepoName,
} from "../../src/execution/provision-worktree.js";

describe("provision-worktree helpers", () => {
  describe("parseIssueNumber", () => {
    it("extracts number from WOP-392", () => {
      expect(parseIssueNumber("WOP-392")).toBe("392");
    });
    it("extracts number from wop-1234 (case insensitive)", () => {
      expect(parseIssueNumber("wop-1234")).toBe("1234");
    });
    it("throws on invalid key", () => {
      expect(() => parseIssueNumber("INVALID")).toThrow();
    });
  });

  describe("repoName", () => {
    it("extracts repo name from org/repo", () => {
      expect(repoName("wopr-network/defcon")).toBe("defcon");
    });
    it("handles bare repo name", () => {
      expect(repoName("defcon")).toBe("defcon");
    });
    it("strips trailing slash", () => {
      expect(repoName("wopr-network/defcon/")).toBe("defcon");
    });
  });

  describe("buildBranch", () => {
    it("builds correct branch name", () => {
      expect(buildBranch("WOP-392")).toBe("agent/coder-392/wop-392");
    });
  });

  describe("validateRepoName", () => {
    it("accepts valid repo names", () => {
      expect(validateRepoName("defcon")).toBe("defcon");
      expect(validateRepoName("wopr-platform")).toBe("wopr-platform");
      expect(validateRepoName("repo.name")).toBe("repo.name");
    });
    it("rejects path traversal", () => {
      expect(() => validateRepoName("../etc")).toThrow("Invalid repo name");
    });
    it("rejects slashes", () => {
      expect(() => validateRepoName("org/repo")).toThrow("Invalid repo name");
    });
  });

  describe("buildWorktreePath", () => {
    it("builds correct worktree path", () => {
      expect(buildWorktreePath("wopr-network/defcon", "WOP-392", "/home/tsavo/worktrees")).toBe(
        "/home/tsavo/worktrees/wopr-defcon-coder-392",
      );
    });
  });
});

describe("provisionWorktree idempotency remote URL check", () => {
  let tmpBase: string;
  let cloneRoot: string;

  beforeEach(() => {
    tmpBase = join(tmpdir(), `pwt-test-${Date.now()}`);
    cloneRoot = join(tmpBase, "clones");
    mkdirSync(tmpBase, { recursive: true });
    mkdirSync(cloneRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("throws when existing worktree has wrong remote origin", () => {
    // Set up a bare "origin" repo
    const originPath = join(tmpBase, "origin.git");
    execFileSync("git", ["init", "--bare", originPath]);

    // Clone it as the "clone"
    const cloneName = "defcon";
    const clonePath = join(cloneRoot, cloneName);
    execFileSync("git", ["clone", originPath, clonePath]);
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: clonePath });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: clonePath });

    // Create a commit so symbolic-ref works
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: clonePath });
    execFileSync("git", ["push", "origin", "HEAD"], { cwd: clonePath });

    // Create the worktree manually with the branch we expect
    const branch = "agent/coder-392/wop-392";
    const worktreePath = join(tmpBase, "worktrees", "wopr-defcon-coder-392");
    mkdirSync(join(tmpBase, "worktrees"), { recursive: true });
    execFileSync("git", ["worktree", "add", worktreePath, "-B", branch, "HEAD"], { cwd: clonePath });

    // Change the worktree's remote to a different repo
    execFileSync("git", ["remote", "set-url", "origin", "https://github.com/other-org/other-repo.git"], {
      cwd: worktreePath,
    });

    expect(() =>
      provisionWorktree({
        repo: "wopr-network/defcon",
        issueKey: "WOP-392",
        basePath: join(tmpBase, "worktrees"),
        cloneRoot,
      }),
    ).toThrow(/unexpected remote/);
  });
});
