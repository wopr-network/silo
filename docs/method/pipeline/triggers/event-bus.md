# Event Bus Pattern

How agents communicate and how work gets triggered — without a central orchestrator bottleneck.

---

## The Problem

In a multi-agent pipeline, things happen asynchronously:
- A PR merges → a deploy should trigger
- CI fails → a fixer should spawn
- An issue is created → an architect should pick it up
- A deploy completes → smoke tests should run

If one orchestrator manages all of this, it becomes a bottleneck. Every event flows through one point. If that point fails, everything stops. If it's slow, everything waits.

## The Solution: Event Bus

An event bus decouples producers from consumers. An event happens. It's published to a channel. Any agent subscribed to that channel reacts independently.

```
┌──────────┐     ┌───────────────┐     ┌──────────┐
│ Producer │────→│  Event Bus    │────→│ Consumer │
│ (merge)  │     │  (channel)    │     │ (deploy) │
└──────────┘     └───────────────┘     └──────────┘
                        │
                        ├────→ Consumer (update tracker)
                        └────→ Consumer (notify team)
```

The producer doesn't know who's listening. The consumers don't know who produced the event. They're connected only by the event type and the channel.

## Event Types

The pipeline produces a finite set of event types:

### Build Events

| Event | Produced By | Consumed By |
|-------|------------|-------------|
| `issue.created` | Groomer | Architect |
| `spec.ready` | Architect | Coder |
| `pr.created` | Coder | Reviewer |
| `review.clean` | Reviewer | Merge queue |
| `review.issues` | Reviewer | Fixer |
| `fixes.pushed` | Fixer | Reviewer |
| `pr.merged` | Merge queue | Deployer, Tracker |

### Operational Events

| Event | Produced By | Consumed By |
|-------|------------|-------------|
| `deploy.started` | Deployer | Verifier |
| `deploy.completed` | Deployer | Verifier, Tracker |
| `verify.passed` | Verifier | Tracker |
| `verify.failed` | Verifier | Deployer (rollback) |
| `health.degraded` | Monitor | Incident handler |

### System Events

| Event | Produced By | Consumed By |
|-------|------------|-------------|
| `agent.stuck` | Stuck detector | Pipeline lead |
| `queue.backpressure` | Queue monitor | Pipeline lead |
| `cron.grooming` | Scheduler | Groomer |
| `human.escalation` | Pipeline lead | Human (notification) |

## Channels

Events flow through channels. A channel is a logical grouping — it could be a chat room, a webhook endpoint, a message queue, or a simple in-memory pub/sub.

The key properties of a channel:

1. **Concern-partitioned** — one channel per concern (engineering, operations, alerts), not one channel for everything
2. **Durable** — events are not lost if no consumer is listening at the moment
3. **Ordered** — events arrive in the order they were produced (within a channel)
4. **Observable** — you can see what events have flowed through the channel

### Suggested Channel Partitioning

| Channel | Events | Why Separate |
|---------|--------|-------------|
| **Engineering** | PR events, review events, merge events | Build lifecycle |
| **Operations** | Deploy events, health events, incidents | Operational lifecycle |
| **Alerts** | Failures, stuck agents, backpressure | Urgent attention |
| **Grooming** | Issue proposals, skeptic verdicts | Backlog management |

## Triggering Agents from Events

An agent is triggered when an event arrives that matches its subscription:

```
Subscription: "When a `spec.ready` event arrives for repo X"
Action: "Spawn a coder agent with the issue key from the event"
```

The triggering system maps events to agent spawns:

```
event: spec.ready
  → spawn: coder
  → with: { issue: event.issue_key, repo: event.repo }

event: pr.created
  → spawn: reviewer
  → with: { pr: event.pr_url, repo: event.repo }

event: review.issues
  → spawn: fixer
  → with: { pr: event.pr_url, findings: event.findings }
```

## Event Bus vs Orchestrator

| Aspect | Central Orchestrator | Event Bus |
|--------|---------------------|-----------|
| Single point of failure | Yes | No |
| Can scale independently | No (bottleneck) | Yes (add consumers) |
| Coupling | Tight (orchestrator knows all agents) | Loose (producers don't know consumers) |
| Adding new reactions | Modify orchestrator | Add a new subscriber |
| Observability | Check orchestrator state | Check channel history |
| Complexity | Simpler to start | Simpler to scale |

For small systems (1-3 agents), a central orchestrator is fine. For larger systems (5+ concurrent agents), the event bus pattern prevents the orchestrator from becoming a bottleneck.

## Hybrid: Event Bus + Session Orchestrator

In practice, most agentic engineering systems use a hybrid:

- A **session orchestrator** (the human's main session) manages the high-level pipeline state
- An **event bus** handles asynchronous triggers between stages
- The orchestrator subscribes to events and reacts, rather than polling agents

This gives you the benefits of both: centralized visibility (the orchestrator sees everything) with decoupled execution (agents react to events, not orchestrator commands).

## Anti-Patterns

- **God orchestrator** — one agent that manages everything. It becomes a bottleneck, a single point of failure, and impossible to reason about.
- **Unpartitioned channels** — all events in one channel. Consumers have to filter through noise to find their events.
- **Fire-and-forget events** — events that disappear if no consumer is listening. Durability matters.
- **Synchronous event handling** — blocking on each event before processing the next. Events should be handled concurrently.
- **Missing events** — the system does something without producing an event. Now no other agent can react to it.
