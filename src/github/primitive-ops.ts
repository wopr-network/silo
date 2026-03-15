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

/** Check PR merge status. */
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
  const pr = (await res.json()) as { merged: boolean; state: string; mergeable_state: string };
  if (pr.merged) return { outcome: "merged" };
  if (pr.state === "closed") return { outcome: "closed" };
  if (pr.mergeable_state === "clean") return { outcome: "mergeable" };
  return { outcome: "blocked", message: `PR state: ${pr.mergeable_state}` };
}

/** Check if a comment matching a pattern exists on an issue. */
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
  const found = comments.some((c) => regex.test(c.body));
  return found
    ? { outcome: "exists", message: "Matching comment found" }
    : { outcome: "not_found", message: "No matching comment" };
}
