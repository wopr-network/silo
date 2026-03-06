# Agent Definition Format

The contract for agent definition files — what every agent needs to operate.

---

## Purpose

An agent definition file is the complete specification for an agent's behavior. It tells the agent: who you are, what you do, what tools you have, what constraints you operate under, and how to report your results.

Without a definition file, an agent is just a language model with no context. The definition file turns it into a specialist.

## Required Sections

Every agent definition file must contain:

### 1. Identity

```
Name: <agent-name>
Role: <one-sentence description>
```

The name is how the agent is addressed in messages. The role is what it does. Both must be unambiguous.

### 2. Assignment

The per-invocation context. This section is templated — filled in by the orchestrating system each time the agent is spawned.

```
Issue: <issue-key> — <title>
Repo: <organization>/<repo-name>
Codebase: <local-path>
```

The assignment tells the agent exactly what to work on. An agent without an assignment is an agent that will make up its own work.

### 3. Constraints

Hard rules the agent must follow. These are non-negotiable — violating them is a bug.

Examples:
- "Read-only: do not create, edit, or write any files"
- "Work only in the assigned worktree, not the main clone"
- "Run only targeted tests, not the full suite"
- "Do not modify files outside the spec's file list"

### 4. Process

Step-by-step instructions for what the agent does. Numbered, specific, actionable.

```
1. Read the issue description
2. Study the codebase at <path>
3. Design the solution
4. Post the spec as a comment on the issue
5. Report "Spec ready: <ISSUE-KEY>"
```

The process should be followable by an agent with no prior context. If a step requires judgment ("design the solution"), the preceding steps must provide enough context for that judgment.

### 5. Tools

What the agent has access to:

- File system (read, write, or both)
- Issue tracker (read comments, post comments)
- Code hosting platform (read PRs, post reviews, run checks)
- Shell commands (build, test, lint)
- Communication (send messages to other agents or humans)

### 6. Output Contract

What the agent produces and how it reports completion:

- **Deliverable**: the concrete artifact (a spec comment, a PR, a review verdict)
- **Completion signal**: the message that tells the orchestrator the agent is done
- **Format**: the exact format of the completion signal

```
Completion signals:
  "Spec ready: <ISSUE-KEY>" — spec posted successfully
  "Can't spec: <ISSUE-KEY> — <reason>" — issue can't be specced
```

### 7. Known Gotchas

Hard-won operational knowledge. Things that go wrong and how to avoid them.

```
- The test suite OOMs in worktrees. Use `npx vitest run <file>`, not `pnpm test`.
- Some review bots take 5+ minutes. Wait for the synchronization gate.
- Never force-push to a branch with an open PR.
```

This section evolves over time as the system encounters new failure modes. It's the agent's operational memory.

## Optional Sections

### Model Routing

Which model tier this agent should use:

```
Model: reasoning (for architects, designers)
Model: execution (for coders, fixers)
Model: monitoring (for watchers, updaters)
```

### Lifecycle

How long the agent lives and when it shuts down:

```
Lifecycle: ephemeral
Shutdown: after completion signal is sent
```

All agents should be ephemeral by default. Long-lived agents accumulate state and drift.

### Team Membership

Which team the agent belongs to and how to communicate:

```
Team: <team-name>
Report to: team-lead
```

## The Ephemeral Contract

Agent definitions assume the agent is **ephemeral**:

1. **No memory** — the agent has never seen this codebase before. The definition file and assignment provide all context.
2. **No state** — the agent does not carry state from previous invocations. Each spawn is fresh.
3. **One job** — the agent does exactly one thing (spec, code, review, fix) and then shuts down.
4. **Clean shutdown** — the agent reports its result and exits. It does not idle, poll, or wait for new work.

This constraint is what makes agents reliable. A fresh agent with a clear definition produces consistent results. A long-lived agent with accumulated state drifts.

## Anti-Patterns

- **Vague constraints** — "be careful with the code" is not a constraint. "Do not modify files outside src/auth/" is a constraint.
- **Missing output contract** — if the orchestrator doesn't know what "done" looks like, it can't react to completion.
- **Assumed context** — "fix the bug we discussed" assumes the agent remembers a discussion. It doesn't. Provide the full context.
- **Kitchen-sink agent** — an agent that specs, codes, reviews, AND fixes. Split into focused agents with one job each.
- **Missing gotchas** — if the team knows "never do X," but the agent definition doesn't say so, the agent will do X.
