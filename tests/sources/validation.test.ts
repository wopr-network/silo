import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRANCH_NAME_REGEX,
  getWorktreeBase,
  validateBranchName,
  validateWorktreePath,
} from "../../src/sources/validation.js";

describe("BRANCH_NAME_REGEX", () => {
  it("matches simple branch names", () => {
    expect(BRANCH_NAME_REGEX.test("main")).toBe(true);
    expect(BRANCH_NAME_REGEX.test("develop")).toBe(true);
  });

  it("matches branch names with slashes", () => {
    expect(BRANCH_NAME_REGEX.test("feature/my-branch")).toBe(true);
    expect(BRANCH_NAME_REGEX.test("feature/wop-2167-test")).toBe(true);
  });

  it("matches branch names with dots", () => {
    expect(BRANCH_NAME_REGEX.test("release/v1.0.0")).toBe(true);
    expect(BRANCH_NAME_REGEX.test("fix.something")).toBe(true);
  });

  it("matches branch names with underscores and hyphens", () => {
    expect(BRANCH_NAME_REGEX.test("my_branch-name")).toBe(true);
  });

  it("rejects branch names with double dots", () => {
    expect(BRANCH_NAME_REGEX.test("feature/../main")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("..evil")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch..name")).toBe(false);
  });

  it("rejects branch names with spaces", () => {
    expect(BRANCH_NAME_REGEX.test("my branch")).toBe(false);
  });

  it("rejects branch names with special characters", () => {
    expect(BRANCH_NAME_REGEX.test("branch~1")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch^2")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch:name")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch?glob")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch*star")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch[0]")).toBe(false);
    expect(BRANCH_NAME_REGEX.test("branch@{1}")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(BRANCH_NAME_REGEX.test("")).toBe(false);
  });
});

describe("validateBranchName", () => {
  it("returns the branch name when valid", () => {
    expect(validateBranchName("main")).toBe("main");
    expect(validateBranchName("feature/wop-123")).toBe("feature/wop-123");
    expect(validateBranchName("release/v2.0.1")).toBe("release/v2.0.1");
  });

  it("throws for branch names with double dots (path traversal)", () => {
    expect(() => validateBranchName("feature/../main")).toThrow("Invalid branch name");
  });

  it("throws for branch names with spaces", () => {
    expect(() => validateBranchName("my branch")).toThrow("Invalid branch name");
  });

  it("throws for branch names with special characters", () => {
    expect(() => validateBranchName("branch~1")).toThrow("Invalid branch name");
    expect(() => validateBranchName("branch:ref")).toThrow("Invalid branch name");
  });

  it("throws for empty string", () => {
    expect(() => validateBranchName("")).toThrow("Invalid branch name");
  });

  it("includes the invalid name in the error message", () => {
    expect(() => validateBranchName("bad name")).toThrow('"bad name"');
  });

  it("includes the regex in the error message", () => {
    expect(() => validateBranchName("bad name")).toThrow(String(BRANCH_NAME_REGEX));
  });
});

describe("getWorktreeBase", () => {
  let originalWorktreeDir: string | undefined;

  beforeEach(() => {
    originalWorktreeDir = process.env.WORKTREE_DIR;
  });

  afterEach(() => {
    if (originalWorktreeDir === undefined) {
      delete process.env.WORKTREE_DIR;
    } else {
      process.env.WORKTREE_DIR = originalWorktreeDir;
    }
  });

  it("returns resolved WORKTREE_DIR when set", () => {
    process.env.WORKTREE_DIR = "/tmp/my-worktrees";
    expect(getWorktreeBase()).toBe(resolve("/tmp/my-worktrees"));
  });

  it("returns resolved ./worktrees when WORKTREE_DIR is not set", () => {
    delete process.env.WORKTREE_DIR;
    expect(getWorktreeBase()).toBe(resolve("./worktrees"));
  });

  it("returns resolved ./worktrees when WORKTREE_DIR is empty string", () => {
    process.env.WORKTREE_DIR = "";
    // Empty string is falsy, so falls back to "./worktrees"
    expect(getWorktreeBase()).toBe(resolve("./worktrees"));
  });

  it("resolves relative WORKTREE_DIR against cwd", () => {
    process.env.WORKTREE_DIR = "relative/path";
    expect(getWorktreeBase()).toBe(resolve("relative/path"));
  });
});

describe("validateWorktreePath", () => {
  const testBase = "/tmp/test-worktrees";

  it("returns resolved path when target is within base", () => {
    const target = `${testBase}/my-repo`;
    expect(validateWorktreePath(target, testBase)).toBe(resolve(target));
  });

  it("returns resolved path when target equals base", () => {
    expect(validateWorktreePath(testBase, testBase)).toBe(resolve(testBase));
  });

  it("accepts nested subdirectories within base", () => {
    const target = `${testBase}/org/repo/worktree`;
    expect(validateWorktreePath(target, testBase)).toBe(resolve(target));
  });

  it("throws when target is outside base (path traversal)", () => {
    const target = `${testBase}/../etc/passwd`;
    expect(() => validateWorktreePath(target, testBase)).toThrow("Worktree path must be within");
  });

  it("throws when target is a sibling directory", () => {
    const target = "/tmp/other-worktrees/repo";
    expect(() => validateWorktreePath(target, testBase)).toThrow("Worktree path must be within");
  });

  it("throws when target is a prefix-match but not a subdirectory", () => {
    // "/tmp/test-worktrees-evil" starts with "/tmp/test-worktrees" but is not a child
    const target = "/tmp/test-worktrees-evil/repo";
    expect(() => validateWorktreePath(target, testBase)).toThrow("Worktree path must be within");
  });

  it("throws when target is parent of base", () => {
    const target = "/tmp";
    expect(() => validateWorktreePath(target, testBase)).toThrow("Worktree path must be within");
  });

  it("includes the base path in error message", () => {
    const target = "/somewhere/else";
    expect(() => validateWorktreePath(target, testBase)).toThrow(resolve(testBase));
  });

  it("includes the resolved target in error message", () => {
    const target = "/somewhere/else";
    expect(() => validateWorktreePath(target, testBase)).toThrow(resolve(target));
  });

  it("uses getWorktreeBase() when base is not provided", () => {
    // When base is omitted, validateWorktreePath calls getWorktreeBase()
    // which defaults to resolve("./worktrees")
    const defaultBase = resolve("./worktrees");
    const target = resolve(defaultBase, "some-repo");
    expect(validateWorktreePath(target)).toBe(resolve(target));
  });

  it("throws for path outside default base when base is omitted", () => {
    expect(() => validateWorktreePath("/etc/passwd")).toThrow("Worktree path must be within");
  });

  it("handles relative target paths by resolving against cwd", () => {
    // resolve("relative/path") resolves against cwd
    // This will be outside testBase, so should throw
    expect(() => validateWorktreePath("relative/path", testBase)).toThrow(
      "Worktree path must be within",
    );
  });
});
