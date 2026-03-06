# Post-Deploy Gate

The gate between "deployed" and "confirmed" — how the system decides a deploy is actually good.

---

## Purpose

A deploy is not done when the artifact is running. It's done when the system confirms the artifact is running **correctly**. The post-deploy gate is the boundary between these two states.

## The Gate

```
Deploy artifact
  ↓
POST-DEPLOY GATE
  ├── Health check: is the service responding?
  ├── Smoke tests: are critical paths working?
  ├── Metric baseline: is performance acceptable?
  └── Integration check: can the service reach its dependencies?
  ↓
Gate verdict:
  PASS → deploy confirmed, record success
  FAIL → automatic rollback, record failure
```

## Gate Components

### Health Check (Blocking, Immediate)

The simplest component. Hit the health endpoint. Expect 200.

```
Attempts: up to 10 (with interval)
Interval: 5 seconds
Pass: 200 OK
Fail: any non-200 after all attempts exhausted
```

The health check must account for startup time. A service that takes 30 seconds to boot will fail an immediate health check. Use retry with backoff.

### Smoke Tests (Blocking, 1-5 minutes)

Run a small set of end-to-end tests against the production endpoint. These tests exercise the critical path — the minimum set of operations that must work for the product to be usable.

```
Smoke test criteria:
  - Tests ONLY critical paths (login, primary API, core feature)
  - Tests use read-only operations where possible
  - Tests complete in < 5 minutes total
  - Tests are idempotent (safe to run multiple times)
  - Tests clean up after themselves (no test data left in production)
```

### Metric Baseline (Non-Blocking, 5-30 minutes)

Compare current metrics against the pre-deploy snapshot:

| Metric | Threshold | Action on Breach |
|--------|-----------|-----------------|
| Error rate (5xx) | > 2x baseline | Alert, consider rollback |
| Latency p95 | > 1.5x baseline | Alert, investigate |
| Throughput | < 0.8x baseline | Alert, investigate |
| Memory usage | > 1.3x baseline | Alert, investigate (potential leak) |

Metric comparison is non-blocking because metric shifts can have causes unrelated to the deploy (traffic spikes, external service degradation). It alerts rather than auto-rollbacks.

### Integration Check (Blocking, 1-2 minutes)

Verify the deployed service can reach its dependencies:

```
For each dependency:
  - Database: run a simple query
  - Cache: get/set a test key
  - Queue: publish and consume a test message
  - External API: hit a health/status endpoint
```

A service that's running but can't reach its database is not healthy.

## Automatic Rollback

When the blocking components fail (health check, smoke tests, or integration check):

```
1. Identify the previous known-good artifact
2. Deploy the previous artifact
3. Run health check on the rolled-back artifact
4. If health check passes → rollback confirmed
5. If health check fails → CRITICAL: both versions are unhealthy
   → Alert human immediately
   → Do not attempt further automated action
6. Record the failed deploy and rollback in operational memory
7. Create an incident for investigation
```

### The Double-Failure Scenario

If both the new deploy AND the rollback fail, the system is in a critical state that requires human intervention. Do not attempt further automated recovery — the risk of making things worse is too high.

## Gate Timing

```
T+0:00  Deploy starts
T+0:30  Health check (first attempt)
T+1:00  Health check passes → proceed to smoke tests
T+1:00  Smoke tests start
T+3:00  Smoke tests pass → proceed to integration check
T+3:00  Integration check starts
T+4:00  Integration check passes → deploy confirmed (blocking gate cleared)
T+4:00  Metric baseline comparison starts (non-blocking)
T+34:00 Metric comparison completes → no regression detected
```

Total blocking gate time: ~4 minutes. This is the minimum time between "deployed" and "confirmed."

## Recording the Result

Every deploy gate result is recorded:

```
Deploy: v1.2.3 → v1.2.4
Time: 2024-01-15T14:32:00Z
Health check: PASS (3 attempts, 15s)
Smoke tests: PASS (12/12, 2m30s)
Integration: PASS (db, cache, queue all healthy)
Metrics: PASS (no regression at T+30m)
Result: CONFIRMED
```

Or on failure:

```
Deploy: v1.2.3 → v1.2.4
Time: 2024-01-15T14:32:00Z
Health check: PASS
Smoke tests: FAIL (login endpoint returning 500)
Rollback: v1.2.4 → v1.2.3 (auto)
Rollback health: PASS
Result: ROLLED BACK
Incident: INC-42 created
```

## Anti-Patterns

- **No post-deploy gate** — deploying and assuming success. The most dangerous omission.
- **Only health check** — a service can be "up" but completely broken. Smoke tests catch what health checks miss.
- **Blocking on metrics** — metric shifts take time to manifest. Don't block the deploy on a 30-minute metric window. Use non-blocking alerts.
- **No rollback plan** — if you can't answer "how do we undo this?" before deploying, you're not ready.
- **Testing in production with side effects** — smoke tests that create real orders, send real emails, or charge real credit cards. Use read-only operations or test accounts.
