# Stage 5: Merge

Serialized integration — how approved PRs become part of the main branch.

---

## Purpose

The merge stage ensures that approved code integrates cleanly with all other concurrent work. Individual PRs pass CI in isolation, but multiple PRs merged simultaneously can conflict. The merge stage serializes this.

## The Merge Queue

A merge queue is a serialization primitive. It takes approved PRs and merges them one at a time (or in small batches), re-running CI on the integrated result before the merge commits to the main branch.

```
PR-1 approved ──┐
PR-2 approved ──┼──→ [ Merge Queue ] ──→ main
PR-3 approved ──┘         │
                          ├── Take PR-1
                          ├── Rebase on main
                          ├── Run CI
                          ├── If pass → merge to main
                          ├── If fail → eject PR-1, notify
                          ├── Take PR-2
                          ├── Rebase on (new) main
                          └── ...
```

**Why a queue, not just "merge when green"?**

- PR-1 adds function `processOrder(order)`. PR-2 calls `processOrder(order, options)` with an extra parameter. Both pass CI independently. Merged together, PR-2 breaks because the function signature doesn't match.
- The merge queue catches this by running CI on the integrated state, not just the individual PR state.

## Queue vs Direct Merge

Not every project needs a merge queue. The decision depends on concurrency:

| Scenario | Merge Strategy | Why |
|----------|---------------|-----|
| Solo developer, sequential PRs | Direct merge after approval | No concurrent PRs means no integration conflicts |
| Small team, 1-2 PRs/day | Direct merge with branch protection | Low concurrency, conflicts are rare |
| Multiple agents, 3+ concurrent PRs | Merge queue required | High concurrency makes integration conflicts likely |
| Monorepo with many contributors | Merge queue required | Even higher concurrency risk |

For agentic engineering with multiple concurrent agents, a merge queue is almost always necessary.

## The Merge Process

```
1. PR receives approval
   - From the agent reviewer (CLEAN verdict)
   - Or from a human reviewer

2. PR enters the merge queue
   - Automatically (if configured) or manually triggered
   - The queue position is determined by entry order

3. Queue processes the PR
   - Rebases on current main
   - Runs ALL CI checks on the rebased code
   - If all checks pass → merge commits to main
   - If any check fails → eject the PR from the queue

4. On successful merge:
   - The feature branch is deleted
   - The issue tracker is updated (if integrated)
   - Downstream systems are notified (deploy triggers, etc.)

5. On queue ejection:
   - The PR is NOT merged
   - The failure reason is reported
   - The PR re-enters the fix stage
```

## Merge Strategies

| Strategy | Result | When to Use |
|----------|--------|-------------|
| Squash | All PR commits become one commit on main | Default for feature work — clean history |
| Merge commit | Preserves full PR history | When individual commits matter (large features) |
| Rebase | Linear history, no merge commits | When you want a flat commit log |

For agentic engineering, **squash** is usually best. Agent-generated commits are implementation details. The meaningful unit is the PR, not the individual commits within it.

## Backpressure

When the merge queue grows too large, it signals that the system is producing PRs faster than it can integrate them. This is a **backpressure signal**:

- **Symptom**: Queue depth > threshold (e.g., 4+ PRs waiting)
- **Cause**: Too many concurrent agents, or CI is too slow
- **Response**: Pause new work until the queue drains. Do not keep feeding PRs into a saturated queue.

Backpressure is healthy. It's the system telling you to slow down. Ignoring it leads to cascading CI failures as each ejected PR re-enters the queue.

## Gate

The merge stage is complete when:

- The PR has been merged to main (merge queue confirms integration)
- The feature branch has been deleted
- The merge event has been recorded

## Anti-Patterns

- **Merging without a queue at high concurrency** — individual CI passes don't guarantee integrated CI passes. The queue catches what per-PR CI misses.
- **Force-merging past failed checks** — if CI fails in the queue, the code isn't ready. Eject and fix.
- **Ignoring backpressure** — a growing queue means the system is overloaded. Pause new work.
- **Keeping feature branches after merge** — dead branches clutter the repo and confuse agents that enumerate branches.
