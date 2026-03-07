# Pipeline Lifecycle — The WOPR Implementation

> Implements: [method/pipeline/lifecycle.md](../../method/pipeline/lifecycle.md)

---

## The WOPR Pipeline

WOPR's pipeline is driven by DEFCON — a state machine engine that manages entities through the `wopr-changeset` flow. The pipeline is started by loading the seed and either running DEFCON in active mode or serving it for passive worker consumption.

### Starting DEFCON

```bash
# Load the flow definition from the seed file (idempotent)
npx defcon init --seed seeds/wopr-changeset.json

# Serve MCP (passive mode — workers call flow.claim to pull work)
npx defcon serve

# Or run autonomously (active mode — DEFCON spawns agents per state)
npx defcon run --flow wopr-changeset
```

### The Full Cycle

```
Linear issues created (backlog)
  ↓
DEFCON creates entities in "backlog" state
  ↓
Engineering worker calls flow.claim({ role: "engineering" })
  ↓
Entity advanced to "architecting" — worker receives architect prompt
  ↓
Worker reads codebase, posts spec to Linear
Worker calls flow.report({ signal: "spec_ready" })
  ↓
Gate: spec-posted (verifies spec comment in Linear)
  ↓ pass
onEnter: coding (creates worktree, populates artifacts.worktreePath, .branch)
  ↓
Entity advanced to "coding" — worker receives coder prompt
  ↓
Worker reads spec, implements in worktree, creates GitHub PR
Worker calls flow.report({ signal: "pr_created", artifacts: { prUrl, prNumber } })
  ↓
Gate: ci-green (waits for CI to pass)
  ↓ pass
Gate: review-bots-ready (waits for all bots to post)
  ↓
Entity advanced to "reviewing" — worker receives reviewer prompt
  ↓
Worker reads all bot comments + diff, renders verdict
  ↓
CLEAN: worker calls flow.report({ signal: "clean" })
ISSUES: worker calls flow.report({ signal: "issues", artifacts: { reviewFindings } })
  ↓ CLEAN path
Entity advanced to "merging" — worker receives watcher prompt
  ↓
Worker enqueues PR, polls until merged/blocked
  ↓ ISSUES path
Entity advanced to "fixing" — worker receives fixer prompt
  ↓
Worker rebases, fixes findings, pushes
  ↓ back to reviewing
  ↓
Entity advanced to "done"
```

The same worker handles all states sequentially. One claim, many reports.

---

## Concrete Tools at Each Phase

| Phase | Tool | Invocation |
|-------|------|-----------|
| Init | DEFCON CLI | `npx defcon init --seed seeds/wopr-changeset.json` |
| Architect | Codebase read | `Read`, `Grep`, `Glob` tools at `entity.artifacts.codebasePath` |
| Architect | Linear | `mcp__linear-server__save_comment()` — posts spec |
| Coding | Git worktree | Created by `onEnter` hook on coding state |
| Coding | GitHub | `gh pr create --repo {{entity.refs.github.repo}}` |
| Review | Sync gate | `~/wopr-await-reviews.sh <PR#> wopr-network/<repo>` |
| Review | GitHub API | `gh api repos/.../pulls/<N>/comments` for inline comments |
| Merge | Merge queue | `gh api graphql -f query='mutation{enqueuePullRequest(...)}'` |
| Merge | Direct merge | `gh pr merge <N> --squash --auto` (repos without merge queue) |
| Watch | PR poll | `~/wopr-pr-watch.sh <PR#> wopr-network/<repo>` |
| Deploy | Docker | Compose files in wopr-ops, `docker compose up -d` |
| Verify | Health | `curl http://localhost:<port>/health` |

---

## Session Boundaries

WOPR sessions are bounded by Claude Code's context window. When a session ends, entity state persists in DEFCON's SQLite database. On resume:

1. New session connects DEFCON MCP server
2. Calls `flow.claim({ role: "engineering" })` — receives highest-priority in-progress entity
3. Continues from current state — no reconstruction needed

MEMORY.md is still used by the pipeline lead for cross-session operational notes (which PRs are open, what's blocked, slot status), but entity state is authoritative in DEFCON, not MEMORY.md.

---

## Concurrency Configuration

Concurrency is set in the flow definition in the seed file:

```json
{
  "name": "wopr-changeset",
  "discipline": "engineering",
  "maxConcurrent": 4,
  "maxConcurrentPerRepo": 4
}
```

| Parameter | Value | Configured In |
|-----------|-------|--------------|
| Max concurrent build entities | 4 | `maxConcurrent` in seed |
| Max open entities per repo | 4 | `maxConcurrentPerRepo` in seed |
| Stuck detection threshold | 3 cycles | Gate failure tracking in DEFCON |
| Review bot timeout | 10 minutes | `timeoutMs` on `review-bots-ready` gate |
| Merge queue watch timeout | 30 minutes | `timeoutMs` on `merge-queue` gate |
