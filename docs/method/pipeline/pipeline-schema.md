# Pipeline Schema

The state machine definition — how issues flow through stages, what triggers transitions, and what blocks progress.

---

## The State Machine

Every issue in the pipeline is in exactly one state at any time. Transitions between states are triggered by events and gated by conditions.

```
                 ┌─────────┐
                 │ BACKLOG │ (Todo in tracker)
                 └────┬────┘
                      │ pipeline picks up issue
                      ↓
              ┌──────────────┐
              │ ARCHITECTING │ (reasoning-tier agent)
              └──────┬───────┘
                     │ "Spec ready"
                     ↓
          ┌──────────────────┐
          │ CODING           │ (execution-tier agent, in worktree)
          └────────┬─────────┘
                   │ "PR created"
                   ↓
            ┌────────────┐
            │ REVIEWING  │ (execution-tier agent)
            └──┬─────┬───┘
               │     │
    "CLEAN"    │     │ "ISSUES"
               ↓     ↓
        ┌──────────┐  ┌─────────┐
        │ MERGING  │  │ FIXING  │
        └────┬─────┘  └────┬────┘
             │              │ "Fixes pushed"
             │              ↓
             │       ┌────────────┐
             │       │ REVIEWING  │ (re-review)
             │       └──┬─────┬───┘
             │          │     │
             │          └─────┘ (loop until CLEAN or stuck)
             │
             │ "Merged"
             ↓
        ┌──────────┐
        │   DONE   │
        └──────────┘
```

## States

| State | Agent Active | Worktree | PR Exists |
|-------|-------------|----------|-----------|
| BACKLOG | None | No | No |
| ARCHITECTING | Architect | No (reads main clone) | No |
| UI_DESIGNING | Design Architect | No (reads main clone) | No |
| CODING | Coder or Designer | Yes | No (until created) |
| REVIEWING | Reviewer | No (reads from platform) | Yes |
| FIXING | Fixer | Yes (reuses coder's) | Yes |
| MERGING | Watcher | No | Yes (in queue) |
| DONE | None | No (cleaned up) | Yes (merged) |
| STUCK | None | Varies | Yes |

## Transitions

### BACKLOG → ARCHITECTING

**Trigger**: Pipeline lead selects issue from queue
**Condition**: Issue is unblocked (all blockers have merged PRs)
**Action**: Spawn architect agent with issue assignment

### ARCHITECTING → CODING (backend)

**Trigger**: Architect sends "Spec ready: \<key\>"
**Condition**: Spec comment exists on issue
**Action**:
1. Shutdown architect
2. Create worktree from main
3. Spawn coder agent

### ARCHITECTING → UI_DESIGNING (frontend)

**Trigger**: Architect sends "Spec ready: \<key\>" AND issue is UI work
**Condition**: Technical spec exists on issue
**Action**:
1. Shutdown architect
2. Spawn design architect agent (no worktree — read-only)

### UI_DESIGNING → CODING

**Trigger**: Design architect sends "Design ready: \<key\>"
**Condition**: Both technical and design specs exist on issue
**Action**:
1. Shutdown design architect
2. Create worktree from main
3. Spawn designer agent

### CODING → REVIEWING

**Trigger**: Coder sends "PR created: \<url\> for \<key\>"
**Condition**: PR exists on code hosting platform
**Action**:
1. Shutdown coder
2. Clean up coder worktree
3. Spawn reviewer agent
4. **Fill the pipeline slot** (spawn architect for next queued issue)

### REVIEWING → MERGING (clean)

**Trigger**: Reviewer sends "CLEAN: \<url\>"
**Condition**: Reviewer has checked CI, read all bot comments, reviewed diff
**Action**:
1. Shutdown reviewer
2. Queue PR for merge (auto-merge)
3. Spawn watcher agent
4. Clean up all worktrees for this issue

### REVIEWING → FIXING (issues found)

**Trigger**: Reviewer sends "ISSUES: \<url\> — \<findings\>"
**Condition**: Findings list is non-empty
**Action**:
1. Shutdown reviewer
2. Check stuck detection (3+ cycles on same finding → escalate)
3. Spawn fixer agent with findings

### FIXING → REVIEWING (re-review)

**Trigger**: Fixer sends "Fixes pushed: \<url\>"
**Condition**: Commits pushed to PR branch
**Action**:
1. Shutdown fixer
2. Spawn reviewer agent with previous findings for comparison

### MERGING → DONE

**Trigger**: Watcher sends "Merged: \<url\>"
**Condition**: PR state is MERGED on code hosting platform
**Action**:
1. Shutdown watcher
2. Refresh blocking graph (this merge may unblock other issues)
3. Fill pipeline slots with newly unblocked issues

### REVIEWING/FIXING → STUCK

**Trigger**: Same finding flagged 3+ times on the same PR
**Condition**: Stuck counter for this finding ≥ threshold
**Action**:
1. Shutdown the current agent
2. Report to human: "This issue has a finding fixers can't resolve"
3. Remove from pipeline
4. Fill the pipeline slot

## Concurrency Model

The pipeline processes multiple issues simultaneously:

```
Slot 1: WOP-42 — REVIEWING
Slot 2: WOP-43 — CODING
Slot 3: WOP-44 — ARCHITECTING
Slot 4: WOP-45 — FIXING

Queue: WOP-46, WOP-47, WOP-48, ...
```

### Slot Rules

- **Build-phase agents** (architect, coder, designer, fixer) share a concurrency cap (e.g., max 4)
- **Review-phase agents** (reviewer, watcher) do NOT count against the cap
- When a coder finishes (PR created), the slot is released — reviewer doesn't hold it
- When a fixer is needed, it temporarily takes a slot

### Backpressure Rules

- If any repo has too many open PRs (e.g., ≥ 4), pause new work in that repo
- If the merge queue depth exceeds a threshold, pause new pipeline slots
- Resume when the bottleneck clears

## The Blocking Graph

Issues can block each other. The pipeline respects these dependencies:

```
WOP-42 (Done) ──blocks──→ WOP-43 (unblocked → Todo)
WOP-44 (In Progress) ──blocks──→ WOP-45 (blocked → wait)
```

An issue is **unblocked** when ALL of its blockers have a MERGED PR — not just a "Done" status. Status can be changed manually; a merged PR is an objective fact.

After every merge, the pipeline re-evaluates the blocking graph to find newly unblocked issues.

## Invariants

These must always be true:

1. **One agent per issue at a time** — no two agents working on the same issue simultaneously
2. **One state per issue** — an issue is never in two states
3. **Transitions are triggered by messages** — no implicit state changes
4. **Slots are bounded** — the pipeline never exceeds max concurrency
5. **Stuck detection is enforced** — no infinite review-fix loops
6. **Worktrees are cleaned up** — no orphaned worktrees after an issue is done
7. **Blocking is checked before spawn** — never start work on a blocked issue

## Anti-Patterns

- **Implicit transitions** — an issue "just moves" to the next state without an explicit trigger. Every transition must be traceable.
- **Unbounded concurrency** — spawning agents without a cap. Resources are finite. Enforce limits.
- **Missing stuck detection** — allowing infinite review-fix loops. Three cycles on the same finding = escalate.
- **Manual state changes without verification** — moving an issue to Done without a merged PR. The state machine should reflect reality.
- **Ignoring the blocking graph** — starting work on a blocked issue. The dependency exists for a reason.
