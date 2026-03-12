import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { GitHubCredentials, IIssueTrackerAdapter, IVcsAdapter, PrimitiveOpResult } from "../types.js";

const execFileAsync = promisify(execFile);

interface GitHubCheckRun {
  conclusion: string | null;
  status: string;
}

interface GitHubPr {
  state: string;
  merged: boolean;
  number: number;
  head: { sha: string };
}

interface GitHubComment {
  id: number;
  body: string;
  user: { login: string };
  path?: string;
  line?: number;
}

export class GitHubVcsAdapter implements IVcsAdapter {
  readonly provider = "github" as const;
  private headers: Record<string, string>;
  private readonly accessToken: string;

  constructor(credentials: GitHubCredentials) {
    this.accessToken = credentials.accessToken;
    this.headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async getPr(repo: string, prNumber: string | number): Promise<GitHubPr> {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} for PR ${repo}#${prNumber}`);
    return res.json() as Promise<GitHubPr>;
  }

  async ciStatus({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const pr = await this.getPr(repo, prNumber);
    const sha = pr.head.sha;

    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching check runs`);
    const data = (await res.json()) as { check_runs: GitHubCheckRun[] };

    const runs = data.check_runs;
    if (runs.length === 0) return { outcome: "pending" };

    const allComplete = runs.every((r) => r.status === "completed");
    if (!allComplete) return { outcome: "pending" };

    const anyFailed = runs.some(
      (r) => r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== "neutral",
    );
    return { outcome: anyFailed ? "failed" : "passed" };
  }

  async prStatus({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const pr = await this.getPr(repo, prNumber);
    if (pr.merged) return { outcome: "merged" };
    return { outcome: pr.state === "open" ? "open" : "closed" };
  }

  async prMergeQueueStatus({
    repo,
    prNumber,
  }: {
    repo: string;
    prNumber: string | number;
  }): Promise<PrimitiveOpResult> {
    // Check merge queue via GraphQL
    const [owner, repoName] = repo.split("/");
    const query = `
      query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            isInMergeQueue
            merged
            state
          }
        }
      }
    `;
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { owner, repo: repoName, pr: Number(prNumber) } }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL error ${res.status}`);
    const data = (await res.json()) as {
      data?: { repository?: { pullRequest?: { isInMergeQueue: boolean; merged: boolean; state: string } } };
    };
    const pr = data.data?.repository?.pullRequest;
    if (!pr) throw new Error(`PR ${repo}#${prNumber} not found`);
    if (pr.merged) return { outcome: "merged" };
    return { outcome: pr.isInMergeQueue ? "queued" : "not_queued" };
  }

  async fetchPrDiff({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
      headers: { ...this.headers, Accept: "application/vnd.github.v3.diff" },
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching PR diff`);
    return { diff: await res.text() };
  }

  async fetchPrComments({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const [reviewRes, inlineRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`, { headers: this.headers }),
      fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/comments?per_page=100`, { headers: this.headers }),
    ]);
    if (!reviewRes.ok) throw new Error(`GitHub API error ${reviewRes.status} fetching reviews`);
    if (!inlineRes.ok) throw new Error(`GitHub API error ${inlineRes.status} fetching inline comments`);

    const reviews = (await reviewRes.json()) as Array<{ user: { login: string }; body: string; state: string }>;
    const inline = (await inlineRes.json()) as GitHubComment[];

    const parts: string[] = [];
    for (const r of reviews.filter((r) => r.body)) {
      parts.push(`[${r.user.login}] (${r.state}): ${r.body}`);
    }
    for (const c of inline) {
      const loc = c.path && c.line ? ` @ ${c.path}:${c.line}` : "";
      parts.push(`[${c.user.login}]${loc}: ${c.body}`);
    }

    return { comments: parts.join("\n\n") };
  }

  async fetchPrContext(
    params: { repo: string; prNumber: string | number },
    _signal?: AbortSignal,
  ): Promise<PrimitiveOpResult> {
    const [commentsResult, diffResult] = await Promise.all([this.fetchPrComments(params), this.fetchPrDiff(params)]);
    return { prComments: commentsResult.comments, prDiff: diffResult.diff };
  }

  async provisionWorktree({
    repo,
    branch,
    basePath = "/data/worktrees",
  }: {
    repo: string;
    branch: string;
    basePath?: string;
  }): Promise<PrimitiveOpResult> {
    const repoName = repo.replace("/", "__");
    const repoPath = `/data/repos/${repoName}`;
    const worktreePath = `${basePath}/${repoName}/${branch}`;

    // Clone if not present (use token-authenticated URL for private repos)
    try {
      await execFileAsync("git", ["-C", repoPath, "rev-parse", "--git-dir"]);
    } catch {
      const cloneUrl = `https://x-access-token:${this.accessToken}@github.com/${repo}.git`;
      await execFileAsync("git", ["clone", "--bare", cloneUrl, repoPath]);
    }

    // Fetch latest
    await execFileAsync("git", ["-C", repoPath, "fetch", "origin"]);

    // Ensure worktree parent directory exists
    await mkdir(dirname(worktreePath), { recursive: true });

    // Add or reuse worktree
    try {
      await execFileAsync("git", ["-C", repoPath, "worktree", "add", worktreePath, branch]);
    } catch {
      // Worktree may already exist — verify it's usable
      await execFileAsync("git", ["-C", worktreePath, "rev-parse", "--git-dir"]);
    }

    return { worktreePath, codebasePath: worktreePath, branch };
  }

  async cleanupWorktree({ worktreePath }: { worktreePath: string }, _signal?: AbortSignal): Promise<PrimitiveOpResult> {
    try {
      // Find the bare repo that owns this worktree
      const { stdout } = await execFileAsync("git", [
        "-C",
        worktreePath,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      const bareRepo = stdout.trim();
      await execFileAsync("git", ["-C", bareRepo, "worktree", "remove", "--force", worktreePath]);
    } catch {
      // Worktree may already be gone — remove the directory as fallback
      await rm(worktreePath, { recursive: true, force: true });
    }
    return { removed: true };
  }

  async mergePr(
    { repo, prNumber }: { repo: string; prNumber: string | number },
    signal?: AbortSignal,
  ): Promise<PrimitiveOpResult> {
    // Try direct merge (works when CI is already green)
    const mergeRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/merge`, {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ merge_method: "squash" }),
      signal,
    });

    // Direct merge succeeded — PR is already merged
    if (mergeRes.ok) return { outcome: "merged" };

    // Fail fast on unexpected errors (403, 404, 422, 500, etc.)
    if (mergeRes.status !== 405) {
      throw new Error(`Merge failed with status ${mergeRes.status}`);
    }

    // 405 = cannot merge yet (CI pending or conflicts); enable auto-merge via GraphQL
    const [owner, repoName] = repo.split("/");
    const nodeQuery = `query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $pr) { id } }
    }`;
    const nodeRes = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query: nodeQuery, variables: { owner, repo: repoName, pr: Number(prNumber) } }),
      signal,
    });
    if (!nodeRes.ok) {
      console.error(
        `[github] enablePullRequestAutoMerge: nodeRes fetch failed — status ${nodeRes.status}`,
        await nodeRes.text(),
      );
    } else {
      const nodeData = (await nodeRes.json()) as {
        data?: { repository?: { pullRequest?: { id: string } } };
      };
      const prNodeId = nodeData.data?.repository?.pullRequest?.id;
      if (!prNodeId) {
        console.error(`[github] enablePullRequestAutoMerge: PR node id not found for ${owner}/${repoName}#${prNumber}`);
      } else {
        const enableMutation = `mutation($id: ID!) {
          enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) {
            clientMutationId
          }
        }`;
        const enableRes = await fetch("https://api.github.com/graphql", {
          method: "POST",
          headers: { ...this.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ query: enableMutation, variables: { id: prNodeId } }),
          signal,
        });
        const enableBody = await enableRes.text();
        if (!enableRes.ok) {
          console.error(`[github] enablePullRequestAutoMerge mutation failed — status ${enableRes.status}`, enableBody);
        } else {
          // GitHub GraphQL always returns HTTP 200; check for application-level errors
          const enableData = JSON.parse(enableBody) as { errors?: { message: string }[] };
          if (enableData.errors?.length) {
            console.error(`[github] enablePullRequestAutoMerge mutation returned GraphQL errors`, enableData.errors);
          }
        }
      }
    }

    // Poll until merged or closed
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });

    const MAX_POLL_MS = 30 * 60 * 1000; // 30 minutes
    const deadline = Date.now() + MAX_POLL_MS;
    while (!signal?.aborted && Date.now() < deadline) {
      const pr = await this.getPr(repo, prNumber);
      if (pr.merged) return { outcome: "merged" };
      if (pr.state === "closed") return { outcome: "closed" };
      const remainingMs = deadline - Date.now();
      if (signal?.aborted || remainingMs <= 0) break;
      await sleep(Math.min(30_000, remainingMs));
    }

    return { outcome: "blocked" };
  }
}

