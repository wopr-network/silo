# Post-Deploy Gate — The WOPR Implementation

> Implements: [method/qa/post-deploy-gate.md](../../method/qa/post-deploy-gate.md)

---

## WOPR's Post-Deploy Verification

### Health Check (Implemented)

```bash
# Platform API
curl -sf http://localhost:3000/health || echo "API unhealthy"

# Platform UI
curl -sf http://localhost:3001/ || echo "UI unreachable"

# Database
psql $DATABASE_URL -c "SELECT 1" || echo "Database unreachable"
```

The DevOps agent runs health checks after every deploy and records results in `DEPLOYMENTS.md`.

### Smoke Tests (Implemented — E2E Suite)

WOPR has a growing e2e test suite:

| Test File | What it covers |
|-----------|---------------|
| `admin-operations.e2e.test.ts` | Admin CRUD, permissions |
| `backup-restore.e2e.test.ts` | Database backup/restore |
| `billing-lifecycle.e2e.test.ts` | Stripe billing flows |
| `chat-inference.e2e.test.ts` | Chat API with AI providers |
| `email-verification.e2e.test.ts` | Email verification flow |
| `org-team-management.e2e.test.ts` | Organization and team management |
| `secrets-management.e2e.test.ts` | Secret storage and retrieval |

```bash
npx vitest run tests/e2e/
```

### Metric Baseline (Planned)

Target metrics to compare before/after deploy:

| Metric | Source | Baseline Method |
|--------|--------|----------------|
| API latency | Caddy access logs | `awk '{print $NF}' /var/log/caddy/access.log` |
| Error rate | Application logs | `grep -c "level.*error" /var/log/platform-api.log` |
| Memory usage | Docker | `docker stats --no-stream --format '{{.MemUsage}}'` |
| CPU usage | Docker | `docker stats --no-stream --format '{{.CPUPerc}}'` |

### Integration Check (Planned)

Dependencies to verify after deploy:

| Dependency | Check | Expected |
|-----------|-------|----------|
| PostgreSQL | `SELECT 1` | Success |
| Stripe API | `GET /v1/balance` | 200 |
| GHCR | `docker pull` test | Success |
| GPU node | `curl gpu-node:8080/health` | 200 |

## Automatic Rollback

When health check or smoke tests fail:

```bash
# 1. Identify previous version
PREV_VERSION=$(tail -n 20 /tmp/wopr-ops/DEPLOYMENTS.md | grep "Version:" | tail -1 | awk '{print $2}')

# 2. Deploy previous version
docker compose pull   # Pull previous images
docker compose up -d  # Restart with previous version

# 3. Verify rollback
curl -sf http://localhost:3000/health

# 4. Record in logbook
cd /tmp/wopr-ops
cat >> INCIDENTS.md << EOF
## $(date -u +%Y-%m-%d) — Deploy Rollback

- **Severity**: SEV2
- **Detected**: Health check failure after deploy
- **Resolution**: Automatic rollback to $PREV_VERSION
- **Root cause**: TBD (investigation needed)
EOF
git add . && git commit -m "ops: rollback — health check failed" && git push
```

## Gate Flow

```
Deploy completes (Watchtower restarts container)
  ↓
T+0:00  Health check (curl /health, retry up to 10x)
  ↓ pass
T+0:30  Smoke tests (npx vitest run tests/e2e/smoke/)
  ↓ pass
T+3:00  Integration checks (DB, Stripe, GPU)
  ↓ pass
T+3:30  Deploy CONFIRMED — record in DEPLOYMENTS.md
  ↓
T+3:30  Metric comparison starts (background, 30 minutes)
  ↓
T+33:30 Metric comparison complete — no regression → done
         or regression detected → alert in Discord #alerts
```
