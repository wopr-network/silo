# System Architecture Principles

> Builds on: [The Thesis](the-thesis.md) — the launch protocol that these principles implement.

How multi-agent engineering systems cohere.

These six principles are the architectural spine of agentic engineering. They explain what patterns a multi-agent system must have to function as a whole, and why each is non-negotiable. They sit between the philosophy ([why this works](why-this-works.md)) and the implementation details (pipeline stages, agent definitions, reference config).

Without these principles, the system is a collection of smart agents that don't cohere. With them, it's an engineering organization that happens to be made of AI.

---

## Principle 1: Ephemeral Agents, Persistent State

Agents spawn, do one job, and die. They hold no state between invocations. All work product — specs, code, reviews, decisions — lives in external systems: git repos, issue trackers, container registries, operational logbooks.

**Why this matters:**

- Agent sessions have finite context windows. Long-running agents drift, hallucinate, and accumulate stale assumptions.
- The system must survive session boundaries. An architect writes a spec and shuts down. Hours later, a coder reads that spec and implements it. Neither knows the other existed.
- External state is auditable. Git commits have SHAs. Issue tracker states have timestamps. Agent memory is ephemeral and unverifiable.

**The contract:** An agent's ONLY durable output is a change to an external system — a commit, a comment, a state transition, a message. If it didn't change something external, it didn't happen.

**Anti-pattern:** Agents that accumulate context across tasks. Agents that store findings in memory instead of posting them. Agents that assume the next agent will "just know" what happened.

---

## Principle 2: Event Bus, Not Orchestrator

The lifecycle has multiple phases: backlog grooming, implementation, review, deployment, verification, monitoring. If a human must manually trigger each phase transition, the system's throughput is bounded by human attention.

**The pattern:** Events are published to a coordination medium. Responders subscribe by concern. Phase transitions happen automatically when triggering conditions are met.

**Implementation-agnostic.** The coordination medium can be:

- Chat channels (Discord, Slack, Teams)
- Webhook aggregators
- Message queues (Redis, RabbitMQ, SQS)
- Git-based polling (watch for new commits, tags, releases)
- File-based coordination (shared filesystem, memory files)
- Issue tracker state changes (webhooks on state transitions)

**What matters is the pattern, not the tool:**

1. Events are typed (deploy-completed, pr-merged, smoke-test-failed)
2. Events are routed to the right responders
3. Responders can trigger new agent sessions without human intervention
4. Humans can observe the event stream for situational awareness

**Why this matters:**

- Without an event bus, every phase transition requires a human typing a command. The system is autonomous within phases but manually orchestrated between them.
- With an event bus, the lifecycle runs continuously: a merge triggers a deploy, a deploy triggers verification, a verification failure triggers a rollback and an issue, the issue enters the next pipeline cycle.
- The event bus is also the observability layer — humans watch the same channels agents publish to.

**Anti-pattern:** A "master orchestrator" agent that runs forever, managing all other agents. This violates Principle 1 (ephemeral agents) and creates a single point of failure.

---

## Principle 3: Verification at Every Boundary

Different boundaries have different failure modes. Each needs its own gate type.

| Boundary | What Can Go Wrong | Gate Type |
|----------|------------------|-----------|
| Code → Branch | Logic errors, type errors, style violations | Static analysis, type checking, linting |
| Branch → Main | Regressions, architectural violations, security issues | CI suite, review bots, agent reviewer |
| Main → Registry | Build failures, dependency issues | CI build + push |
| Registry → Production | Bad deploy, migration failure, config mismatch | Pre-deploy checks, migration safety |
| Production → Verified | User journeys broken, service integration failures | Post-deploy smoke tests, E2E verification |
| Verified → Monitored | Performance regression, resource exhaustion | Continuous monitoring, baseline comparison |

**Why this matters:**

- Passing code review doesn't mean the deploy will work.
- Passing the deploy doesn't mean users can sign up.
- Passing smoke tests doesn't mean there's no latency regression.
- Each boundary has its own failure mode, so each needs its own verification.

**The rule:** Never assume that passing one gate implies passing the next. Gates are independent — each verifies what it verifies and nothing more.

**Anti-pattern:** "CI passed so it's safe to deploy." CI verifies code quality. Deployment verifies infrastructure. These are different concerns.

---

## Principle 4: Concern-Partitioned Channels

Not all events have the same audience or urgency. Engineering events (new PR, issue created) are different from operational events (deploy completed, health degraded) which are different from quality events (smoke test failed, regression detected) which are different from incident events (production down).

**The pattern:** Partition coordination channels by concern, not by tool:

- **Engineering concern** — pipeline activity, issue flow, PR lifecycle
- **Operations concern** — deployments, infrastructure changes, health status
- **Quality concern** — test results, regression alerts, system health metrics
- **Incident concern** — production failures, severity levels, timeline, resolution

