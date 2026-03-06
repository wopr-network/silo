# Getting Started with Agentic Engineering

A practical guide to adopting the methodology — what to do first, what to defer, and what order to build in.

---

## Prerequisites

Before you start, you need:

1. **A codebase** — something to apply the methodology to
2. **An AI agent platform** — any tool that can spawn AI agents (Claude Code, Cursor, Copilot Workspace, etc.)
3. **A code hosting platform** — GitHub, GitLab, Bitbucket, etc.
4. **An issue tracker** — Linear, Jira, GitHub Issues, etc.
5. **A CI system** — GitHub Actions, GitLab CI, CircleCI, etc.

You do NOT need all of these to be fancy or expensive. GitHub alone covers items 2-5 (Copilot + GitHub + Issues + Actions).

## The Build Order

Build in this order. Each step provides value on its own. Don't skip ahead.

### Week 1: Gates

Set up the minimum viable gate system:

```
1. Add a linter to your repo (ESLint, Biome, Ruff, Clippy — whatever fits your language)
2. Add a type checker (if your language supports it)
3. Add a CI pipeline that runs both on every PR
4. Ensure PRs can't merge without CI passing (branch protection)
```

**Why first**: Gates are the foundation. Everything else is optimization on top of "code is checked before it merges." Without gates, adding agents just produces unchecked code faster.

**What you get**: Every PR is automatically checked for lint errors, type errors, and (soon) test failures. No more "oops, I pushed broken code."

### Week 2: Tests

Add testing to your gate system:

```
1. Add a test runner (Vitest, Jest, Pytest, Go test)
2. Write tests for your most critical paths
3. Add the test suite to your CI pipeline
4. PRs can't merge without tests passing
```

**Why second**: Tests verify behavior, not just syntax. A linter catches unused imports. Tests catch "this function returns the wrong answer."

**What you get**: Regression prevention. Code that worked yesterday still works today.

### Week 3: Agent Rules

Create a rule file for your agents:

```
1. Create a rule file at your repo root (CLAUDE.md, .cursorrules, etc.)
2. Document your codebase conventions (naming, patterns, imports)
3. Document known gotchas (things that break if done wrong)
4. Document build/test commands specific to your repo
```

**Why third**: Agents without rules make inconsistent decisions. Rules are cheap to add and immediately improve agent output quality.

**What you get**: Agents that follow your conventions instead of inventing their own.

### Week 4: Structured Pipeline

Separate your agent workflow into stages:

```
1. Spec first, code second (even if the "spec" is just a comment on the issue)
2. Review after code (agent reviews its own PR or another agent reviews it)
3. Fix after review (don't merge with unresolved findings)
```

**Why fourth**: Separation of concerns. A spec prevents the agent from going in the wrong direction. A review catches what the coder missed.

**What you get**: A predictable pipeline: spec → code → review → merge. Each stage has a clear input and output.

### Month 2+: Advanced

Once the basics are solid, add:

```
- Review bots (Qodo, CodeRabbit, Sourcery, etc.)
- Merge queue (if you have concurrent PRs)
- Operational memory (deployment log, incident log)
- Post-deploy verification (health checks, smoke tests)
- Grooming process (adversarial backlog generation)
- Feedback loop (findings → rules → gates)
```

## The Minimum Viable Pipeline

The simplest pipeline that counts as agentic engineering:

```
Human creates issue
  ↓
Agent reads issue, writes code, creates PR
  ↓
CI runs: lint + type check + tests
  ↓ all pass
Human reviews PR (or agent reviews)
  ↓ approved
PR merges (with branch protection)
```

This is minimal but real. It has:
- A gate (CI)
- A review step (human or agent)
- A merge gate (branch protection)

Everything else — merge queues, review bots, grooming, devops — is an improvement on this foundation.

## Common Mistakes

### Starting with Agents Instead of Gates

"Let's get AI to write our code!" before you have linting, tests, or CI. The AI writes code. It might be wrong. Nothing catches it. Ship it and pray.

**Fix**: Gates first. Always.

### Skipping the Rule File

"The AI will figure it out." It won't. Without rules, agents don't know your conventions, your gotchas, or your architectural patterns. They'll use `console.log` when you use a logger. They'll put files in the wrong directory. They'll use patterns your team has explicitly rejected.

**Fix**: Write a rule file. Even a 20-line file is better than nothing.

### Over-Engineering Day One

Trying to implement the full methodology (grooming, architect, coder, reviewer, fixer, QA team, devops, feedback loop) on day one. It's too much. You'll spend weeks setting up infrastructure and never actually build anything.

**Fix**: Follow the build order. Each step provides value on its own.

### Treating AI Output as Trusted

"Claude said it's correct, so it must be." AI output is a suggestion, not a fact. Gates verify. Reviews catch what gates miss. The methodology is designed around the assumption that AI output is wrong until proven right.

**Fix**: Trust the gates, not the agent.

## Next Steps

- Read the [checklist](./checklist.md) for a concrete list of items to implement
- Read the [migration guide](./migration-guide.md) if you're moving from an existing AI workflow
- Browse the [method/](../method/) section for the full methodology
- Browse the [wopr/](../wopr/) section for a concrete reference implementation
