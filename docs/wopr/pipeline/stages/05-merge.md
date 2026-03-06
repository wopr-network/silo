# Stage 5: Merge — The WOPR Implementation

> Implements: [method/pipeline/stages/05-merge.md](../../../method/pipeline/stages/05-merge.md)

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

- **wopr-plugin-types**: required check `ci` has `app_id: null` (stale check). Use `--admin` flag:
  ```bash
  gh pr merge 42 --repo wopr-network/wopr-plugin-types --squash --admin
  ```

- **wopr-plugin-msteams**: same stale `ci` check issue. Use `--admin`.

- **wopr-plugin-whatsapp**: CodeFactor removed as required check. Use normal `--auto`.

## The Watcher Agent

After queueing a PR for merge, a watcher agent polls until it resolves:

```
Task({
  subagent_type: "general-purpose",
  name: "watcher-81",
  model: "haiku",
  team_name: "wopr-auto",
  run_in_background: true,
  prompt: "Run ~/wopr-pr-watch.sh 42 wopr-network/wopr and report the result.
    If MERGED: send 'Merged: <url> for WOP-81'
    If BLOCKED: send 'BLOCKED: <url> for WOP-81 — CI failing: <checks>'
    If CLOSED: send 'CLOSED: <url> for WOP-81'"
})
```

The `wopr-pr-watch.sh` script:
- Polls `gh pr view` every 30 seconds
- Max runtime: 15 minutes
- Exits with single-line result: `MERGED`, `BLOCKED: <checks>`, `CLOSED`, or `TIMEOUT`

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

## Backpressure Gate

Before filling any pipeline slot, check open PR count:

```bash
gh pr list --repo wopr-network/<repo> --state open --json number --jq 'length'
```

If ≥ 4 open PRs → pause new work in that repo. Announce to user. Only resume when count drops below 4.

## After Merge

When the watcher reports "Merged":
1. GitHub↔Linear integration auto-moves the issue to Done
2. Refresh the blocking graph — this merge may unblock other issues
3. Clean up worktrees:
   ```bash
   cd /home/tsavo/<repo> && git worktree prune
   rm -rf /home/tsavo/worktrees/wopr-<repo>-coder-<N> 2>/dev/null
   ```
4. Fill the pipeline slot with the next unblocked issue
