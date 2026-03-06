# DEFCON

You're a developer. You've been there.

You gave the AI a task. It came back fast — faster than you expected. The code looks right. The tests pass. You feel good. You merge it. You deploy. And then your phone buzzes at 2am because the thing the AI wrote handles the happy path perfectly and falls apart the moment a real user touches it.

Or you're running a team. You've got eight AI agents writing code in parallel and you're shipping faster than you ever have. The board is thrilled. The velocity charts are beautiful. And then one of those agents merges a change that breaks authentication in production. Not because it was malicious. Not because the model was bad. Because the pipeline between "code written" and "code in production" was a prompt that said *please be careful*. And the agent was careful — until it wasn't.

Or you're a Fortune 500 CTO. You've invested millions in AI-assisted development. The pitch was "10x productivity." And it delivered — until the first time an AI agent deployed untested code to your payment processing system and you spent the next 72 hours in an incident room explaining to regulators what happened. The AI did exactly what you asked. The problem was that nobody verified it did it *correctly* before it went live.

This is the problem with vibe coding. Not that the AI can't do the work. It can. The problem is what happens between "the work is done" and "the work is in production." That space is where software goes wrong. And right now, for most teams, that space is filled with hope.

**Hope is not a gate.**

---

In WarGames, WOPR escalated to launch because nothing in the system had the ability to say *not yet*. DEFCON 5. 4. 3. 2. 1. Each level a step closer, each step unchallenged. The system had no mechanism for doubt — only momentum.

AI pipelines have the same problem. They have momentum. What they lack is earned escalation — the structural requirement that each step *prove* it's ready before the next one begins.

**DEFCON is that structure.**

Each level in the pipeline is a question: *are we ready to go further?* Not asked in a prompt. Not left to the agent's judgment. Answered by a deterministic gate — a check that runs, passes or fails, and cannot be skipped. The pipeline doesn't move forward on confidence. It moves forward on evidence.

You don't get to DEFCON 3 without passing DEFCON 4. You don't get to DEFCON 2 without passing DEFCON 3. Each gate builds on the last. The system accumulates certainty the way the real DEFCON system accumulates readiness — one verified level at a time, until the answer to *are we sure?* isn't a feeling. It's a fact.

That's when you ship. Not before.

## The Engine

For a long time, the WOPR pipeline ran on `/wopr:auto` — a ~500-line skill prompt that hand-coded every state transition as an if-statement. "Spec ready" → spawn coder. "CLEAN" → merge. "ISSUES" → spawn fixer. Every new workflow type needed another hand-coded skill. The orchestration logic was frozen in prompts that agents couldn't modify at runtime.

DEFCON replaces that with a configurable state machine runtime. Define your escalation path once. The engine enforces it forever.

A **flow** is a state machine for any type of work. Entities (issues, deployments, incidents) enter a flow and move through states. At each state an agent does work. At each boundary a deterministic gate verifies the output. Transitions fire on signals — not parsed natural language, not regex, but typed strings agents emit via MCP tool call. The entire definition lives in a database. Agents can mutate it at runtime via the admin API. The pipeline's self-improvement loop becomes a literal API call.

```
/wopr:auto (before)          DEFCON (after)
────────────────────         ──────────────────────────────────
500-line skill prompt    →   JSON seed file
if-statement routing     →   signal → transition → gate → state
hand-coded CI check      →   shell gate: npm test
manual agent spawning    →   invocation lifecycle per state
message parsing          →   flow.report({ signal: "pr.created" })
stuck detection counter  →   conditional transition rule
slot counting            →   flow-level concurrency config
new workflow = new skill →   new flow definition in DB
```

The engine has two execution modes. **Passive**: Claude Code agents connect via MCP and pull work — `flow.claim()`, do the work, `flow.report()`. The engine manages state. **Active**: the engine calls AI provider APIs directly and runs the full pipeline autonomously. Stages can mix modes within the same flow.

The changeset flow seed in `seeds/wopr-changeset.json` is the direct replacement for `/wopr:auto`.

### `src/` — The Engine

```
src/
  engine/         state machine, gate evaluator, invocation builder, event emitter, flow spawner
  repositories/   interfaces + Drizzle/SQLite implementations
  execution/      MCP server (passive mode), active runner, CLI
  adapters/       Linear, GitHub, Anthropic, Discord, Webhook, Stdout
  config/         seed loader + Zod schemas
```

**Core dependencies:** `better-sqlite3`, `drizzle-orm`, `handlebars`, `@modelcontextprotocol/sdk`, `zod`

```bash
# Bootstrap from seed
npx defcon init --seed seeds/wopr-changeset.json

# Serve MCP (passive mode — agents pull work)
npx defcon serve

# Run autonomous pipeline (active mode)
npx defcon run --flow changeset

# Check pipeline state
npx defcon status
```

