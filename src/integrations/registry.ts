import { decryptCredentials } from "./encrypt.js";
import type { IIntegrationRepository } from "./repo.js";
import type {
  IIssueTrackerAdapter,
  IntegrationCredentials,
  IVcsAdapter,
  PrimitiveOp,
  PrimitiveOpResult,
} from "./types.js";
import { opCategory } from "./types.js";

export type AnyAdapter = IIssueTrackerAdapter | IVcsAdapter;

async function buildAdapter(credentials: IntegrationCredentials): Promise<AnyAdapter> {
  switch (credentials.provider) {
    case "linear": {
      const { LinearAdapter } = await import("./adapters/linear.js");
      return new LinearAdapter(credentials);
    }
    case "jira": {
      const { JiraAdapter } = await import("./adapters/jira.js");
      return new JiraAdapter(credentials);
    }
    case "github_issues": {
      const { GitHubIssuesAdapter } = await import("./adapters/github.js");
      return new GitHubIssuesAdapter(credentials);
    }
    case "github": {
      const { GitHubVcsAdapter } = await import("./adapters/github.js");
      return new GitHubVcsAdapter(credentials);
    }
    case "gitlab": {
      const { GitLabVcsAdapter } = await import("./adapters/gitlab.js");
      return new GitLabVcsAdapter(credentials);
    }
    default:
      throw new Error(`Unknown integration provider: ${(credentials as { provider: string }).provider}`);
  }
}

/**
 * Resolves and caches adapter instances per integration ID.
 * One registry instance per engine scope.
 */
export class AdapterRegistry {
  constructor(private readonly integrationRepo: IIntegrationRepository) {}

  /**
   * Execute a primitive op using the specified integration.
   * Credentials are resolved fresh on each call so that rotated credentials
   * take effect immediately without requiring an engine restart.
   * ESM module imports are cached by the runtime, so adapter construction is cheap.
   */
  async execute(
    integrationId: string,
    op: PrimitiveOp,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PrimitiveOpResult> {
    const row = await this.integrationRepo.getById(integrationId);
    if (!row) throw new Error(`Integration not found: ${integrationId}`);
    const credentials = decryptCredentials(row.encryptedCredentials);
    const adapter = await buildAdapter(credentials);
    return callOp(adapter, op, params, signal);
  }
}

function callOp(
  adapter: AnyAdapter,
  op: PrimitiveOp,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<PrimitiveOpResult> {
  const category = opCategory(op);
  const opName = op.split(".")[1] as string;

  if (category === "issue_tracker") {
    const tracker = adapter as IIssueTrackerAdapter;
    switch (opName) {
      case "comment_exists":
        return tracker.commentExists(params as { issueId: string; pattern: string }, signal);
      case "fetch_comment":
        return tracker.fetchComment(params as { issueId: string; pattern: string }, signal);
      case "post_comment":
        return tracker.postComment(params as { issueId: string; body: string }, signal);
      case "issue_state":
        return tracker.issueState(params as { issueId: string }, signal);
      default:
        throw new Error(`Unknown issue_tracker op: ${opName}`);
    }
  }

  if (category === "vcs") {
    const vcs = adapter as IVcsAdapter;
    switch (opName) {
      case "ci_status":
        return vcs.ciStatus(params as { repo: string; prNumber: string | number }, signal);
      case "pr_status":
        return vcs.prStatus(params as { repo: string; prNumber: string | number }, signal);
      case "pr_merge_queue_status":
        return vcs.prMergeQueueStatus(params as { repo: string; prNumber: string | number }, signal);
      case "fetch_pr_diff":
        return vcs.fetchPrDiff(params as { repo: string; prNumber: string | number }, signal);
      case "fetch_pr_comments":
        return vcs.fetchPrComments(params as { repo: string; prNumber: string | number }, signal);
      case "fetch_pr_context":
        return vcs.fetchPrContext(params as { repo: string; prNumber: string | number }, signal);
      case "provision_worktree":
        return vcs.provisionWorktree(params as { repo: string; branch: string; basePath?: string }, signal);
      case "cleanup_worktree":
        return vcs.cleanupWorktree(params as { worktreePath: string }, signal);
      case "merge_pr":
        return vcs.mergePr(params as { repo: string; prNumber: string | number }, signal);
      default:
        throw new Error(`Unknown vcs op: ${opName}`);
    }
  }

  throw new Error(`Unknown op category for: ${op}`);
}
