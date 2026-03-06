# Agentic Engineering

**The methodology for AI-gated software development.**

Agentic engineering is the discipline where AI agents do the work and deterministic gates verify every action. No human in the loop for verification — the gates ARE the verification. The result is software that's more reliable than what either humans or AI produce alone.

This is not vibe coding. In vibe coding, you prompt an AI and hope the result is correct. In agentic engineering, every AI action passes through deterministic, holistic checks before it can affect the codebase, the infrastructure, or the users.

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
Vibe Coding:     Human → AI → Hope → Production
Agentic Engineering:  Human → AI → Gate → AI → Gate → AI → Gate → Production
```

Every arrow is verified. Every gate is deterministic. Every finding feeds back into the system to prevent recurrence. The methodology compounds — sprint 100 is easier than sprint 1 because the gates evolve.

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
