import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkCommentExists,
  checkPrStatus,
  checkPrForBranch,
  checkPrReviewStatus,
  checkPrHeadChanged,
  checkFilesChangedSince,
} from "../../src/github/primitive-ops.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("checkCommentExists", () => {
  const ctx = { token: "test-token", owner: "wopr-network", repo: "test-repo" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'exists' with extracted body when matching comment found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { body: "Some unrelated comment" },
        { body: "## Implementation Spec\n\nFull spec text.\n\n### Details\nMore content." },
      ],
    });

    const result = await checkCommentExists(ctx, { issueNumber: 42, pattern: "## Implementation Spec" });

    expect(result.outcome).toBe("exists");
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.extractedBody).toContain("## Implementation Spec");
    expect(result.artifacts!.extractedBody).toContain("More content.");
  });

  it("returns 'not_found' with no artifacts when no match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ body: "Unrelated comment" }],
    });

    const result = await checkCommentExists(ctx, { issueNumber: 42, pattern: "## Implementation Spec" });

    expect(result.outcome).toBe("not_found");
    expect(result.artifacts).toBeUndefined();
  });

  it("returns last matching comment when multiple match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { body: "## Implementation Spec\n\nOld version" },
        { body: "## Implementation Spec\n\nNew version" },
      ],
    });

    const result = await checkCommentExists(ctx, { issueNumber: 42, pattern: "## Implementation Spec" });

    expect(result.outcome).toBe("exists");
    expect(result.artifacts!.extractedBody).toContain("New version");
  });

  it("returns error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await checkCommentExists(ctx, { issueNumber: 42, pattern: "## Implementation Spec" });

    expect(result.outcome).toBe("error");
    expect(result.artifacts).toBeUndefined();
  });
});

describe("checkPrStatus", () => {
  const ctx = { token: "test-token", owner: "wopr-network", repo: "test-repo" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'mergeable' with PR metadata artifacts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        merged: false, state: "open", mergeable_state: "clean",
        html_url: "https://github.com/wopr-network/test-repo/pull/7",
        number: 7, head: { sha: "abc123def456" },
      }),
    });

    const result = await checkPrStatus(ctx, { pullNumber: 7 });

    expect(result.outcome).toBe("mergeable");
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.prUrl).toBe("https://github.com/wopr-network/test-repo/pull/7");
    expect(result.artifacts!.prNumber).toBe(7);
    expect(result.artifacts!.headSha).toBe("abc123def456");
  });

  it("returns 'merged' with artifacts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        merged: true, state: "closed", mergeable_state: "unknown",
        html_url: "https://github.com/wopr-network/test-repo/pull/7",
        number: 7, head: { sha: "abc123" },
      }),
    });

    const result = await checkPrStatus(ctx, { pullNumber: 7 });

    expect(result.outcome).toBe("merged");
    expect(result.artifacts!.prUrl).toBe("https://github.com/wopr-network/test-repo/pull/7");
  });

  it("returns 'blocked' with artifacts and message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        merged: false, state: "open", mergeable_state: "blocked",
        html_url: "https://github.com/wopr-network/test-repo/pull/7",
        number: 7, head: { sha: "abc123" },
      }),
    });

    const result = await checkPrStatus(ctx, { pullNumber: 7 });

    expect(result.outcome).toBe("blocked");
    expect(result.artifacts!.headSha).toBe("abc123");
  });

  it("returns error without artifacts on API failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await checkPrStatus(ctx, { pullNumber: 7 });

    expect(result.outcome).toBe("error");
    expect(result.artifacts).toBeUndefined();
  });
});

