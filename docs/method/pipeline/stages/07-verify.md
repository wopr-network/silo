# Stage 7: Verify

Post-deploy validation — how the system confirms production is healthy.

---

## Purpose

Verification is the final gate. It answers: "Is the thing we just deployed actually working?" Not in a test environment. Not on a staging server. In production, with real traffic, under real conditions.

## Why Verify After Deploy?

Tests catch logic errors. CI catches build errors. Review catches design errors. But none of these catch:

- **Environment errors** — missing env vars, wrong database URL, expired certificates
- **Scale errors** — works with 10 requests, breaks at 10,000
- **Integration errors** — the payment provider changed their API response format
- **Data errors** — production data has patterns the test fixtures don't
- **Infrastructure errors** — the container runs out of memory, the disk fills up

Verification catches what pre-deploy gates can't simulate.

## The Verification Layers

### Layer 1: Health Checks

The simplest form of verification. A health endpoint returns 200 if the service is running.

```
GET /health → 200 OK (service is up)
GET /health → 503 (service is down or degraded)
```

Health checks run immediately after deploy and continuously thereafter. They catch: service not starting, crash loops, port conflicts, missing dependencies.

**What they don't catch:** the service is up but producing wrong results.

### Layer 2: Smoke Tests

A small set of end-to-end tests that exercise critical paths in production. Not the full test suite — just the paths that, if broken, mean the product is unusable.

Examples:
- Can a user log in?
- Can the API accept a request and return a valid response?
- Does the database respond to queries?
- Can the service reach its dependencies (cache, queue, external APIs)?

Smoke tests run immediately after deploy. They catch: broken authentication, database connection issues, misconfigured routes, missing assets.

**What they don't catch:** subtle regressions in non-critical paths.

### Layer 3: Metric Comparison

Compare production metrics against a baseline (the metrics from before the deploy):

- **Latency** — p50, p95, p99 response times. A significant increase signals a problem.
- **Error rate** — percentage of 5xx responses. Any increase is a red flag.
- **Throughput** — requests per second. A sudden drop suggests the service is struggling.
- **Resource usage** — CPU, memory, disk. Unexpected spikes indicate leaks or inefficiencies.

Metric comparison runs over a window after deploy (5-30 minutes). It catches: performance regressions, memory leaks, inefficient queries, resource contention.

**What it doesn't catch:** problems that only manifest under specific conditions or over longer time periods.

### Layer 4: Regression Detection

Continuous monitoring for anomalies. Unlike smoke tests (which run once), regression detection watches production traffic for patterns that deviate from normal:

- Error types that didn't exist before the deploy
- API endpoints returning unexpected shapes
- Queue depths growing without draining
- Background jobs failing at higher rates

Regression detection is ongoing. It catches problems that emerge over hours or days, not just minutes.

## The Verification Flow

```
Deploy completes
  ↓
Layer 1: Health check (immediate, blocking)
  Pass → continue
  Fail → automatic rollback
  ↓
Layer 2: Smoke tests (1-5 minutes, blocking)
  Pass → continue
  Fail → automatic rollback
  ↓
Layer 3: Metric comparison (5-30 minutes, non-blocking)
  Baseline OK → deploy confirmed
  Degradation → alert, consider rollback
  ↓
Layer 4: Regression detection (ongoing, non-blocking)
  Normal → nothing
  Anomaly → alert, investigate
```

Layers 1-2 are **blocking** — a failure triggers automatic rollback. The deploy is not considered successful until these pass.

Layers 3-4 are **non-blocking** — they alert rather than auto-rollback, because metric shifts can have causes unrelated to the deploy.

## Automatic Rollback

When verification fails (Layer 1 or 2), the system automatically reverts to the last known-good state:

1. Identify the previous artifact version
2. Deploy the previous version
3. Verify the rollback succeeded (health check + smoke test)
4. Record the failed deploy and rollback in operational memory
5. File an incident for investigation

Automatic rollback is the safety net. Without it, a bad deploy sits in production until someone notices and manually intervenes.

## The QA Team

For systems with dedicated verification agents, the QA team is a set of agents that own post-deploy validation:

| Agent | Responsibility |
|-------|---------------|
| **Smoke tester** | Runs smoke tests against production immediately after deploy |
| **Integration tester** | Verifies cross-service integration (APIs, databases, queues) |
| **Regression watcher** | Monitors metrics for drift from baseline |
| **System observer** | Watches logs, error rates, and resource usage |
| **QA lead** | Triages findings, decides rollback vs investigate |

The QA team is separate from the development pipeline. They don't know or care what was deployed — they just verify that production is healthy.

## Gate

The verify stage is complete when:

- Health checks pass
- Smoke tests pass
- Metric baseline shows no degradation (or degradation has been triaged)
- The verification result has been recorded

If verification fails and the system rolls back, the pipeline loops: the failed deploy becomes a finding, which enters the fix stage, producing a new PR that goes through review → merge → deploy → verify again.

## Anti-Patterns

- **No verification** — deploying and assuming it works. The most dangerous anti-pattern.
- **Verification only in staging** — staging is not production. Different data, different load, different configuration.
- **Manual verification** — "go check the website." Humans miss things. Automate it.
- **Verification without rollback** — detecting a problem without the ability to fix it automatically is just monitoring with extra steps.
- **Testing everything in production** — smoke tests are a small subset. Don't run the full test suite against production — it's slow, noisy, and can affect real users.
