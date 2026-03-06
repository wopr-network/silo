# Issue Tracker Workflow

The state machine that issues follow — from creation to completion.

---

## Purpose

The issue tracker is the single source of truth for "what work exists and what state it's in." Every issue has a status. Every status transition has a trigger. The system is a state machine.

## The State Machine

```
                    ┌──────────┐
                    │  Triage  │
                    └────┬─────┘
                         │ groomer creates issue
                         ↓
                    ┌──────────┐
                    │   Todo   │
                    └────┬─────┘
                         │ architect picks it up
                         ↓
                ┌─────────────────┐
                │  In Progress    │
                └────┬──────┬─────┘
                     │      │
          PR merged  │      │ stuck / blocked
                     ↓      ↓
              ┌──────────┐  ┌──────────┐
              │   Done   │  │ Blocked  │
              └──────────┘  └────┬─────┘
                                 │ blocker resolved
                                 ↓
                            ┌──────────┐
                            │   Todo   │ (re-enters queue)
                            └──────────┘
```

## States

### Triage

The issue exists but hasn't been prioritized or validated. Raw input from users, automated scans, or ad-hoc ideas land here.

**Entry**: issue created without going through grooming
**Exit**: groomer validates and moves to Todo, or rejects (closed)

### Todo (Backlog)

The issue is validated, prioritized, and ready for work. It's in the queue waiting for a pipeline slot.

**Entry**: groomer approves and creates, or blocked issue becomes unblocked
**Exit**: pipeline picks it up (moves to In Progress)

### In Progress

An agent is actively working on this issue. It's in one of the pipeline stages: architecting, coding, reviewing, or fixing.

**Entry**: architect spawns for this issue
**Exit**: PR merges (Done) or issue gets stuck (Blocked)

### Done

The issue's PR has been merged to main. The work is complete.

**Entry**: PR merged
**Exit**: none (terminal state)

### Blocked

The issue can't proceed because it depends on another issue that isn't done yet.

**Entry**: dependency analysis shows unresolved blockers
**Exit**: all blockers resolve (moves back to Todo)

### Cancelled

The issue was created but is no longer needed (duplicate, obsolete, or rejected after further analysis).

**Entry**: groomer or human cancels
**Exit**: none (terminal state)

## Status Transitions

| From | To | Trigger | Who |
|------|----|---------|-----|
| Triage | Todo | Groomer validates | Groomer agent |
| Triage | Cancelled | Groomer rejects | Groomer agent |
| Todo | In Progress | Architect spawns | Pipeline lead |
| In Progress | Done | PR merges | Automated (code hosting integration) |
| In Progress | Blocked | Dependency discovered | Pipeline lead |
| Blocked | Todo | All blockers resolved | Pipeline lead |
| Any | Cancelled | Human cancels | Human |

## Blocking Relationships

Issues can block each other:

```
WOP-42 blocks WOP-43
  → WOP-43 is Blocked until WOP-42 is Done
  → When WOP-42's PR merges, WOP-43 moves from Blocked → Todo
```

### Blocking Rules

1. **Both directions must be wired**: If A blocks B, both A's "blocks" and B's "blocked by" must be set. Missing one direction means the system can't detect when B becomes unblocked.

2. **Done means MERGED, not just status**: An issue is only truly done when its PR has merged. An issue moved to Done manually (without a merged PR) should NOT unblock dependents.

3. **Circular blocks are bugs**: If A blocks B and B blocks A, something is wrong. Detect and break cycles.

## Priority

Issues are sorted by priority in the backlog:

| Level | Meaning | Pipeline Behavior |
|-------|---------|------------------|
| Urgent | Production issue, security vulnerability | Processes immediately, preempts other work |
| High | Important feature, significant bug | Processes in priority order |
| Normal | Standard work | Processes after urgent and high |
| Low | Nice-to-have, minor improvements | Processes when nothing higher exists |

Priority is set during grooming and can be adjusted by humans. Agents do not change priority — they process the queue in priority order.

## Labels

Labels categorize issues without affecting priority or workflow:

- **By type**: bug, feature, improvement, tech-debt, security
- **By area**: frontend, backend, infrastructure, testing
- **By repo**: one label per repo in the organization

Labels help with filtering and reporting. They don't affect the state machine.

## Issue Description Contract

Every issue description must contain enough information for an agent to act on it:

```
Required:
  - Repository identification (which repo this work belongs to)
  - Description of what needs to be done
  - Acceptance criteria (how to know it's done)

Optional:
  - File references (paths to relevant code)
  - Related issues (links to context)
  - Design direction (for UI work)
```

An issue with only a title ("fix the login bug") is not actionable. An issue with a description, file references, and acceptance criteria is.

## Integration with the Pipeline

The issue tracker integrates with the pipeline at these points:

1. **Grooming**: creates issues in the tracker
2. **Pipeline start**: queries the tracker for unstarted issues
3. **Architecture**: reads the issue description, posts the spec as a comment
4. **Coding**: reads the spec from issue comments, links the PR to the issue
5. **Merge**: automated integration moves the issue to Done when the PR merges
6. **Blocking**: pipeline queries blocking relationships to determine which issues are unblocked

The tracker is not just a list — it's the pipeline's work queue, dependency graph, and audit trail.

## Anti-Patterns

- **Issues without descriptions** — a title is not enough context for an ephemeral agent.
- **Manual status updates** — moving issues to Done manually instead of letting the code hosting integration handle it. Manual moves bypass verification.
- **Triage as permanent state** — issues that sit in Triage forever. Triage is a holding pen, not a backlog.
- **No blocking relationships** — all issues treated as independent. Dependencies exist — wire them.
- **Priority by gut feel** — "this feels important." Use the grooming process with evidence and skeptic challenge.
- **Too many statuses** — Todo, In Progress, Review, QA, Staging, Done, Deployed, Verified. Keep it simple. The pipeline stages handle substates.
