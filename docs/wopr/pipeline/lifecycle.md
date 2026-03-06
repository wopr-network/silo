# Pipeline Lifecycle — The WOPR Implementation

> Implements: [method/pipeline/lifecycle.md](../../method/pipeline/lifecycle.md)

---

## The WOPR Pipeline

WOPR's pipeline is invoked via skills — slash commands in Claude Code sessions:

```
/wopr:groom → Adversarial backlog grooming (3 advocates + 1 skeptic)
/wopr:auto  → Continuous pipeline (architect → code → review → fix → merge)
/wopr:devops → Operational actions (deploy, rollback, migrate, health)
/wopr:audit → 5-agent repo audit (correctness, completeness, practices, tests, security)
```

### The Full Cycle

```
Human runs /wopr:groom
  ↓
Advocates scan repos, propose issues → Skeptic challenges → Lead creates Linear issues
  ↓
Human runs /wopr:auto
  ↓
Pipeline fetches backlog from Linear
  ↓
For each unblocked issue (up to 4 concurrent):
  ↓
Architect (opus) → reads codebase, posts spec to Linear
  ↓
Coder (sonnet) → reads spec, works in git worktree, creates GitHub PR
  ↓
CI runs (GitHub Actions: lint, type check, build, test)
  ↓
Review bots post (wopr-await-reviews.sh blocks until all 4 have posted)
  ↓
Reviewer (sonnet) → reads all comments, reviews diff, renders verdict
  ↓
CLEAN → gh pr merge --squash --auto (or merge queue GraphQL mutation)
ISSUES → Fixer (sonnet) → pushes fixes → re-review
  ↓
Watcher (haiku) → polls until PR merges or is ejected
  ↓
Merged → refresh blocking graph → fill pipeline slot → next issue
```

## Concrete Tools at Each Phase

| Phase | Tool | Invocation |
|-------|------|-----------|
| Groom | Linear API | `mcp__linear-server__save_issue()`, `mcp__linear-server__list_issues()` |
| Architect | Codebase read | `Read`, `Grep`, `Glob` tools at `/home/tsavo/<repo>` |
| Architect | Linear | `mcp__linear-server__save_comment()` — posts spec |
| Code | Git worktree | `git worktree add /home/tsavo/worktrees/wopr-<repo>-coder-<N>` |
| Code | Package install | `pnpm install --frozen-lockfile` |
| Code | GitHub | `gh pr create --repo wopr-network/<repo>` |
| Review | Sync gate | `~/wopr-await-reviews.sh <PR#> wopr-network/<repo>` |
| Review | GitHub API | `gh api repos/.../pulls/<N>/comments` for inline comments |
| Merge | Merge queue | `gh api graphql -f query='mutation{enqueuePullRequest(...)}'` |
| Merge | Direct merge | `gh pr merge <N> --squash --auto` (repos without merge queue) |
| Watch | PR poll | `~/wopr-pr-watch.sh <PR#> wopr-network/<repo>` |
| Deploy | Docker | Compose files in wopr-ops, `docker compose up -d` |
| Verify | Health | `curl http://localhost:<port>/health` |

## Session Boundaries

WOPR sessions are bounded by Claude Code's context window. When a session runs out of context:

1. The session summary captures pipeline state
2. External state persists in Linear (issue status) and GitHub (PR status)
3. `~/.claude/projects/*/memory/MEMORY.md` records in-flight work
4. New session runs `/wopr:status` to reconstruct state from Linear + GitHub

### The MEMORY.md Handoff

```
## WOPR Auto Pipeline — Status (2026-03-06T14:00Z) — IN PROGRESS

Team: <team-name> (ACTIVE)

### MERGED THIS SESSION:
- #42 WOP-81 session management ✅
- #43 WOP-86 telegram token security ✅

### IN FLIGHT:
- architect-90: WOP-90 (wopr) — architecting
- reviewer-42: WOP-42 PR #42 — reviewing

### ON RESUME:
1. Check if any in-flight agents completed
2. Clean up worktrees: 81, 86
3. Continue pipeline from queue
```

This handoff note is written before the session ends and read when the next session starts.

## Concurrency Configuration

| Parameter | Value | Configured In |
|-----------|-------|--------------|
| Max concurrent build agents | 4 | `/wopr:auto max=4` argument |
| Max open PRs per repo | 4 | Standing order in MEMORY.md |
| Stuck detection threshold | 3 cycles | Hardcoded in `/wopr:auto` skill |
| Review bot timeout | 10 minutes | `~/wopr-await-reviews.sh` |
| Merge queue watch timeout | 15 minutes | `~/wopr-pr-watch.sh` |