---

## What's In This Repo

### [`docs/method/`](docs/method/) — The Method

Generic, tool-agnostic principles and patterns for building an agentic engineering system. Covers:

- **Why** deterministic gating produces reliable software
- **What** architectural patterns a multi-agent system needs
- **How** work flows through the pipeline (groom → architect → implement → review → fix → merge → deploy → verify)
- **Which** gates belong at each boundary
- **When** agents get triggered (event bus, not manual orchestration)

Read `method/` to understand agentic engineering. Adopt it with whatever tools you use.

### [`docs/wopr/`](docs/wopr/) — The WOPR Way

WOPR's concrete implementation of every method/ concept. Shows:

- 14+ agent definitions with behavioral specs
- Discord as event bus, Linear as issue tracker
- Biome + TypeScript + 4 review bots + custom check scripts as gates
- Docker Compose deployments with operational logbook
- CLAUDE.md layered inheritance across 20+ repos

Read `wopr/` to see how one project implements the methodology end-to-end.

### [`docs/adoption/`](docs/adoption/) — How To Adopt

The bridge from method/ to your own implementation. Prerequisites, checklist, migration guide.

## The Core Idea

```
Vibe Coding:  Human → AI → Hope → Production
DEFCON:       Human → AI → Gate → AI → Gate → AI → Gate → Production
```

Every transition is earned. Every gate is deterministic. Every finding feeds back into the system to prevent recurrence. The pipeline compounds — sprint 100 is easier than sprint 1 because the gates evolve.

## Table of Contents

### method/ — The Method

| Section | Documents |
|---------|-----------|
| **Manifesto** | [What is Agentic Engineering](docs/method/manifesto/what-is-agentic-engineering.md) · [Vibe Coding vs Agentic Engineering](docs/method/manifesto/vibe-coding-vs-agentic-engineering.md) · [System Architecture Principles](docs/method/manifesto/system-architecture-principles.md) · [Why This Works](docs/method/manifesto/why-this-works.md) |
| **Pipeline** | [Lifecycle](docs/method/pipeline/lifecycle.md) · [Pipeline Schema](docs/method/pipeline/pipeline-schema.md) |
| **Stages** | [00 Groom](docs/method/pipeline/stages/00-groom.md) · [01 Architect](docs/method/pipeline/stages/01-architect.md) · [02 Implement](docs/method/pipeline/stages/02-implement.md) · [03 Review](docs/method/pipeline/stages/03-review.md) · [04 Fix](docs/method/pipeline/stages/04-fix.md) · [05 Merge](docs/method/pipeline/stages/05-merge.md) · [06 Deploy](docs/method/pipeline/stages/06-deploy.md) · [07 Verify](docs/method/pipeline/stages/07-verify.md) |
| **Agents** | [Agent Definition Format](docs/method/pipeline/agents/agent-format.md) · [Role Specifications](docs/method/pipeline/agents/role-specifications.md) |
| **Triggers** | [Event Bus](docs/method/pipeline/triggers/event-bus.md) · [Trigger Taxonomy](docs/method/pipeline/triggers/trigger-taxonomy.md) · [Cross-Session Communication](docs/method/pipeline/triggers/cross-session.md) |
| **Gates** | [Gate Taxonomy](docs/method/gates/gate-taxonomy.md) · [Gate Scripts](docs/method/gates/gate-scripts.md) · [Development Hooks](docs/method/gates/hooks.md) |
| **QA** | [QA Team Design](docs/method/qa/qa-team.md) · [Post-Deploy Gate](docs/method/qa/post-deploy-gate.md) · [Observability](docs/method/qa/observability.md) |
| **DevOps** | [Logbook Protocol](docs/method/devops/logbook-protocol.md) · [Operations](docs/method/devops/operations.md) · [CI/CD Bridge](docs/method/devops/ci-cd-bridge.md) |
| **Config** | [Agent Rules](docs/method/config/agent-rules.md) · [Issue Tracker Workflow](docs/method/config/issue-tracker-workflow.md) |
| **Feedback** | [Learning Loop](docs/method/feedback/learning-loop.md) · [Self-Improvement](docs/method/feedback/self-improvement.md) |

### wopr/ — The WOPR Way

Every method/ document has a [1:1 counterpart in wopr/](docs/wopr/) showing the concrete implementation with specific tools, commands, and configurations.

### adoption/ — How To Adopt

[Getting Started](docs/adoption/getting-started.md) · [Checklist](docs/adoption/checklist.md) · [Migration Guide](docs/adoption/migration-guide.md)

## Who This Is For

- **Human developers** adopting AI-assisted development who want reliability, not vibes
- **AI agents** consuming this as their source of truth for how to operate in a gated system
- **Team leads** designing multi-agent engineering organizations

## License

MIT