/** GitHub Issues as an issue tracker (uses REST Issues API). */
export class GitHubIssuesAdapter implements IIssueTrackerAdapter {
  readonly provider = "github_issues" as const;
  private headers: Record<string, string>;

  constructor(credentials: GitHubCredentials) {
    this.headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async commentExists({ issueId, pattern }: { issueId: string; pattern: string }): Promise<PrimitiveOpResult> {
    // issueId format: "owner/repo#number"
    const { url } = parseIssueId(issueId);
    const res = await fetch(`${url}/comments?per_page=100`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching comments`);
    const comments = (await res.json()) as Array<{ body: string }>;
    const found = comments.some((c) => c.body.includes(pattern));
    return { outcome: found ? "exists" : "not_found" };
  }

  async fetchComment({ issueId, pattern }: { issueId: string; pattern: string }): Promise<PrimitiveOpResult> {
    const { url } = parseIssueId(issueId);
    const res = await fetch(`${url}/comments?per_page=100`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching comments`);
    const comments = (await res.json()) as Array<{ id: number; body: string }>;
    const match = comments.find((c) => c.body.includes(pattern));
    if (!match) throw new Error(`No comment matching "${pattern}" found on issue ${issueId}`);
    return { body: match.body, commentId: String(match.id) };
  }

  async postComment({ issueId, body }: { issueId: string; body: string }): Promise<PrimitiveOpResult> {
    const { url } = parseIssueId(issueId);
    const res = await fetch(`${url}/comments`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} posting comment`);
    const created = (await res.json()) as { id: number };
    return { commentId: String(created.id) };
  }

  async issueState({ issueId }: { issueId: string }): Promise<PrimitiveOpResult> {
    const { url } = parseIssueId(issueId);
    const base = url.replace(/\/comments$/, "").replace(/\/(comments)$/, "");
    const issueUrl = base.includes("/comments") ? base : `${url.split("/comments")[0]}`;
    const res = await fetch(issueUrl, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching issue state`);
    const issue = (await res.json()) as { state: string };
    return { outcome: issue.state };
  }
}

function parseIssueId(issueId: string): { url: string } {
  // Format: "owner/repo#123"
  const match = issueId.match(/^([^/]+\/[^#]+)#(\d+)$/);
  if (!match) throw new Error(`Invalid GitHub issue ID format: "${issueId}" — expected "owner/repo#number"`);
  const [, repo, number] = match as [string, string, string];
  return { url: `https://api.github.com/repos/${repo}/issues/${number}` };
}
