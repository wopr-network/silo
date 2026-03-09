# What is Agentic Engineering — The WOPR Implementation

> Implements: [method/manifesto/what-is-agentic-engineering.md](../../method/manifesto/what-is-agentic-engineering.md)
>
> See also: [The Thesis](the-thesis.md) — why we built this and what the names mean

---

## How WOPR Implements the Method

WOPR is a multi-agent AI assistant platform built on agentic engineering principles. Every PR is gated by CI, reviewed by 4+ automated bots and an agent reviewer, and merged through a serialized queue. No code reaches production without passing deterministic checks at every stage.

## The Trust Model in Practice

WOPR uses Claude (Anthropic) as the AI backbone. The trust model is concrete:

- **Agent output**: Claude generates code, specs, reviews — all treated as untrusted until verified
- **Gate output**: Biome (lint), TypeScript (type check), Vitest (tests), GitHub Actions (CI) — deterministic, trusted
- **Review bots**: Qodo, CodeRabbit, Devin, Sourcery — automated reviewers that post findings on every PR
- **Merge queue**: GitHub's native merge queue with branch protection rules

## The Gate System

WOPR's gates, in order of execution:

```
Pre-commit:
  biome check (lint + format)
  tsc --noEmit (type check)

CI (GitHub Actions):
  biome check
  tsc --noEmit
  vitest run (full test suite)
  pnpm build (build verification)

Review:
  Qodo (code review bot — /improve suggestions)
  CodeRabbit (AI code review)
  Devin (AI code review)
  Sourcery (AI code review)
  Agent reviewer (Claude — reads all bot comments + diff)

Merge:
  GitHub merge queue (re-runs CI on integrated code)
  Required checks: Lint and Type Check, Build, Test
```

## The Agent Model

WOPR agents follow the ephemeral pattern:

| Agent | Model | Platform | Lifecycle |
|-------|-------|----------|-----------|
| Architect | Claude Opus | Claude Code (Task tool) | One issue, then shutdown |
| UI Architect | Claude Opus | Claude Code (Task tool) | One issue, then shutdown |
| Coder | Claude Sonnet | Claude Code (Task tool) | One PR, then shutdown |
| Designer | Claude Opus | Claude Code (Task tool) | One PR, then shutdown |
| Reviewer | Claude Sonnet | Claude Code (Task tool) | One review, then shutdown |
| Fixer | Claude Sonnet | Claude Code (Task tool) | One fix cycle, then shutdown |
| Watcher | Claude Haiku | Claude Code (Task tool) | One PR merge, then shutdown |

Every agent is spawned with `run_in_background: true`, receives a specific assignment, and shuts down when done.

## The Pipeline in WOPR

```
Linear issue (Todo)
  → /wopr:auto picks it up
  → Architect (opus) reads codebase, posts spec to Linear
  → Coder (sonnet) reads spec, implements in git worktree, creates GitHub PR
  → CI runs (GitHub Actions)
  → Review bots post (Qodo, CodeRabbit, Devin, Sourcery)
  → Reviewer (sonnet) waits for bots, reads all comments, renders verdict
  → If CLEAN: gh pr merge --squash --auto (or merge queue)
  → If ISSUES: Fixer (sonnet) pushes fixes, re-review
  → PR merges → Linear issue auto-moves to Done
```

## Key Tools

| Concern | Tool |
|---------|------|
| Issue tracker | Linear (team: WOPR) |
| Code hosting | GitHub (org: wopr-network) |
| CI | GitHub Actions |
| Merge queue | GitHub merge queue (repos with rulesets) |
| AI provider | Anthropic Claude (Opus, Sonnet, Haiku) |
| Agent platform | Claude Code (CLI) |
| Linter/formatter | Biome |
| Type checker | TypeScript (tsc) |
| Test runner | Vitest |
| Review bots | Qodo, CodeRabbit, Devin, Sourcery |
| Operational memory | wopr-ops git repo |