describe("checkPrForBranch", () => {
  const ctx = { token: "test-token", owner: "wopr-network", repo: "test-repo" };

  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 'exists' with artifacts when matching PR found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { html_url: "https://github.com/wopr-network/test-repo/pull/5", number: 5, head: { ref: "feature/unrelated", sha: "aaa" } },
        { html_url: "https://github.com/wopr-network/test-repo/pull/7", number: 7, head: { ref: "agent/entity-abc/wop-42", sha: "bbb123" } },
      ],
    });
    const result = await checkPrForBranch(ctx, { branchPattern: "agent/entity-abc/" });
    expect(result.outcome).toBe("exists");
    expect(result.artifacts!.prNumber).toBe(7);
    expect(result.artifacts!.headSha).toBe("bbb123");
    expect(result.artifacts!.headBranch).toBe("agent/entity-abc/wop-42");
  });

  it("returns 'not_found' when no match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { html_url: "https://github.com/wopr-network/test-repo/pull/5", number: 5, head: { ref: "feature/unrelated", sha: "aaa" } },
      ],
    });
    const result = await checkPrForBranch(ctx, { branchPattern: "agent/entity-abc/" });
    expect(result.outcome).toBe("not_found");
  });
});

describe("checkPrReviewStatus", () => {
  const ctx = { token: "test-token", owner: "wopr-network", repo: "test-repo" };

  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 'clean' when no blocking reviews or bot comments", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [{ state: "APPROVED", user: { login: "human" }, body: "LGTM" }],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [{ user: { login: "human-commenter" }, body: "Nice work" }],
    });
    const result = await checkPrReviewStatus(ctx, { pullNumber: 7 });
    expect(result.outcome).toBe("clean");
  });

  it("returns 'has_issues' with findings when changes requested", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [{ state: "CHANGES_REQUESTED", user: { login: "reviewer" }, body: "Fix the null check" }],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [],
    });
    const result = await checkPrReviewStatus(ctx, { pullNumber: 7 });
    expect(result.outcome).toBe("has_issues");
    expect(result.artifacts!.reviewFindings).toContain("Fix the null check");
  });

  it("returns 'has_issues' when bot comments exist", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [{ user: { login: "coderabbitai[bot]" }, body: "Security: SQL injection risk" }],
    });
    const result = await checkPrReviewStatus(ctx, { pullNumber: 7 });
    expect(result.outcome).toBe("has_issues");
    expect(result.artifacts!.reviewFindings).toContain("SQL injection");
  });
});

describe("checkPrHeadChanged", () => {
  const ctx = { token: "test-token", owner: "wopr-network", repo: "test-repo" };

  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 'changed' with new SHA when head differs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ head: { sha: "new-sha-456" } }),
    });
    const result = await checkPrHeadChanged(ctx, { pullNumber: 7, lastKnownSha: "old-sha-123" });
    expect(result.outcome).toBe("changed");
    expect(result.artifacts!.headSha).toBe("new-sha-456");
  });

  it("returns 'unchanged' when SHA matches", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ head: { sha: "same-sha" } }),
    });
    const result = await checkPrHeadChanged(ctx, { pullNumber: 7, lastKnownSha: "same-sha" });
    expect(result.outcome).toBe("unchanged");
  });
});

describe("checkFilesChangedSince", () => {
  const ctx = { token: "test-token", owner: "wopr-network", repo: "test-repo" };

  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 'changed' when matching files found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [
        { filename: "src/main.ts", status: "modified" },
        { filename: "docs/api.md", status: "added" },
        { filename: "README.md", status: "modified" },
      ],
    });
    const result = await checkFilesChangedSince(ctx, { pullNumber: 7, pathPatterns: "docs/,README*" });
    expect(result.outcome).toBe("changed");
    expect(result.artifacts!.changedFiles).toEqual(["docs/api.md", "README.md"]);
  });

  it("returns 'unchanged' when no matching files", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => [
        { filename: "src/main.ts", status: "modified" },
        { filename: "src/utils.ts", status: "added" },
      ],
    });
    const result = await checkFilesChangedSince(ctx, { pullNumber: 7, pathPatterns: "docs/,README*" });
    expect(result.outcome).toBe("unchanged");
  });
});
