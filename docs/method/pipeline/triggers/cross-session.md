# Cross-Session Communication

How agents talk to each other and how work survives session boundaries.

---

## The Problem

AI agents are ephemeral. A conversation ends, and all context is lost. But the pipeline's work spans hours, days, or weeks. The system needs patterns for:

1. **Agents talking to each other** within a session
2. **Work surviving** when a session ends and a new one begins
3. **State transferring** between agents that can't share memory

## Intra-Session Communication

Within a single orchestrating session, agents communicate through messages:

```
Architect → "Spec ready: WOP-42"
  ↓ (message received by pipeline lead)
Pipeline Lead → spawns Coder with assignment
  ↓
Coder → "PR created: #17 for WOP-42"
  ↓ (message received by pipeline lead)
Pipeline Lead → spawns Reviewer with PR reference
```

This works because the pipeline lead maintains state in memory. It knows what's in flight, what's queued, and what's done. The agents don't talk to each other directly — they talk to the lead, who routes.

### Message Protocol

Every agent message follows a pattern:

```
<SIGNAL>: <REFERENCE> [— <DETAILS>]

Examples:
  "Spec ready: WOP-42"
  "PR created: https://github.com/org/repo/pull/17 for WOP-42"
  "CLEAN: https://github.com/org/repo/pull/17"
  "ISSUES: https://github.com/org/repo/pull/17 — Missing null check in auth.ts:42"
  "Fixes pushed: https://github.com/org/repo/pull/17"
  "Merged: https://github.com/org/repo/pull/17 for WOP-42"
  "Can't resolve: https://github.com/org/repo/pull/17 — Rebase conflict in schema.ts"
```

The signal is a known keyword. The reference identifies the work item. The details provide context for the next agent.

## Cross-Session State

When a session ends, the pipeline lead's in-memory state is lost. The next session needs to reconstruct:

- What issues are in flight?
- What stage is each issue in?
- Which PRs are open?
- What's stuck?

### State Sources (External to the Session)

The pipeline's state is recoverable from external systems:

| State | Source |
|-------|--------|
| Issue status | Issue tracker (Todo, In Progress, Done) |
| Open PRs | Code hosting platform (open PRs per repo) |
| CI status | Code hosting platform (check status per PR) |
| Merge status | Code hosting platform (merged PRs) |
| Deploy status | Operational memory (deployment log) |
| Agent assignments | Issue tracker comments (spec posted, PR created) |

A new session can reconstruct pipeline state by querying these external systems. This is why **external state is mandatory** — it's the only thing that survives session boundaries.

### Reconstruction Protocol

When a pipeline session resumes:

```
1. Query the issue tracker for in-progress issues
2. For each in-progress issue:
   a. Check for a linked PR
   b. If PR exists: check its status (open, merged, closed)
   c. If PR open: check CI status, review status
   d. Determine current stage from the evidence
3. Query for open worktrees (leftover from previous session)
4. Build the pipeline state table
5. Present state to the human: "Here's what I found. Resume or clean up?"
```

### The Handoff Problem

When a session runs out of context and a new session starts, there's a gap. The new session has:
- The conversation summary (compressed)
- External system state (queryable)
- Operational memory (if maintained)

It does NOT have:
- Pending decisions ("I was about to escalate WOP-42")
- Unfinished analysis ("I noticed a pattern across these 3 PRs")
- Nuanced context ("the fixer tried this approach and it didn't work because...")

**Mitigation**: Before a session ends, it should persist critical context:
- Pipeline state summary
- Pending decisions
- In-flight agent status
- Known blockers

Where to persist this depends on the system: issue tracker comments, operational memory, or a dedicated state file.

## State Persistence Patterns

### Pattern 1: Issue Tracker as State Store

Every stage transition is recorded as a comment on the issue:
- Architect posts spec → state is "specced"
- Coder creates PR → state is "PR open" (PR URL in comment)
- Reviewer posts verdict → state is "reviewed"
- PR merges → state is "done"

**Advantage**: State is durable, visible, and queryable.
**Disadvantage**: Issue tracker is not a database. Complex queries are slow.

### Pattern 2: Operational Memory

A dedicated store (git repo, database, shared document) tracks pipeline state:
- Current pipeline table
- Queue of unstarted work
- Stuck detection counters
- Session handoff notes

**Advantage**: Structured, queryable, designed for this purpose.
**Disadvantage**: Another system to maintain.

### Pattern 3: Code Hosting Platform as State Store

PR status, branch existence, and CI checks encode pipeline state:
- Open PR on feature branch → issue is in review
- Merged PR → issue is done
- Branch with no PR → issue is in progress (coder hasn't finished)

**Advantage**: No extra infrastructure. The code platform already tracks this.
**Disadvantage**: Implicit encoding. Requires inference to determine state.

### Recommendation

Use all three in combination:
- Issue tracker for the **intent** (what should happen)
- Code hosting for the **reality** (what actually happened)
- Operational memory for the **context** (what was learned)

## Anti-Patterns

- **In-memory only state** — if the session dies, the state dies. Always persist to external systems.
- **Direct agent-to-agent communication** — agents should communicate through the lead or the event bus, not peer-to-peer. Peer-to-peer creates hidden dependencies.
- **Unstructured messages** — "hey I finished the thing" is not parseable. Use the message protocol with known signals.
- **No reconstruction protocol** — starting a new session and asking "where were we?" without a systematic way to find out.
- **Over-persisting** — saving every agent thought to a file. Persist decisions and state transitions, not reasoning traces.
