# Observability

How to see what the system is doing — metrics, logs, and traces that make the invisible visible.

---

## Observability is Architecture

Observability is not a feature you add after the system works. It's a design decision that shapes how the system is built. A system without observability is a system you can't debug, can't tune, and can't trust.

The principle: **if it's not observable, it doesn't exist** — at least not in any useful sense.

## The Three Pillars

### 1. Metrics

Numerical measurements over time. Metrics answer: "How much? How fast? How often?"

**Pipeline metrics** (agent system):
| Metric | What it tells you |
|--------|------------------|
| Issues processed per hour | Pipeline throughput |
| Time from issue creation to PR merge | End-to-end cycle time |
| Time per stage (architect, code, review, fix) | Where bottlenecks are |
| Fix cycles per PR | Code quality signal |
| Stuck detection triggers | Systemic issues |
| Agent spawn count by role | Resource utilization |
| Queue depth (unstarted issues) | Backlog health |

**Production metrics** (deployed system):
| Metric | What it tells you |
|--------|------------------|
| Request latency (p50, p95, p99) | Performance |
| Error rate (5xx percentage) | Reliability |
| Throughput (requests/second) | Capacity |
| CPU/memory/disk utilization | Resource health |
| Database query latency | Data layer health |
| Queue depth and drain rate | Async processing health |

### 2. Logs

Structured text records of events. Logs answer: "What happened? When? In what context?"

**Good log**: `{"level":"error","service":"auth","event":"login_failed","user_id":"abc123","reason":"invalid_token","timestamp":"2024-01-15T14:32:00Z"}`

**Bad log**: `Error: something went wrong`

Structured logs are machine-parseable. Unstructured logs are grep-fodder.

**Pipeline logs** (agent system):
- Agent spawn/shutdown events
- Stage transitions (issue moved from "coding" to "review")
- Gate results (pass/fail with details)
- Message exchanges between agents

### 3. Traces

Request-level tracking across service boundaries. Traces answer: "What path did this request take? Where did it slow down?"

For agentic engineering, tracing applies at two levels:
- **Issue trace**: the full path of an issue from creation to merge to deploy
- **Request trace**: the path of a user request through the deployed system

## What to Measure

### Pipeline Health

These metrics tell you whether the agentic pipeline is working well:

**Throughput**: Issues completed per time period. Trending down? Something is blocking the pipeline.

**Cycle time**: Time from issue creation to merge. Broken down by stage:
- Architect time: how long does spec writing take?
- Code time: how long does implementation take?
- Review time: how long does review take?
- Fix cycles: how many review→fix loops before CLEAN?

**Fix ratio**: Percentage of PRs that need fixes. High fix ratio means either the coder is making more mistakes or the reviewer is too strict. Both are worth investigating.

**Stuck rate**: Percentage of issues that trigger stuck detection (3+ fix cycles on the same finding). Chronic stuck issues indicate a systemic problem — perhaps a gate that's too strict, or a class of bugs the fixer can't handle.

**Queue depth**: How many issues are waiting to start. Growing? The pipeline is slower than the backlog is growing. Shrinking? The pipeline is keeping up.

### Production Health

These metrics tell you whether the deployed system is serving users well:

**Availability**: Percentage of time the service is responding to requests. Measured over rolling windows (1h, 24h, 7d, 30d).

**Latency distribution**: Not just average — p50 (median), p95 (most users), p99 (worst case). A service with low average latency but high p99 has a tail latency problem.

**Error budget**: How many errors can occur before reliability drops below the target. If the target is 99.9% uptime, the error budget is 0.1% of requests per month.

**Resource headroom**: How close are resources to capacity? CPU at 80% is fine. CPU at 95% means one traffic spike away from saturation.

## Thresholds and Alerts

Metrics without thresholds are just numbers. Define what "healthy" looks like:

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Error rate | < 0.5% | 0.5-2% | > 2% |
| Latency p95 | < 500ms | 500ms-1s | > 1s |
| CPU utilization | < 70% | 70-85% | > 85% |
| Queue depth | < 5 | 5-10 | > 10 |
| Fix ratio | < 30% | 30-50% | > 50% |

When a metric crosses a threshold:
- **Warning**: Alert, investigate, but don't act automatically
- **Critical**: Alert AND trigger automated response (scale up, rollback, pause pipeline)

## Dashboards vs Alerts

**Dashboards** are for humans who are actively looking. They show trends, correlations, and context. Useful for investigation and planning.

**Alerts** are for nobody-is-looking situations. They push notifications when thresholds are breached. Useful for incidents and urgent issues.

Rules:
- Don't alert on warnings that don't need immediate action (alert fatigue)
- Don't rely on dashboards for critical issues (nobody watches dashboards 24/7)
- Every alert must be actionable ("error rate is high" → "check the deploy log")

## Anti-Patterns

- **No observability** — flying blind. You learn about problems from users, not from metrics.
- **Observability as afterthought** — "we'll add monitoring later." Later never comes. Bake it in from the start.
- **Too many metrics** — measuring everything means drowning in data. Measure what's actionable.
- **Unstructured logs** — `console.log("error")` is useless. Structured, contextual logging is the baseline.
- **Alert fatigue** — alerting on every warning. People learn to ignore alerts, and then miss real problems.
- **Metrics without context** — "latency increased 20%" means nothing without knowing what deployed, what traffic changed, or what upstream service degraded.
