import type { Entity, Flow } from "../repositories/interfaces.js";

/**
 * GitHub-native primitive ops for gate evaluation.
 * Replaces the generic adapter registry with direct GitHub API calls.
 */

export interface PrimitiveOpResult {
  passed: boolean;
  output: string;
  outcome?: string;
}

/**
 * Execute a primitive op against the GitHub API.
 * The entity's artifacts must contain: repoFullName, installationId.
 * Gate-specific artifacts: prNumber, issueNumber, etc.
 */
export async function executeGitHubPrimitiveOp(
  op: string,
  params: Record<string, unknown>,
  entity: Entity,
  _flow: Flow,
  githubToken: string,
): Promise<PrimitiveOpResult> {
  const repoFullName = (entity.artifacts?.repoFullName ?? params.repo) as string;
  if (!repoFullName) {
    return { passed: false, output: "Missing repoFullName in entity artifacts" };
  }

  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  switch (op) {
    case "vcs.ci_status": {
      const ref = (params.ref ?? entity.artifacts?.headSha ?? "HEAD") as string;
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/commits/${ref}/check-runs`, { headers });
      if (!res.ok) return { passed: false, output: `GitHub API error: ${res.status}` };
      const data = (await res.json()) as { check_runs: { conclusion: string | null; status: string }[] };
      const allComplete = data.check_runs.every((r) => r.status === "completed");
      const allPassed = data.check_runs.every((r) => r.conclusion === "success");
      if (!allComplete) return { passed: false, output: "CI still running", outcome: "pending" };
      return { passed: allPassed, output: allPassed ? "All checks passed" : "Some checks failed" };
    }

    case "vcs.pr_status": {
      const prNumber = (params.pr_number ?? entity.artifacts?.prNumber ?? entity.artifacts?._currentPrNumber) as string;
      if (!prNumber) return { passed: false, output: "Missing prNumber" };
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, { headers });
      if (!res.ok) return { passed: false, output: `GitHub API error: ${res.status}` };
      const pr = (await res.json()) as { state: string; merged: boolean; mergeable: boolean | null };
      if (pr.merged) return { passed: true, output: "PR merged", outcome: "merged" };
      if (pr.state === "closed") return { passed: false, output: "PR closed without merge", outcome: "closed" };
      return { passed: pr.mergeable === true, output: `PR open, mergeable: ${pr.mergeable}` };
    }

    case "vcs.pr_merge_queue_status": {
      const prNumber = (params.pr_number ?? entity.artifacts?.prNumber ?? entity.artifacts?._currentPrNumber) as string;
      if (!prNumber) return { passed: false, output: "Missing prNumber" };
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, { headers });
      if (!res.ok) return { passed: false, output: `GitHub API error: ${res.status}` };
      const pr = (await res.json()) as { merged: boolean; merge_state_status?: string };
      if (pr.merged) return { passed: true, output: "PR merged" };
      return { passed: false, output: `merge_state_status: ${pr.merge_state_status ?? "unknown"}` };
    }

    case "issue_tracker.comment_exists": {
      const issueNumber = (params.issue_number ?? entity.artifacts?.issueNumber) as number;
      const pattern = params.pattern as string | undefined;
      if (!issueNumber) return { passed: false, output: "Missing issueNumber" };
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`, {
        headers,
      });
      if (!res.ok) return { passed: false, output: `GitHub API error: ${res.status}` };
      const comments = (await res.json()) as { body: string }[];
      if (pattern) {
        const found = comments.some((c) => c.body.includes(pattern));
        return { passed: found, output: found ? "Matching comment found" : "No matching comment" };
      }
      return { passed: comments.length > 0, output: `${comments.length} comments` };
    }

    case "issue_tracker.post_comment": {
      const issueNumber = (params.issue_number ?? entity.artifacts?.issueNumber) as number;
      const body = params.body as string;
      if (!issueNumber || !body) return { passed: false, output: "Missing issueNumber or body" };
      const res = await fetch(`https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      return { passed: res.ok, output: res.ok ? "Comment posted" : `GitHub API error: ${res.status}` };
    }

    default:
      return { passed: false, output: `Unknown primitive op: ${op}` };
  }
}
