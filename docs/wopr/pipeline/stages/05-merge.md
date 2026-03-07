# Stage 5: Merge — The WOPR Implementation

> Implements: [method/pipeline/stages/05-merge.md](../../../method/pipeline/stages/05-merge.md)

---

## Gates Before Merging

When the reviewer signals `clean`, the entity transitions to `merging` — but only after the `merge-queue` gate passes. This gate is defined in `seeds/wopr-changeset.json`:

```json
{
  "name": "merge-queue",
  "type": "command",
  "command": "gates/merge-queue.sh {{entity.artifacts.prNumber}} {{entity.refs.github.repo}}",
  "timeoutMs": 1800000,
  "failurePrompt": "PR #{{entity.artifacts.prNumber}} failed in the merge queue...",
  "timeoutPrompt": "PR #{{entity.artifacts.prNumber}} has been in the merge queue for over 30 minutes..."
}
```

The gate script enqueues the PR (or auto-merges for repos without a merge queue) and polls until resolved.

---

## Merge Strategies by Repo

WOPR uses different merge mechanisms depending on the repo:

### Repos WITH Merge Queue

**wopr** (main repo) and **wopr-platform** use GitHub's native merge queue.

```bash
# Get the PR node ID
PR_ID=$(gh pr view 42 --repo wopr-network/wopr --json id --jq '.id')

# Enqueue via GraphQL
gh api graphql -f query="
  mutation {
    enqueuePullRequest(input: { pullRequestId: \"$PR_ID\" }) {
      mergeQueueEntry { id }
    }
  }
"
```

The merge queue:
1. Rebases the PR on current main
2. Re-runs ALL required CI checks (Lint and Type Check, Build, Test)
3. If all pass → squash merges to main
4. If any fail → ejects the PR, cancels auto-merge

### Repos WITHOUT Merge Queue

**wopr-plugin-*** repos use direct auto-merge:

```bash
gh pr merge 42 --repo wopr-network/wopr-plugin-discord --squash --auto
```

`--auto` means GitHub will merge when CI passes. If CI fails, the auto-merge is cancelled.

### Special Cases

- **wopr-plugin-types**: required check `ci` has `app_id: null` (stale check). Use `--admin` flag.
- **wopr-plugin-msteams**: same stale `ci` check issue. Use `--admin`.
- **wopr-plugin-whatsapp**: CodeFactor removed as required check. Use normal `--auto`.

---

## The merging State

The `merging` state in the seed has `modelTier: "haiku"` and mode `"active"`. The prompt instructs the worker to run `~/wopr-pr-watch.sh` and report the result.

In passive mode, the engineering worker receives the merging prompt via `flow.report` after the reviewer's `clean` signal advances the entity. The worker then polls the PR status and calls `flow.report` with the result.

---

## Dequeue (When Needed)

To remove a PR from the merge queue:

```bash
# Use the PR node ID (not the merge queue entry ID)
PR_ID=$(gh pr view 42 --repo wopr-network/wopr --json id --jq '.id')
gh api graphql -f query="
  mutation {
    dequeuePullRequest(input: { id: \"$PR_ID\" }) {
      mergeQueueEntry { id }
    }
  }
"
```

**Standing order**: use PR node ID for `dequeuePullRequest`, not the MQE entry ID.

---

## Backpressure Gate

Before filling any pipeline slot, check open PR count:

```bash
gh pr list --repo wopr-network/<repo> --state open --json number --jq 'length'
```

If ≥ 4 open PRs → pause new work in that repo. The `maxConcurrentPerRepo: 4` setting in the flow definition enforces this automatically in DEFCON. For passive mode, the pipeline lead checks manually.

---

## After Merge

When the entity reaches `done`:
1. GitHub↔Linear integration auto-moves the Linear issue to Done
2. The entity's `status` in DEFCON is set to `done`
3. DEFCON refreshes the blocking graph — this merge may unblock other entities
4. Worktree cleanup:
   ```bash
   cd /home/tsavo/<repo> && git worktree prune
   rm -rf {{entity.artifacts.worktreePath}} 2>/dev/null
   ```
5. Available concurrency slot fills with next claimable entity
