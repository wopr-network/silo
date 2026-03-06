/**
 * Custom gate: checks whether all Linear blockers for an entity's issue
 * have corresponding merged PRs on GitHub.
 *
 * Referenced by seed as: "gates/blocking-graph.ts:isUnblocked"
 *
 * NOTE: Function gates are not yet evaluated by the engine (gate-evaluator.ts
 * throws for type "function"). This file exists as the implementation target
 * for when function gate support lands.
 *
 * NOTE: This file is intentionally outside src/ — it is loaded dynamically at
 * runtime, not compiled by the main build.
 */

import { LinearClient } from "@linear/sdk";
import { execFileSync } from "node:child_process";
import type { Entity } from "../src/repositories/interfaces.js";

export interface BlockingGraphResult {
  passed: boolean;
  output: string;
}

/**
 * Check if all blocking issues for the given entity have merged PRs.
 *
 * Expects entity.refs.linear.id to be the Linear issue ID.
 * Uses LINEAR_API_KEY env var for authentication.
 * Uses `gh` CLI to check PR merge status on GitHub.
 */
export async function isUnblocked(entity: Entity): Promise<BlockingGraphResult> {
  const linearApiKey = process.env.LINEAR_API_KEY;
  if (!linearApiKey) {
    return { passed: false, output: "LINEAR_API_KEY not set" };
  }

  const issueId = entity.refs?.linear?.id as string | undefined;
  if (!issueId) {
    return { passed: false, output: "Entity has no linear ref" };
  }

  const client = new LinearClient({ apiKey: linearApiKey });
  let issue: Awaited<ReturnType<LinearClient["issue"]>>;
  let inverseRelations: Awaited<ReturnType<typeof issue.inverseRelations>>;
  try {
    issue = await client.issue(issueId);
    inverseRelations = await issue.inverseRelations();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, output: `Linear API error: ${message}` };
  }

  const blockers = inverseRelations.nodes.filter((r) => r.type === "blocks");

  if (blockers.length === 0) {
    return { passed: true, output: "No blockers" };
  }

  const unmerged: string[] = [];

  for (const relation of blockers) {
    const relatedIssue = await relation.relatedIssue;
    if (!relatedIssue) continue;

    const identifier = relatedIssue.identifier;

    // Resolve the PR via Linear attachment — the attachment URL tells us which repo
    const attachments = await relatedIssue.attachments();
    const prAttachment = attachments.nodes.find(
      (a) => a.url?.includes("github.com") && a.url?.includes("/pull/"),
    );
    if (!prAttachment?.url) {
      unmerged.push(`${identifier} (no PR found)`);
      continue;
    }
    const match = prAttachment.url.match(
      /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/,
    );
    if (!match) {
      unmerged.push(`${identifier} (unrecognized PR URL)`);
      continue;
    }
    const [, repo, prNum] = match;
    try {
      const state = execFileSync(
        "gh",
        ["pr", "view", prNum, "--repo", repo, "--json", "state", "--jq", ".state"],
        { encoding: "utf-8", timeout: 10000 },
      ).trim();
      if (state !== "MERGED") {
        unmerged.push(identifier);
      }
    } catch {
      unmerged.push(`${identifier} (gh check failed)`);
    }
  }

  if (unmerged.length > 0) {
    return {
      passed: false,
      output: `Blocked by unmerged: ${unmerged.join(", ")}`,
    };
  }

  return { passed: true, output: `All ${blockers.length} blockers merged` };
}
