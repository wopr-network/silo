# QA Team Design

Post-deploy verification agents — the last line of defense before users see problems.

---

## Purpose

The QA team owns production health verification. They don't know what was deployed — they only know what "healthy" looks like and whether the current state matches.

This separation is intentional. The QA team is independent from the development pipeline. They verify outcomes, not implementations.

## The QA Roles

### QA Lead

**Responsibility**: Triages all findings from the QA agents and decides: proceed, investigate, or roll back.

**Input**: Health reports, smoke test results, metric comparisons, log analysis
**Output**: Go/no-go decision for the deploy

The QA lead is the only role that can trigger a rollback. Individual QA agents report findings; the lead decides what to do about them.

### Smoke Tester

**Responsibility**: Runs a predefined set of end-to-end tests against production immediately after deploy.

**Tests cover**:
- Authentication (can a user log in?)
- Core API (do primary endpoints respond correctly?)
- Database connectivity (do queries work?)
- External integrations (can the service reach its dependencies?)

**What it doesn't do**: Run the full test suite. Smoke tests are fast and targeted — 10-20 tests that cover critical paths.

### Integration Tester

**Responsibility**: Verifies cross-service and cross-system integration.

**Checks**:
- Service-to-service communication (can service A call service B?)
- Queue health (are messages being consumed?)
- Cache connectivity (is the cache reachable and populating?)
- External API contracts (do third-party APIs return expected shapes?)

Integration issues are invisible to unit tests and often invisible to smoke tests. The integration tester exercises the seams between systems.

### Regression Watcher

**Responsibility**: Compares production metrics against the pre-deploy baseline.

**Monitors**:
- Response latency (p50, p95, p99)
- Error rate (5xx percentage)
- Throughput (requests per second)
- Resource utilization (CPU, memory, disk)

The regression watcher doesn't act on individual requests — it watches trends. A 10ms latency increase on one request is noise. A 10ms increase across all requests is a regression.

### System Observer

**Responsibility**: Watches logs, error streams, and system events for anomalies.

**Watches for**:
- New error types that didn't exist before the deploy
- Log volume spikes (more errors = more logging)
- Process restarts or crash loops
- Queue depth growth without corresponding consumption
- Connection pool exhaustion

The system observer catches problems that metrics don't surface — qualitative issues that show up in logs before they show up in dashboards.

## The QA Flow

```
Deploy completes
  ↓
QA Lead spawns all QA agents (parallel)
  ↓
┌─────────────┬──────────────┬──────────────┬──────────────┐
│ Smoke       │ Integration  │ Regression   │ System       │
│ Tester      │ Tester       │ Watcher      │ Observer     │
│             │              │              │              │
│ Run tests   │ Check seams  │ Compare      │ Watch logs   │
│ Report      │ Report       │ metrics      │ Report       │
│             │              │ Report       │              │
└──────┬──────┴──────┬───────┴──────┬───────┴──────┬───────┘
       │             │              │              │
       └─────────────┴──────────────┴──────────────┘
                           ↓
                      QA Lead triages
                           ↓
              ┌────────────┼────────────┐
              ↓            ↓            ↓
          All clear    Investigate    Rollback
          (proceed)    (alert, watch)  (revert)
```

## Triage Criteria

The QA lead uses these criteria:

### Rollback (immediate)

- Smoke tests fail (critical path broken)
- Health endpoint returning errors
- Error rate > threshold (e.g., 5%)
- Service not starting / crash loop

### Investigate (alert, continue monitoring)

- Latency increase > 20% at p95
- New error types in logs (low volume)
- One integration point degraded but not down
- Throughput decrease < 10%

### All Clear (proceed)

- All smoke tests pass
- All integrations healthy
- Metrics within baseline tolerance
- No new error types in logs

## Timing

| QA Agent | When it runs | Duration |
|----------|-------------|----------|
| Smoke Tester | Immediately after deploy | 1-5 minutes |
| Integration Tester | Immediately after deploy | 2-5 minutes |
| Regression Watcher | 5-30 minutes after deploy | Ongoing (fades to background monitoring) |
| System Observer | Immediately, ongoing | 15-60 minutes active, then ongoing passive |
| QA Lead | After first reports arrive | Until all agents report |

Smoke and integration tests are **blocking** — the deploy isn't confirmed until they pass. Regression and observation are **non-blocking** — they run in the background and alert if something drifts.

## The QA Team vs the Test Suite

The QA team is NOT a replacement for the test suite:

| Concern | Test Suite | QA Team |
|---------|-----------|---------|
| When | Before merge (CI) | After deploy (production) |
| Where | Test environment | Production |
| What | Code behavior | System behavior |
| How | Automated assertions | Observation + metrics |
| Coverage | Comprehensive | Critical paths only |

The test suite verifies that the code is correct. The QA team verifies that the deployed system is healthy. Both are necessary. Neither is sufficient alone.

## Anti-Patterns

- **No QA team** — deploying and assuming production is fine. The most common failure mode.
- **QA team runs the full test suite** — smoke tests are a small, fast subset. Running the full suite against production is slow and can affect real users.
- **QA team that can't rollback** — detecting a problem without the authority to fix it is useless. The QA lead must have rollback authority.
- **QA team coupled to the dev pipeline** — QA agents should be independent. They don't know what was deployed; they just verify health.
- **QA only runs once** — some problems emerge over hours, not minutes. The regression watcher and system observer must run continuously, not just at deploy time.
