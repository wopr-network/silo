# Stage 7: Verify — The WOPR Implementation

> Implements: [method/pipeline/stages/07-verify.md](../../../method/pipeline/stages/07-verify.md)

---

## Current State

WOPR is in **PRE-PRODUCTION** as of this writing. The verification layer is designed but not yet fully deployed. This document describes the target state.

## Verification Layers

### Layer 1: Health Checks

```bash
# Platform API
curl -s http://localhost:3000/health

# Platform UI
curl -s http://localhost:3001/health

# Database
psql $DATABASE_URL -c "SELECT 1"

# GPU services (when provisioned)
curl -s http://gpu-node:8080/health  # llama.cpp
curl -s http://gpu-node:8081/health  # whisper
curl -s http://gpu-node:8082/health  # chatterbox
curl -s http://gpu-node:8083/health  # embeddings
```

The DevOps agent runs health checks after every deploy via `/wopr:devops health`.

### Layer 2: Smoke Tests

WOPR has a growing e2e test suite for the platform:

```bash
# Run against production endpoint
cd /home/tsavo/wopr-platform
npx vitest run tests/e2e/
```

E2e tests cover:
- Authentication (login, registration, session management)
- Bot management (create, configure, deploy)
- Billing lifecycle (Stripe integration)
- Admin operations
- Org/team management

### Layer 3: Metric Comparison

Target infrastructure (not yet deployed):
- Response latency from Caddy access logs
- Error rate from application logs
- Resource usage from `docker stats`
- Database query latency from slow query log

### Layer 4: Regression Detection

Target infrastructure:
- Application log monitoring for new error types post-deploy
- Docker container restart detection
- Queue depth monitoring (when message queues are added)

## The QA Team (Planned)

The QA team design for WOPR:

| Agent | What it does |
|-------|-------------|
| **QA Lead** | Spawned by DevOps agent after deploy. Triages all QA agent reports. |
| **Smoke Tester** | Runs e2e tests against production. Reports pass/fail per test. |
| **Integration Tester** | Checks service-to-service communication (API ↔ DB, API ↔ Stripe, etc.) |
| **Regression Watcher** | Compares Caddy access logs before/after deploy for latency regression. |
| **System Observer** | Watches `docker logs` for new error patterns. |

The QA team would be invoked automatically after every deploy or manually via:
```
/wopr:devops health
```

## Automatic Rollback

When verification fails:

```bash
# Identify previous image tag from DEPLOYMENTS.md
PREVIOUS_TAG=<from-logbook>

# Pull and restart with previous image
docker compose pull
docker compose up -d

# Verify rollback health
curl -s http://localhost:3000/health

# Record in logbook
cd /tmp/wopr-ops
# Append to INCIDENTS.md and DEPLOYMENTS.md
git add . && git commit -m "ops: rollback — <reason>" && git push
```

## Discord Integration

Deploy events flow to Discord channels:

| Event | Channel | Mechanism |
|-------|---------|-----------|
| Deploy started | `#devops` | DevOps agent posts |
| Deploy succeeded | `#devops` | DevOps agent posts |
| Deploy failed | `#alerts` | DevOps agent posts |
| Rollback triggered | `#alerts` | DevOps agent posts |
| Health check degraded | `#alerts` | Monitoring webhook |