**Why this matters:**

- Different concerns have different responders. A deploy event needs to reach the QA responder, the ops responder, AND be visible to humans — simultaneously.
- Partitioning by concern means agents can subscribe to what's relevant. The QA team watches the ops channel for deploy events. The ops team watches the quality channel for test failures. Neither needs to parse the other's internal chatter.
- Humans get observability into the system by watching the channels relevant to their role.

**Anti-pattern:** A single "agent-log" channel where all events are dumped. This is unreadable for humans and forces agents to filter irrelevant noise.

---

## Principle 5: Observability is Architecture

If you can't see whether the pipeline is flowing, whether agents are stuck, whether feedback loops are preventing regressions — the system degrades silently. You won't know until something breaks badly enough for a human to notice.

**What must be observable:**

- **Pipeline throughput** — issues entering vs exiting per time period
- **Stage duration** — how long issues spend in each stage
- **Gate effectiveness** — what percentage of work passes each gate on first attempt
- **Feedback loop verification** — are learned lessons actually preventing recurrence?
- **Agent health** — are spawned agents completing or timing out?
- **Stuck detection** — issues that haven't moved in a threshold amount of time

**Why this matters:**

- Without observability, you can't tell if the system is improving or degrading.
- Without metrics, you can't tune thresholds (concurrency limits, timeout durations, stuck detection sensitivity).
- Without dashboards, humans have no situational awareness — they must trust the system blindly or micromanage it manually. Neither scales.

**The rule:** If a metric matters, it must be published to a coordination channel. If it crosses a threshold, it must trigger a response — automated or human.

**Anti-pattern:** "We'll add monitoring later." By the time you notice you need it, the damage is already done.

---

## Principle 6: The Feedback Loop is the Product

Gates catch problems. Feedback loops prevent them. Without loops that promote findings into permanent rules, every sprint fights the same bugs. The system's value compounds over time — but only if the loops actually fire.

**The feedback loop taxonomy:**

1. **Immediate** — a finding from the fix cycle becomes a project-level rule (same session)
2. **Per-sprint** — review patterns become lint rules, agent prompt improvements
3. **Per-quarter** — operational metrics drive system configuration tuning
4. **Cross-project** — findings propagate through inheritance layers to all repos

**Why this matters:**

- A system without feedback loops has constant cost per sprint. Sprint 1 is as hard as sprint 100.
- A system WITH feedback loops has decreasing cost per sprint. Sprint 100 is easier than sprint 1 because the gates have evolved to catch what used to slip through.
- The compound effect: a bug found in review → becomes a project rule → becomes a lint check → becomes impossible to commit. Over 10 sprints, a recurring problem becomes a non-issue.

**The rule:** Every finding that a fixer resolves should be evaluated: "Is this a generalizable invariant?" If yes, it graduates to a permanent rule. If no, it's a one-off. The system must distinguish between the two.

**Anti-pattern:** Rule files that grow without bound, capturing every finding regardless of generalizability. Noise drowns signal. Consolidation is as important as capture.

---

## How These Principles Connect

```
Principle 1 (ephemeral agents) ──→ requires Principle 2 (event bus)
  because: if agents can't hold state, something must coordinate transitions

Principle 2 (event bus) ──→ requires Principle 4 (concern channels)
  because: undifferentiated events are noise, not signal

Principle 3 (boundary verification) ──→ requires Principle 5 (observability)
  because: if you can't see gate results, you can't trust the gates

Principle 5 (observability) ──→ feeds Principle 6 (feedback loops)
  because: metrics reveal patterns that become permanent improvements

Principle 6 (feedback loops) ──→ improves Principle 3 (boundary verification)
  because: findings graduate into gates, making gates stronger over time
```

The principles form a reinforcing cycle. Each one requires and strengthens the others. Remove any one and the system degrades — not immediately, but inevitably.

---

## For Adopters

This document tells you WHAT patterns you need and WHY. It does not tell you what tools to use. Your event bus might be Slack or a webhook aggregator. Your issue tracker might be Jira or GitHub Issues. Your coordination channels might be chat rooms or email lists or a web dashboard.

What matters is that you have:

- [ ] Ephemeral agents with all state externalized
- [ ] An event bus (any medium) with typed events and routed delivery
- [ ] Verification gates at every boundary (code, deploy, system, monitoring)
- [ ] Concern-partitioned channels (engineering, ops, quality, incidents)
- [ ] Observable metrics with threshold-triggered responses
- [ ] Feedback loops that promote findings into permanent rules

The reference implementation ([`wopr/`](../../wopr/)) shows how one project does it. Your implementation will differ. The principles won't.
