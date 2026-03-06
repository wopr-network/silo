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

## Who This Is For

- **Human developers** adopting AI-assisted development who want reliability, not vibes
- **AI agents** consuming this as their source of truth for how to operate in a gated system
- **Team leads** designing multi-agent engineering organizations

## License

MIT
