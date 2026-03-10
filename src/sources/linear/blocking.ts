import type { BlockingCheckResult, LinearRelation } from "./types.js";

const RESOLVED_STATES = new Set(["completed", "canceled"]);

export function checkBlocking(relations: LinearRelation[]): BlockingCheckResult {
  const blockers = relations
    .filter((r) => r.type === "blocked_by" && !RESOLVED_STATES.has(r.relatedIssue?.state?.type))
    .map((r) => r.relatedIssue);

  return { unblocked: blockers.length === 0, blockers };
}
