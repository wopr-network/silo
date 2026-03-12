import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { GitLabCredentials, IVcsAdapter, PrimitiveOpResult } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitLabVcsAdapter implements IVcsAdapter {
  readonly provider = "gitlab" as const;
  private baseUrl: string;
  private headers: Record<string, string>;

  private readonly accessToken: string;

  constructor(credentials: GitLabCredentials) {
    this.accessToken = credentials.accessToken;
    this.baseUrl = (credentials.baseUrl ?? "https://gitlab.com").replace(/\/$/, "");
    this.headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  private encodedRepo(repo: string): string {
    return encodeURIComponent(repo);
  }

  async ciStatus({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    // Get MR to find SHA
    const mrRes = await fetch(`${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}`, {
      headers: this.headers,
    });
    if (!mrRes.ok) throw new Error(`GitLab API error ${mrRes.status} fetching MR ${repo}!${prNumber}`);
    const mr = (await mrRes.json()) as { sha: string };

    const pipelineRes = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/pipelines?sha=${mr.sha}&per_page=1`,
      { headers: this.headers },
    );
    if (!pipelineRes.ok) throw new Error(`GitLab API error ${pipelineRes.status} fetching pipelines`);
    const pipelines = (await pipelineRes.json()) as Array<{ status: string }>;

    if (pipelines.length === 0) return { outcome: "pending" };
    const status = pipelines[0]?.status ?? "pending";
    if (status === "success") return { outcome: "passed" };
    if (status === "failed" || status === "canceled") return { outcome: "failed" };
    return { outcome: "pending" };
  }

  async prStatus({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const res = await fetch(`${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GitLab API error ${res.status} fetching MR`);
    const mr = (await res.json()) as { state: string };
    if (mr.state === "merged") return { outcome: "merged" };
    if (mr.state === "opened") return { outcome: "open" };
    return { outcome: "closed" };
  }

  async prMergeQueueStatus({
    repo,
    prNumber,
  }: {
    repo: string;
    prNumber: string | number;
  }): Promise<PrimitiveOpResult> {
    const res = await fetch(`${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GitLab API error ${res.status} fetching MR`);
    const mr = (await res.json()) as { state: string; merge_when_pipeline_succeeds: boolean };
    if (mr.state === "merged") return { outcome: "merged" };
    // GitLab's equivalent of merge queue is "merge when pipeline succeeds"
    if (mr.merge_when_pipeline_succeeds) return { outcome: "queued" };
    return { outcome: "not_queued" };
  }

  async fetchPrDiff({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}/diffs?per_page=100`,
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`GitLab API error ${res.status} fetching MR diffs`);
    const diffs = (await res.json()) as Array<{ diff: string; new_path: string }>;
    const diff = diffs.map((d) => `--- ${d.new_path}\n${d.diff}`).join("\n");
    return { diff };
  }

  async fetchPrComments({ repo, prNumber }: { repo: string; prNumber: string | number }): Promise<PrimitiveOpResult> {
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}/notes?per_page=100`,
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`GitLab API error ${res.status} fetching MR notes`);
    const notes = (await res.json()) as Array<{ author: { username: string }; body: string; system: boolean }>;
    const comments = notes
      .filter((n) => !n.system)
      .map((n) => `[${n.author.username}]: ${n.body}`)
      .join("\n\n");
    return { comments };
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

    // Inject token into clone URL for private repos: https://oauth2:TOKEN@gitlab.com/...
    const cloneUrl = `${this.baseUrl.replace("://", `://oauth2:${this.accessToken}@`)}/${repo}.git`;

    try {
      await execFileAsync("git", ["-C", repoPath, "rev-parse", "--git-dir"]);
    } catch {
      await execFileAsync("git", ["clone", "--bare", cloneUrl, repoPath]);
    }

    await execFileAsync("git", ["-C", repoPath, "fetch", "origin"]);

    // Ensure worktree parent directory exists
    await mkdir(dirname(worktreePath), { recursive: true });

    try {
      await execFileAsync("git", ["-C", repoPath, "worktree", "add", worktreePath, branch]);
    } catch {
      await execFileAsync("git", ["-C", worktreePath, "rev-parse", "--git-dir"]);
    }

    return { worktreePath, codebasePath: worktreePath, branch };
  }

  async cleanupWorktree({ worktreePath }: { worktreePath: string }, _signal?: AbortSignal): Promise<PrimitiveOpResult> {
    try {
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
      await rm(worktreePath, { recursive: true, force: true });
    }
    return { removed: true };
  }

  async mergePr(
    { repo, prNumber }: { repo: string; prNumber: string | number },
    signal?: AbortSignal,
  ): Promise<PrimitiveOpResult> {
    // Enable merge when pipeline succeeds (GitLab's equivalent of auto-merge)
    const mergeRes = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}/merge`,
      {
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify({ merge_when_pipeline_succeeds: true, squash: true }),
        signal,
      },
    );
    if (mergeRes.ok) {
      // 200 means merged immediately (pipeline was already passing)
      const body = (await mergeRes.json()) as { state?: string };
      if (body.state === "merged") return { outcome: "merged" };
    } else if (mergeRes.status !== 405 && mergeRes.status !== 406) {
      throw new Error(`GitLab API error ${mergeRes.status} triggering merge`);
    }

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
      const res = await fetch(`${this.baseUrl}/api/v4/projects/${this.encodedRepo(repo)}/merge_requests/${prNumber}`, {
        headers: this.headers,
        signal,
      });
      if (!res.ok) throw new Error(`GitLab API error ${res.status} polling MR`);
      const mr = (await res.json()) as { state: string };
      if (mr.state === "merged") return { outcome: "merged" };
      if (mr.state === "closed") return { outcome: "closed" };
      const remainingMs = deadline - Date.now();
      if (signal?.aborted || remainingMs <= 0) break;
      await sleep(Math.min(30_000, remainingMs));
    }

    return { outcome: "blocked" };
  }
}
