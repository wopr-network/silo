// ─── Integration Domain Types ───

export type IntegrationCategory = "issue_tracker" | "vcs";
export type IssueTrackerProvider = "linear" | "jira" | "github_issues";
export type VcsProvider = "github" | "gitlab";
export type IntegrationProvider = IssueTrackerProvider | VcsProvider;

export interface Integration {
  id: string;
  tenantId: string;
  name: string;
  category: IntegrationCategory;
  provider: IntegrationProvider;
  /** Decrypted credentials — never stored in plaintext. */
  credentials: IntegrationCredentials;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationCredentials = LinearCredentials | JiraCredentials | GitHubCredentials | GitLabCredentials;

export interface LinearCredentials {
  provider: "linear";
  accessToken: string;
  workspaceId?: string;
}

export interface JiraCredentials {
  provider: "jira";
  accessToken: string;
  cloudId: string;
  baseUrl: string;
}

export interface GitHubCredentials {
  provider: "github" | "github_issues";
  accessToken: string;
  installationId?: number;
}

export interface GitLabCredentials {
  provider: "gitlab";
  accessToken: string;
  baseUrl?: string; // defaults to https://gitlab.com
}

// ─── Primitive Op Result ───

/**
 * Every adapter op returns a flat record.
 * - Gates use the "outcome" key to route transitions.
 * - onEnter executors pick the keys listed in `artifacts`.
 */
export type PrimitiveOpResult = Record<string, unknown>;

// ─── Issue Tracker Adapter Interface ───

export interface IIssueTrackerAdapter {
  readonly provider: IssueTrackerProvider;

  /**
   * Check whether a comment matching `pattern` exists on the issue.
   * Returns: { outcome: "exists" | "not_found", body?: string }
   */
  commentExists(params: { issueId: string; pattern: string }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Fetch the body of the first comment matching `pattern`.
   * Returns: { body: string, commentId: string }
   */
  fetchComment(params: { issueId: string; pattern: string }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Post a comment on the issue.
   * Returns: { commentId: string }
   */
  postComment(params: { issueId: string; body: string }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Get the current state/status of the issue.
   * Returns: { outcome: string } where outcome is the state name (provider-specific).
   */
  issueState(params: { issueId: string }, signal?: AbortSignal): Promise<PrimitiveOpResult>;
}

// ─── VCS Adapter Interface ───

export interface IVcsAdapter {
  readonly provider: VcsProvider;

  /**
   * Check CI status for a PR.
   * Returns: { outcome: "passed" | "failed" | "pending" }
   */
  ciStatus(params: { repo: string; prNumber: string | number }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Check whether a PR has been merged.
   * Returns: { outcome: "merged" | "open" | "closed" }
   */
  prStatus(params: { repo: string; prNumber: string | number }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Check whether a PR is currently in the merge queue.
   * Returns: { outcome: "queued" | "not_queued" | "merged" }
   */
  prMergeQueueStatus(
    params: { repo: string; prNumber: string | number },
    signal?: AbortSignal,
  ): Promise<PrimitiveOpResult>;

  /**
   * Fetch the unified diff for a PR.
   * Returns: { diff: string }
   */
  fetchPrDiff(params: { repo: string; prNumber: string | number }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Fetch all review comments on a PR as a formatted string.
   * Returns: { comments: string }
   */
  fetchPrComments(
    params: { repo: string; prNumber: string | number },
    signal?: AbortSignal,
  ): Promise<PrimitiveOpResult>;

  /**
   * Fetch both review comments and the diff for a PR in one call.
   * Returns: { prComments: string, prDiff: string }
   */
  fetchPrContext(params: { repo: string; prNumber: string | number }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Clone/checkout a branch into a worktree. Idempotent.
   * Returns: { worktreePath: string, codebasePath: string, branch: string }
   */
  provisionWorktree(
    params: { repo: string; branch: string; basePath?: string },
    signal?: AbortSignal,
  ): Promise<PrimitiveOpResult>;

  /**
   * Remove a previously provisioned worktree. Idempotent.
   * Returns: { removed: boolean }
   */
  cleanupWorktree(params: { worktreePath: string }, signal?: AbortSignal): Promise<PrimitiveOpResult>;

  /**
   * Trigger an auto-merge (squash) and poll until the PR is merged, closed, or timed out.
   * Returns: { outcome: "merged" | "closed" | "blocked" }
   * "blocked" means the gate timed out before the PR resolved.
   */
  mergePr(params: { repo: string; prNumber: string | number }, signal?: AbortSignal): Promise<PrimitiveOpResult>;
}

// ─── Op Registry ───

/** Single source of truth for all primitive op names. */
export const PRIMITIVE_OPS = [
  "issue_tracker.comment_exists",
  "issue_tracker.fetch_comment",
  "issue_tracker.post_comment",
  "issue_tracker.issue_state",
  "vcs.ci_status",
  "vcs.pr_status",
  "vcs.pr_merge_queue_status",
  "vcs.fetch_pr_diff",
  "vcs.fetch_pr_comments",
  "vcs.fetch_pr_context",
  "vcs.provision_worktree",
  "vcs.cleanup_worktree",
  "vcs.merge_pr",
] as const;

/** All ops across all categories, namespaced. */
export type PrimitiveOp = (typeof PRIMITIVE_OPS)[number];

export function opCategory(op: PrimitiveOp): IntegrationCategory {
  const prefix = op.split(".")[0];
  if (prefix === "issue_tracker") return "issue_tracker";
  if (prefix === "vcs") return "vcs";
  throw new Error(`Unknown op namespace: ${prefix}`);
}
