# Cross-Session Communication — The WOPR Implementation

> Implements: [method/pipeline/triggers/cross-session.md](../../../method/pipeline/triggers/cross-session.md)

---

## WOPR's Session Model

Each Claude Code conversation is a session. Sessions have finite context windows. When a session runs out of context, a new one must reconstruct the pipeline state.

## Intra-Session Communication

Within a `/wopr:auto` session, agents communicate through Claude Code's Team messaging:

```
# Agent sends to pipeline lead
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "Spec ready: WOP-81",
  summary: "Spec posted for WOP-81"
})

# Pipeline lead sends shutdown
SendMessage({
  type: "shutdown_request",
  recipient: "architect-81",
  content: "Spec posted, shutting down"
})
```

The pipeline lead maintains state in working memory:
```
PIPELINE = [
  { issue: "WOP-81", repo: "wopr", stage: "coding", agent: "coder-81", pr: null },
  ...
]
QUEUE = [WOP-86, WOP-90, ...]
```

## Cross-Session State Recovery

When a session ends, the pipeline state is reconstructed from external systems.

### State Sources

| State | Source | Query |
|-------|--------|-------|
| Unstarted issues | Linear | `mcp__linear-server__list_issues({ team: "WOPR", state: "unstarted" })` |
| In-progress issues | Linear | `mcp__linear-server__list_issues({ team: "WOPR", state: "started" })` |
| Open PRs | GitHub | `gh pr list --repo wopr-network/<repo> --state open` |
| Merged PRs | GitHub | `gh pr list --repo wopr-network/<repo> --state merged` |
| CI status | GitHub | `gh pr checks <N> --repo wopr-network/<repo>` |
| Active worktrees | Git | `git worktree list` per repo |
| Last pipeline state | Memory | `~/.claude/projects/*/memory/MEMORY.md` |

### The MEMORY.md Handoff

Before a session ends, the pipeline lead writes state to memory:

```markdown
## WOPR Auto Pipeline — Status (2026-03-06T14:00Z) — IN PROGRESS

Team: <team-name> (ACTIVE)

### MERGED THIS SESSION:
- #42 WOP-81 session management ✅
- #43 WOP-86 telegram token security ✅

### PENDING AUTO-MERGE:
- #44 WOP-90 — CI green, auto-merge queued

### IN FLIGHT:
- architect-92: WOP-92 (wopr) — architecting

### ON RESUME:
1. Check if #44 merged. If not, investigate.
2. Clean up worktrees: 81, 86
3. TeamDelete <team-name>
4. Continue pipeline from queue
```

### Reconstruction Protocol

When `/wopr:auto` starts (or resumes):

```
1. Read MEMORY.md for last known state
2. Check Linear for in-progress issues
3. For each in-progress issue:
   a. Check GitHub for linked PR
   b. If PR exists: check state (open, merged, closed)
   c. If PR open: check CI, review status
   d. Determine current stage
4. Check for orphaned worktrees:
   git worktree list (per repo)
5. Build pipeline state table
6. Ask human: "Resume or clean up?"
```

### The /wopr:status Skill

Quick state check without full pipeline startup:

```
/wopr:status
```

Queries Linear + GitHub and reports:
- Issues by status (Todo, In Progress, Done)
- Open PRs with CI status
- Active worktrees
- Last session's handoff notes

## Session Boundary Handling

### Graceful End (Context Running Low)

1. Pipeline lead notices context is running low
2. Writes current state to MEMORY.md
3. Completes any in-flight transitions (don't leave agents mid-message)
4. `TeamDelete()`
5. Reports final status to human

### Abrupt End (Context Exhausted)

1. Session ends mid-operation
2. Next session reads MEMORY.md (may be slightly stale)
3. Queries external systems (Linear, GitHub) for ground truth
4. Reconciles MEMORY.md with reality
5. Offers human: resume or clean up

### Known Gotchas

- **Orphaned teams**: If `TeamDelete()` wasn't called, Claude Code may have stale team state. The new session creates a fresh team.
- **Orphaned worktrees**: `git worktree list` per repo finds them. Clean up with `git worktree remove` and `git worktree prune`.
- **Orphaned branches**: Branches without open PRs from previous sessions. Clean up with `git branch -D agent/coder-*`.
- **Auto-merge still queued**: A PR may have had `--auto` set in the previous session. Check `gh pr view` for `autoMergeRequest`.
