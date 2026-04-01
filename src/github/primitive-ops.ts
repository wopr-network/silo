/**
 * GitHub-native gate operations.
 * These replace the generic AdapterRegistry primitive ops with direct GitHub API calls.
 */

export interface GitHubGateContext {
  token: string;
  owner: string;
  repo: string;
}

export type GateOpResult = { outcome: string; message?: string } & Record<string, unknown>;

/** Check CI status on a commit or PR head. */
export async function checkCiStatus(ctx: GitHubGateContext, params: { ref: string }): Promise<GateOpResult> {
  const res = await fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/commits/${params.ref}/check-runs`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    return { outcome: "error", message: `GitHub API error: ${res.status}` };
  }
  const data = (await res.json()) as { check_runs: Array<{ conclusion: string | null; status: string }> };
  const runs = data.check_runs;

  if (runs.length === 0) return { outcome: "pending", message: "No check runs found" };
  const allComplete = runs.every((r) => r.status === "completed");
  if (!allComplete) return { outcome: "pending", message: "Check runs still in progress" };
  const allPassed = runs.every((r) => r.conclusion === "success" || r.conclusion === "skipped");
  return allPassed
    ? { outcome: "passed", message: "All checks passed" }
    : { outcome: "failed", message: "Some checks failed" };
}

/** Check PR merge status. Extracts PR metadata as artifacts. */
export async function checkPrStatus(ctx: GitHubGateContext, params: { pullNumber: number }): Promise<GateOpResult> {
  const res = await fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${params.pullNumber}`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    return { outcome: "error", message: `GitHub API error: ${res.status}` };
  }
  const pr = (await res.json()) as {
    merged: boolean;
    state: string;
    mergeable_state: string;
    html_url: string;
    number: number;
    head: { sha: string };
  };
  const prArtifacts = { prUrl: pr.html_url, prNumber: pr.number, headSha: pr.head.sha };
  if (pr.merged) return { outcome: "merged", artifacts: prArtifacts };
  if (pr.state === "closed") return { outcome: "closed", artifacts: prArtifacts };
  if (pr.mergeable_state === "clean") return { outcome: "mergeable", artifacts: prArtifacts };
  return { outcome: "blocked", message: `PR state: ${pr.mergeable_state}`, artifacts: prArtifacts };
}

/** Check if a comment matching a pattern exists on an issue. Extracts the last matching comment body. */
export async function checkCommentExists(
  ctx: GitHubGateContext,
  params: { issueNumber: number; pattern: string },
): Promise<GateOpResult> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/${params.issueNumber}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    return { outcome: "error", message: `GitHub API error: ${res.status}` };
  }
  const comments = (await res.json()) as Array<{ body: string }>;
  const regex = new RegExp(params.pattern);
  const match = comments.filter((c) => regex.test(c.body)).at(-1);
  return match
    ? { outcome: "exists", message: "Matching comment found", artifacts: { extractedBody: match.body } }
    : { outcome: "not_found", message: "No matching comment" };
}

/** Check if an open PR exists from a branch matching the given pattern. */
export async function checkPrForBranch(
  ctx: GitHubGateContext,
  params: { branchPattern: string },
): Promise<GateOpResult> {
  const res = await fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls?state=open&per_page=100`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    return { outcome: "error", message: `GitHub API error: ${res.status}` };
  }
  const prs = (await res.json()) as Array<{
    html_url: string;
    number: number;
    head: { ref: string; sha: string };
  }>;
  const regex = new RegExp(params.branchPattern);
  const match = prs.find((pr) => regex.test(pr.head.ref));
  return match
    ? {
        outcome: "exists",
        message: `PR #${match.number} from branch ${match.head.ref}`,
        artifacts: {
          prUrl: match.html_url,
          prNumber: match.number,
          headSha: match.head.sha,
          headBranch: match.head.ref,
        },
      }
    : { outcome: "not_found", message: "No PR found matching branch pattern" };
}

/** Check PR review status — unresolved comments mean issues remain. */
export async function checkPrReviewStatus(
  ctx: GitHubGateContext,
  params: { pullNumber: number },
): Promise<GateOpResult> {
  const [reviewsRes, commentsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${params.pullNumber}/reviews`, {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }),
    fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/${params.pullNumber}/comments?per_page=100`, {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }),
  ]);

  if (!reviewsRes.ok || !commentsRes.ok) {
    return {
      outcome: "error",
      message: `GitHub API error: reviews=${reviewsRes.status} comments=${commentsRes.status}`,
    };
  }

  const reviews = (await reviewsRes.json()) as Array<{ state: string; user: { login: string }; body: string }>;
  const comments = (await commentsRes.json()) as Array<{ user: { login: string }; body: string }>;

  const changesRequested = reviews.some((r) => r.state === "CHANGES_REQUESTED");

  const botPatterns = /qodo-code-review|coderabbitai|sourcery-ai|devin-ai/i;
  const botComments = comments.filter((c) => botPatterns.test(c.user.login));
  const hasUnresolvedBotFindings = botComments.length > 0;

  const findings = [
    ...reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => `[${r.user.login}] ${r.body}`),
    ...botComments.map((c) => `[${c.user.login}] ${c.body}`),
  ].join("\n\n---\n\n");

  if (changesRequested || hasUnresolvedBotFindings) {
    return {
      outcome: "has_issues",
      message: `PR has ${changesRequested ? "changes requested" : ""}${changesRequested && hasUnresolvedBotFindings ? " and " : ""}${hasUnresolvedBotFindings ? `${botComments.length} bot findings` : ""}`,
      artifacts: { reviewFindings: findings },
    };
  }

  return { outcome: "clean", message: "No unresolved review comments" };
}

/** Check if PR head SHA differs from a known SHA (detect new pushes). */
export async function checkPrHeadChanged(
  ctx: GitHubGateContext,
  params: { pullNumber: number; lastKnownSha: string },
): Promise<GateOpResult> {
  const res = await fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${params.pullNumber}`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    return { outcome: "error", message: `GitHub API error: ${res.status}` };
  }
  const pr = (await res.json()) as { head: { sha: string } };
  if (pr.head.sha !== params.lastKnownSha) {
    return {
      outcome: "changed",
      message: `Head SHA changed: ${params.lastKnownSha.slice(0, 7)} → ${pr.head.sha.slice(0, 7)}`,
      artifacts: { headSha: pr.head.sha },
    };
  }
  return { outcome: "unchanged", message: "Head SHA has not changed" };
}

/** Check if files matching path patterns were changed in a PR. */
export async function checkFilesChangedSince(
  ctx: GitHubGateContext,
  params: { pullNumber: number; pathPatterns: string },
): Promise<GateOpResult> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/pulls/${params.pullNumber}/files?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    return { outcome: "error", message: `GitHub API error: ${res.status}` };
  }
  const files = (await res.json()) as Array<{ filename: string; status: string }>;
  const patterns = params.pathPatterns.split(",").map((p) => p.trim());
  const matching = files.filter((f) =>
    patterns.some((pattern) => {
      if (pattern.endsWith("/")) return f.filename.startsWith(pattern);
      if (pattern.includes("*")) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
        return regex.test(f.filename);
      }
      return f.filename === pattern;
    }),
  );
  return matching.length > 0
    ? {
        outcome: "changed",
        message: `${matching.length} matching file(s) changed`,
        artifacts: { changedFiles: matching.map((f) => f.filename) },
      }
    : { outcome: "unchanged", message: "No matching files changed" };
}
