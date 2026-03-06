# Pipeline Schema — The WOPR Implementation

> Implements: [method/pipeline/pipeline-schema.md](../../method/pipeline/pipeline-schema.md)

---

## WOPR's State Machine

WOPR tracks pipeline state in the pipeline lead's (main Claude session's) working memory:

```
PIPELINE = [
  { issue: "WOP-81", repo: "wopr", stage: "architecting",  agent: "architect-81",  pr: null,  worktree: null },
  { issue: "WOP-86", repo: "telegram", stage: "coding",    agent: "coder-86",      pr: null,  worktree: "/home/tsavo/worktrees/wopr-telegram-coder-86" },
  { issue: "WOP-90", repo: "wopr", stage: "review",        agent: "reviewer-90",   pr: "#42", worktree: null },
  { issue: "WOP-42", repo: "platform-ui", stage: "merging", agent: "watcher-42",   pr: "#17", worktree: null },
]
QUEUE = [remaining unblocked issues sorted by priority]
STUCK = { "PR-URL": { finding: "description", count: N } }
```

## State Transitions in WOPR

### BACKLOG → ARCHITECTING

```bash
# Pipeline lead queries Linear
mcp__linear-server__list_issues({ team: "WOPR", state: "unstarted", limit: 100 })

# For each, check blocking relationships
mcp__linear-server__get_issue({ id: "<id>", includeRelations: true })

# Unblocked = all blockers have merged PRs
# Verify via: gh pr list --repo wopr-network/<repo> --state merged --head <branch>
```

Spawn:
```
Task({
  subagent_type: "wopr-architect",
  name: "architect-81",
  model: "opus",
  team_name: "wopr-auto",
  run_in_background: true,
  prompt: "<assignment>"
})
```

### ARCHITECTING → CODING

Trigger: architect sends `"Spec ready: WOP-81"`

```bash
# Create worktree
cd /home/tsavo/wopr && git fetch origin && git pull origin main
git worktree add /home/tsavo/worktrees/wopr-wopr-coder-81 -b agent/coder-81/wop-81 origin/main
cd /home/tsavo/worktrees/wopr-wopr-coder-81 && pnpm install --frozen-lockfile
```

Then spawn coder:
```
Task({
  subagent_type: "wopr-coder",
  name: "coder-81",
  model: "sonnet",
  ...
})
```

### CODING → REVIEWING

Trigger: coder sends `"PR created: https://github.com/wopr-network/wopr/pull/42 for WOP-81"`

```bash
# Clean up coder worktree
cd /home/tsavo/wopr && git worktree remove /home/tsavo/worktrees/wopr-wopr-coder-81 --force
git worktree prune
```

Spawn reviewer:
```
Task({
  subagent_type: "wopr-reviewer",
  name: "reviewer-81",
  model: "sonnet",
  ...
})
```

**Fill the slot**: spawn architect for next queued issue.

### REVIEWING → MERGING (CLEAN)

Trigger: reviewer sends `"CLEAN: https://github.com/wopr-network/wopr/pull/42"`

```bash
# For repos WITH merge queue (wopr, wopr-platform):
PR_ID=$(gh pr view 42 --repo wopr-network/wopr --json id --jq '.id')
gh api graphql -f query="mutation { enqueuePullRequest(input: { pullRequestId: \"$PR_ID\" }) { mergeQueueEntry { id } } }"

# For repos WITHOUT merge queue (wopr-plugin-*):
gh pr merge 42 --repo wopr-network/wopr-plugin-discord --squash --auto
```

Spawn watcher:
```
Task({
  subagent_type: "general-purpose",
  name: "watcher-81",
  model: "haiku",
  prompt: "Run ~/wopr-pr-watch.sh 42 wopr-network/wopr and report result"
})
```

### REVIEWING → FIXING (ISSUES)

Trigger: reviewer sends `"ISSUES: <url> — <findings>"`

Check stuck detection:
```
if STUCK[pr_url][finding].count >= 3:
  → escalate to human, remove from pipeline
```

```bash
# Reuse coder worktree (or re-create if cleaned up)
cd /home/tsavo/worktrees/wopr-wopr-coder-81 && git fetch origin && git pull origin <branch>
```

Spawn fixer:
```
Task({
  subagent_type: "wopr-fixer",
  name: "fixer-81",
  model: "sonnet",
  ...
})
```

### MERGING → DONE

Trigger: watcher sends `"Merged: <url> for WOP-81"`

```bash
# Final cleanup
cd /home/tsavo/wopr && git worktree prune
rm -rf /home/tsavo/worktrees/wopr-wopr-coder-81 2>/dev/null

# Refresh blocking graph
mcp__linear-server__list_issues({ team: "WOPR", state: "unstarted", limit: 100 })
# Check if this merge unblocked any issues
```

GitHub↔Linear integration auto-moves WOP-81 to Done.

## Agent Naming Convention

Agent names are tied to issue numbers:

| Issue | Architect | UI Architect | Coder/Designer | Reviewer | Fixer | Watcher |
|-------|-----------|-------------|----------------|----------|-------|---------|
| WOP-81 | architect-81 | — | coder-81 | reviewer-81 | fixer-81 | watcher-81 |
| WOP-462 | architect-462 | ui-architect-462 | designer-462 | reviewer-462 | fixer-462 | watcher-462 |

This makes it instantly clear which agent owns which issue.

## Worktree Naming Convention

```
/home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM>
/home/tsavo/worktrees/fix-<repo>-fixer-<ISSUE_NUM>
```

Branch naming:
```
agent/coder-<ISSUE_NUM>/<issue-key-lowercase>
```

## Merge Strategy by Repo

| Repo | Merge Queue | Strategy | Required Checks |
|------|-------------|----------|----------------|
| wopr | Yes (GitHub native) | Squash | Lint and Type Check, Build, Test |
| wopr-platform | Yes (ruleset ID 12966480) | Squash | CI checks |
| wopr-plugin-* | No | `gh pr merge --squash --auto` | Varies (some have `ci` check with null app_id → use `--admin`) |
| wopr-plugin-types | No | `gh pr merge --squash --admin` | `ci` check has null app_id |
