# Trigger Taxonomy

How agents get invoked — every mechanism that turns "something happened" into "an agent starts working."

---

## The Problem

An agentic engineering system only works if the right agent starts at the right time. Without reliable triggers, the pipeline stalls — work sits in queues, deploys don't happen, reviews accumulate.

## Trigger Sources

### 1. Webhooks

External systems notify the pipeline when something happens.

```
GitHub → webhook → "PR merged on main" → trigger deploy agent
Issue tracker → webhook → "issue created" → trigger architect agent
CI system → webhook → "checks failed" → trigger fixer agent
```

**Strengths:** Real-time, event-driven, no polling overhead.
**Weaknesses:** Requires infrastructure (webhook endpoints), can miss events if the endpoint is down.

### 2. Scheduled (Cron)

Time-based triggers for recurring work.

```
Daily at 02:00 → trigger grooming session
Weekly on Monday → trigger dependency freshness scan
Every 6 hours → trigger health check sweep
```

**Strengths:** Predictable, doesn't miss events, catches slow-drift issues.
**Weaknesses:** Not real-time, can run unnecessarily if nothing changed.

### 3. Threshold Monitors

Metric-based triggers that fire when a value crosses a boundary.

```
Open PR count > 4 → trigger backpressure response
Error rate > 5% → trigger incident handler
Backlog < 3 items → trigger grooming session
Queue depth > 10 → trigger scale-up
```

**Strengths:** Responsive to actual system state, not just events.
**Weaknesses:** Requires monitoring infrastructure, thresholds need tuning.

### 4. Cross-Session Injection

One agent or session tells another to start work. This is how the orchestrator spawns agents.

```
Pipeline lead → "spawn architect for WOP-42" → architect starts
Reviewer → "ISSUES: PR #17" → pipeline lead → "spawn fixer for PR #17" → fixer starts
Watcher → "BLOCKED: PR #17" → pipeline lead → "spawn fixer for PR #17" → fixer starts
```

**Strengths:** Direct, synchronous, the spawner controls the context.
**Weaknesses:** Requires the spawner to be running. If the session ends, pending spawns are lost.

### 5. Human Invocation

A human explicitly starts work.

```
Human types "/deploy production" → deploy agent starts
Human types "/groom security" → grooming session starts
Human approves PR → merge queue triggered
```

**Strengths:** Intentional, contextual, allows human judgment at key moments.
**Weaknesses:** Requires human availability, introduces latency.

## Trigger Mapping

Which triggers start which agents:

| Agent | Primary Trigger | Fallback Trigger |
|-------|----------------|-----------------|
| Groomer | Cron (weekly) or threshold (backlog < N) | Human invocation |
| Architect | Issue created event | Human invocation |
| Design Architect | Issue created with UI label | Human invocation |
| Coder | Spec posted event | Human invocation |
| Reviewer | PR created event | Human invocation |
| Fixer | Review findings event | Human invocation |
| Deployer | PR merged event (CD) or human invocation | Cron (scheduled deploy window) |
| Verifier | Deploy completed event | Human invocation |
| Watcher | PR enters merge queue | Pipeline lead spawns |
| Auditor | Cron (weekly/monthly) | Human invocation |

Every agent has at least two trigger sources: the primary automated trigger and a human fallback. If the automated trigger fails, a human can always invoke the agent manually.

## Trigger Chains

Events trigger agents, agents produce events, events trigger more agents. This is the pipeline in motion:

```
issue.created
  → architect spawns
    → spec.ready
      → coder spawns
        → pr.created
          → reviewer spawns
            → review.clean
              → merge queue
                → pr.merged
                  → deployer spawns
                    → deploy.completed
                      → verifier spawns
                        → verify.passed ✓
```

Each link in the chain is a trigger. Each trigger is independently auditable: you can ask "what triggered the coder?" and get a concrete answer ("the spec.ready event for WOP-42 at 14:32").

## Trigger Reliability

Triggers can fail. The system must handle:

1. **Missed events** — the webhook endpoint was down when the event fired
   - **Mitigation**: Webhook retry with exponential backoff, or periodic polling as fallback

2. **Duplicate events** — the webhook fired twice for the same event
   - **Mitigation**: Idempotency. If the agent is already running for this issue, don't spawn another.

3. **Stale triggers** — a cron fires but there's nothing to do
   - **Mitigation**: The triggered agent checks for work before starting. If there's nothing, it exits immediately.

4. **Cascade failures** — one trigger failure causes downstream triggers to never fire
   - **Mitigation**: Independent trigger sources. If the webhook fails, the cron catches it. If the cron fails, the human notices.

## Anti-Patterns

- **Single trigger source** — relying only on webhooks means a webhook outage stops the pipeline. Always have a fallback.
- **Polling instead of events** — checking every 30 seconds whether something changed. Use events for real-time, polling only as fallback.
- **Implicit triggers** — "the coder just knows to start after the spec is posted." No. The trigger must be explicit and auditable.
- **Missing idempotency** — spawning two coders for the same issue because the webhook fired twice.
- **Over-triggering** — a cron that runs every minute for work that happens weekly. Wasteful and noisy.
