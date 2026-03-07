# Stage 6: Deploy — The WOPR Implementation

> Implements: [method/pipeline/stages/06-deploy.md](../../../method/pipeline/stages/06-deploy.md)

---

## Invocation

DevOps operations are handled by a `devops` discipline worker. In passive mode, a worker calls:

```bash
flow.claim({ workerId: "wkr_abc123", role: "devops" })
```

In active mode, DEFCON spawns a devops agent from the configured `wopr-release` or `wopr-incident` flow when an entity is created by an external event (GitHub release tag, PagerDuty alert).

DevOps prompt templates are defined in the seed file for the relevant flow. There is no `~/.claude/agents/wopr/wopr-devops.md` file — the prompt template in the seed IS the agent definition.

## The WOPR Stack

| Component | Technology | Where |
|-----------|-----------|-------|
| Platform API | Node.js + Hono + Drizzle | VPS (Docker container) |
| Platform UI | Next.js | VPS (Docker container) |
| Database | PostgreSQL | VPS (Docker container) |
| Reverse proxy | Caddy | VPS (Docker container) |
| Bot runtime | Dockerode (per-tenant containers) | VPS |
| GPU services | llama.cpp, whisper, chatterbox, embeddings | Separate GPU node |
| Container registry | GHCR (GitHub Container Registry) | GitHub |
| CD mechanism | Watchtower | VPS (polls GHCR for new images) |

## Deploy Pipeline

```
PR merges to main
  ↓
GitHub Actions builds Docker image → pushes to GHCR
  ↓
Watchtower on VPS detects new image → pulls and restarts container
  ↓
Health check: curl http://localhost:<port>/health
  ↓
Record in wopr-ops DEPLOYMENTS.md
```

## The wopr-ops Logbook

All operational state lives in a git repo: `wopr-network/wopr-ops`

```bash
# Clone/pull the logbook
git -C /tmp/wopr-ops pull 2>/dev/null || git clone https://github.com/wopr-network/wopr-ops /tmp/wopr-ops
```

### Logbook Files

| File | Purpose |
|------|---------|
| `RUNBOOK.md` | Current production state, go-live checklist, known gotchas |
| `DEPLOYMENTS.md` | Append-only deployment log |
| `INCIDENTS.md` | Incident records with root cause |
| `MIGRATIONS.md` | Database migration log (flags destructive migrations) |
| `DECISIONS.md` | Architectural decisions with rationale |
| `GPU.md` | GPU node status and service table |
| `TOPOLOGY.md` | Production architecture diagram |
| `nodes/vps-prod.md` | VPS node status and configuration |
| `nodes/gpu-prod.md` | GPU node status and configuration |

### Pre-Deploy: Read the Logbook

Before any deploy action, the DevOps agent reads:
1. `RUNBOOK.md` — current state (PRODUCTION / PRE-PRODUCTION / DEGRADED / DOWN)
2. `DEPLOYMENTS.md` — recent deploys (what to roll back to if needed)
3. `MIGRATIONS.md` — any pending migrations flagged as dangerous

### Post-Deploy: Write to the Logbook

```markdown
## 2026-03-06 14:32 UTC

- **Version**: v1.2.3 → v1.2.4
- **Commit**: abc123
- **Triggered by**: /wopr:devops deploy
- **Result**: SUCCESS
- **Health**: all services healthy
- **Notes**: Platform API restart took 15s, no downtime
```

Then commit and push:
```bash
cd /tmp/wopr-ops
git add DEPLOYMENTS.md
git commit -m "ops: deploy v1.2.4"
git push
```

## Infrastructure Configuration

### Docker Compose (Production)

Defined in `wopr-ops/docker-compose.yml` (production) and `wopr-ops/docker-compose.local.yml` (local dev).

Local dev uses profiles for VRAM management:
```bash
docker compose -f docker-compose.local.yml --profile voice --profile llm up -d
```

### DinD (Development)

Two-machine topology for local testing:
- VPS container (`docker:27-dind`) — runs platform services
- GPU container (`nvidia/cuda`) — runs inference services
- Connected via `wopr-dev` bridge network

## Hard Constraints

Embedded in the devops flow seed's prompt templates:

1. **Read RUNBOOK.md FIRST** — before any operation
2. **Record EVERY operation** — in the appropriate logbook file
3. **Never skip health checks** — after any deploy or rollback
4. **Destructive migrations require human approval** — flag DROP TABLE/COLUMN
5. **Commit logbook changes** — push to wopr-ops after every operation
