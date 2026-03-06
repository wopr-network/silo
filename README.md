# Agentic Engineering

**The methodology for AI-gated software development.**

Agentic engineering is the discipline where AI agents do the work and deterministic gates verify every action. No human in the loop for verification — the gates ARE the verification. The result is software that's more reliable than what either humans or AI produce alone.

This is not vibe coding. In vibe coding, you prompt an AI and hope the result is correct. In agentic engineering, every AI action passes through deterministic, holistic checks before it can affect the codebase, the infrastructure, or the users.

## What's In This Repo

### [`method/`](method/) — The Method

Generic, tool-agnostic principles and patterns for building an agentic engineering system. Covers:

- **Why** deterministic gating produces reliable software
- **What** architectural patterns a multi-agent system needs
- **How** work flows through the pipeline (groom → architect → implement → review → fix → merge → deploy → verify)
- **Which** gates belong at each boundary
- **When** agents get triggered (event bus, not manual orchestration)

Read `method/` to understand agentic engineering. Adopt it with whatever tools you use.

### [`wopr/`](wopr/) — The WOPR Way

WOPR's concrete implementation of every method/ concept. Shows:

- 14+ agent definitions with behavioral specs
- Discord as event bus, Linear as issue tracker
- Biome + TypeScript + 4 review bots + custom check scripts as gates
- Docker Compose deployments with operational logbook
- CLAUDE.md layered inheritance across 20+ repos

Read `wopr/` to see how one project implements the methodology end-to-end.

### [`adoption/`](adoption/) — How To Adopt

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
| **Manifesto** | [What is Agentic Engineering](method/manifesto/what-is-agentic-engineering.md) · [Vibe Coding vs Agentic Engineering](method/manifesto/vibe-coding-vs-agentic-engineering.md) · [System Architecture Principles](method/manifesto/system-architecture-principles.md) · [Why This Works](method/manifesto/why-this-works.md) |
| **Pipeline** | [Lifecycle](method/pipeline/lifecycle.md) · [Pipeline Schema](method/pipeline/pipeline-schema.md) |
| **Stages** | [00 Groom](method/pipeline/stages/00-groom.md) · [01 Architect](method/pipeline/stages/01-architect.md) · [02 Implement](method/pipeline/stages/02-implement.md) · [03 Review](method/pipeline/stages/03-review.md) · [04 Fix](method/pipeline/stages/04-fix.md) · [05 Merge](method/pipeline/stages/05-merge.md) · [06 Deploy](method/pipeline/stages/06-deploy.md) · [07 Verify](method/pipeline/stages/07-verify.md) |
| **Agents** | [Agent Definition Format](method/pipeline/agents/agent-format.md) · [Role Specifications](method/pipeline/agents/role-specifications.md) |
| **Triggers** | [Event Bus](method/pipeline/triggers/event-bus.md) · [Trigger Taxonomy](method/pipeline/triggers/trigger-taxonomy.md) · [Cross-Session Communication](method/pipeline/triggers/cross-session.md) |
| **Gates** | [Gate Taxonomy](method/gates/gate-taxonomy.md) · [Gate Scripts](method/gates/gate-scripts.md) · [Development Hooks](method/gates/hooks.md) |
| **QA** | [QA Team Design](method/qa/qa-team.md) · [Post-Deploy Gate](method/qa/post-deploy-gate.md) · [Observability](method/qa/observability.md) |
| **DevOps** | [Logbook Protocol](method/devops/logbook-protocol.md) · [Operations](method/devops/operations.md) · [CI/CD Bridge](method/devops/ci-cd-bridge.md) |
| **Config** | [Agent Rules](method/config/agent-rules.md) · [Issue Tracker Workflow](method/config/issue-tracker-workflow.md) |
| **Feedback** | [Learning Loop](method/feedback/learning-loop.md) · [Self-Improvement](method/feedback/self-improvement.md) |

### wopr/ — The WOPR Way

Every method/ document has a [1:1 counterpart in wopr/](wopr/) showing the concrete implementation with specific tools, commands, and configurations.

### adoption/ — How To Adopt

[Getting Started](adoption/getting-started.md) · [Checklist](adoption/checklist.md) · [Migration Guide](adoption/migration-guide.md)

## Who This Is For

- **Human developers** adopting AI-assisted development who want reliability, not vibes
- **AI agents** consuming this as their source of truth for how to operate in a gated system
- **Team leads** designing multi-agent engineering organizations

## License

MIT
