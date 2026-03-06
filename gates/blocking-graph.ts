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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Entity } from "../src/repositories/interfaces.js";

const execFileAsync = promisify(execFile);

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
  const issue = await client.issue(issueId);
  const relations = await issue.relations();

  const blockers = relations.nodes.filter(
    (r) => r.type === "is-blocked-by",
  );

  if (blockers.length === 0) {
    return { passed: true, output: "No blockers" };
  }

  const unmerged: string[] = [];

  for (const relation of blockers) {
    const relatedIssue = await relation.relatedIssue;
    if (!relatedIssue) continue;

    const identifier = relatedIssue.identifier;

    // Check if this blocker has a merged PR by searching GitHub
    // Convention: PR branches contain the issue key lowercase
    const key = identifier.toLowerCase();
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "list", "--state", "merged", "--search", key, "--json", "number", "--jq", "length"],
        { encoding: "utf-8", timeout: 10000 },
      );
      const result = stdout.trim();

      if (result === "0" || result === "") {
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
