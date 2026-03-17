# .holyship/ Directory Architecture

**Date:** 2026-03-17
**Status:** Approved

## The Three Files

Every Holy Ship repo gets a `.holyship/` directory with three files:

```
.holyship/
  flow.yaml      — the pipeline
  knowledge.md   — what we know
  ship.log       — what happened
```

### flow.yaml — The Pipeline

Declarative flow definition. States, gates, transitions. Says WHAT the pipeline does, not HOW. No prompt templates — those live in Holy Ship's database.

```yaml
states:
  - name: spec
    agentRole: architect
    modelTier: opus
  - name: code
    agentRole: coder
    modelTier: sonnet
```

The flow engine reads this file. It looks up the prompt template for `architect` from the DB, hydrates it with repo knowledge from `knowledge.md`, entity context, and RepoConfig, then dispatches to the runner.

**Created by:** AI during onboarding (interrogation → flow design).
**Modified by:** Humans (conversational editor) or agents (learning step, last commit in a PR).
**Format:** YAML. Git-diffable. Versioned by git.

### knowledge.md — What We Know

The codebase map. Conventions, gotchas, CI gate commands, architecture notes, fragile areas. What an engineer needs to know before touching this repo.

**Created by:** AI during onboarding (interrogation bootstraps it).
**Modified by:** Agents during the learning step. Humans can edit directly.
**Format:** Markdown. Human-readable. Reviewed in PRs like any other file.

Replaces CLAUDE.md as the repo intelligence file. But unlike CLAUDE.md, it's maintained by the system — agents update it as they learn.

**Migration from CLAUDE.md:** For existing repos with CLAUDE.md, the interrogation reads it as input and folds its contents into the bootstrapped knowledge.md. The original CLAUDE.md is left in place — Holy Ship reads from `.holyship/knowledge.md` only. Customers can remove CLAUDE.md at their discretion or keep it for tools that expect it.

### ship.log — What Happened

Append-only history. Every entity that ships adds an entry. What went wrong. What was surprising. What the next agent should know.

```
## 2026-03-16 — PR #47 (feat: add auth middleware)

- Auth module tests are order-dependent. Run tests/auth/ before tests/api/.
- CI took 12 minutes because e2e tests hit the real Stripe sandbox.

## 2026-03-17 — PR #48 (fix: rate limiter crash)

- x-forwarded-for can be undefined in local dev. Always fallback to req.ip.
```

**Created by:** First entity that ships.
**Modified by:** Agents only. Append-only — never edit, never delete.
**Format:** Markdown. Immutable log. The ship's log.

## What Lives Where

### In the repo (customer owns)

| File | Purpose | Who writes | Mutable? |
|------|---------|------------|----------|
| `.holyship/flow.yaml` | Pipeline definition | AI + humans | Yes (via PRs) |
| `.holyship/knowledge.md` | Codebase intelligence | AI + humans | Yes (via PRs) |
| `.holyship/ship.log` | Execution history | Agents only | Append-only |

Customer leaves → they take all three. They have their pipeline, their knowledge, their history.

### In the database (Holy Ship owns)

| Data | Purpose | Why it's ours |
|------|---------|---------------|
| **Prompt templates** | The actual prompts behind each agentRole | The intelligence that makes flows work. Improved centrally, benefits all customers instantly. |
| **RepoConfig** | Structured interrogation output | Drives prompt hydration and flow adaptation. |
| **Cross-repo learning** | Patterns across all repos | Fleet intelligence. "TypeScript + vitest repos fail on import ordering after new files." |
| **Metrics** | Cost, timing, failure rates per state | Drives model selection, timeout tuning, prompt optimization. |

### Prompt Hydration

The flow says `agentRole: architect`. The DB has the architect prompt template. At runtime:

1. Read `flow.yaml` from repo → state says `agentRole: architect`
2. Look up `architect` prompt template from DB
3. Read `knowledge.md` from repo → inject conventions, CI gate, gotchas
4. Read `ship.log` from repo → inject recent learnings relevant to this entity (last N entries by recency, capped at ~2K tokens to avoid filling context window; relevance filtering deferred to implementation)
5. Add RepoConfig from DB → inject capabilities, language, tools
6. Add entity context → issue number, PR number, branch
7. Dispatch hydrated prompt to runner

The customer controls the graph (flow.yaml). Holy Ship controls the intelligence (prompt templates). The knowledge (knowledge.md + ship.log) feeds both sides.

One prompt template. A thousand different prompts. Each one tuned to the repo it's running in. And when we improve a template, every customer benefits instantly — no repo changes, no PRs, no migration.

## The Business Model Separation

The flow is theirs. The knowledge is theirs. The history is theirs. No lock-in.

The prompt templates are ours. The cross-repo learning is ours. The fleet intelligence is ours. That's what the subscription pays for.

We earn it every month by being better than what you could do yourself with the same three files.

## Implicit Learning

Learning is not a flow state. It's implicit — every agent learns after every step.

When an agent signals done (spec_ready, pr_created, merged, etc.), before the container tears down, it gets one more prompt: "What did you learn?" Same session. Same context. Everything the agent encountered is still in memory — every file it read, every test that failed, every quirk it hit.

The agent:
1. Updates `.holyship/knowledge.md` if it discovered something about the codebase
2. Appends to `.holyship/ship.log` what happened during this step
3. These are the last commit(s) in the PR

Then the container tears down.

This requires **session persistence** in the OpenCode SDK — the learning prompt reuses the agent's existing session so it has full context. The session ID is passed from the work dispatch to the learning dispatch. This is trivial (the SDK already supports `resume: sessionId`) but must be wired into the runner lifecycle: work prompt → signal → learning prompt → teardown.

Every agent learns. Architect, coder, reviewer, fixer. Not because they're in a "learning state" — because learning is what Holy Ship does.
