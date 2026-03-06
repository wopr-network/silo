# Logbook Protocol — The WOPR Implementation

> Implements: [method/devops/logbook-protocol.md](../../method/devops/logbook-protocol.md)

---

## The wopr-ops Repository

WOPR's operational memory lives in a git repository: `wopr-network/wopr-ops`

```bash
# Clone or pull
git -C /tmp/wopr-ops pull 2>/dev/null || git clone https://github.com/wopr-network/wopr-ops /tmp/wopr-ops
```

### Repository Structure

```
wopr-ops/
├── RUNBOOK.md              # Current production state
├── DEPLOYMENTS.md          # Append-only deploy log
├── INCIDENTS.md            # Incident records
├── MIGRATIONS.md           # Database migration log
├── DECISIONS.md            # Architectural decisions
├── GPU.md                  # GPU node status
├── TOPOLOGY.md             # Production architecture diagram
├── docker-compose.local.yml # Local dev compose (flat)
├── Caddyfile.local         # Local Caddy config
├── nodes/
│   ├── vps-prod.md         # VPS node status
│   └── gpu-prod.md         # GPU node status
└── local/
    ├── docker-compose.yml  # DinD two-machine topology
    ├── gpu-seeder.sh       # Seeds GPU registration into DB
    └── README.md           # DinD documentation
```

## Logbook Files

### RUNBOOK.md

The ONE document that answers: "What's the current production state?"

Contents:
- Current state: `PRE-PRODUCTION` / `PRODUCTION` / `DEGRADED` / `DOWN`
- Go-live checklist with status
- Stack details (services, ports, dependencies)
- VPS and GPU node tables
- Secrets inventory (which secrets exist, not their values)
- Known gotchas (DinD quirks, env var propagation, Caddy config)
- Rollback procedure
- Local dev instructions (both flat compose and DinD topology)

### DEPLOYMENTS.md

Append-only. Every deploy, rollback, and restart is logged:

```markdown
## 2026-03-06 14:32 UTC

- **Version**: v1.2.3 → v1.2.4
- **Commit**: abc123def
- **Triggered by**: /wopr:devops deploy (Watchtower auto-pull)
- **Result**: SUCCESS
- **Health**: API 200, UI 200, DB connected
- **Duration**: 45 seconds (container restart)
- **Notes**: No downtime. Platform API took 15s to become healthy.
```

### INCIDENTS.md

Template:

```markdown
## INC-001 — 2026-03-06 — Platform API Crash Loop

- **Severity**: SEV2 (degraded service)
- **Started**: 2026-03-06T14:32:00Z
- **Detected by**: Health check (auto)
- **Resolved**: 2026-03-06T14:45:00Z
- **Root cause**: Migration 0031 dropped a table still referenced by a query
- **Resolution**: Rolled back to v1.2.3, reverted migration
- **Prevention**: Migration safety gate now flags DROP TABLE
- **Action items**:
  - [ ] Add migration safety check to CI
  - [ ] Update CLAUDE.md with gotcha
```

### MIGRATIONS.md

```markdown
## Migration 0031 — add_billing_tables

- **Date**: 2026-03-05
- **Type**: Schema change
- **Destructive**: YES (drops legacy_payments table)
- **Reversible**: NO (data loss on rollback)
- **Status**: APPLIED (staging only)
- **Notes**: Flagged as dangerous. Requires human approval before production.
```

### DECISIONS.md

```markdown
## Bare VPS over Managed Platforms

- **Decision**: Use a bare VPS with Docker instead of AWS/GCP/Vercel
- **Context**: WOPR needs per-tenant Docker containers via Dockerode
- **Alternatives**:
  - AWS ECS (too complex for the use case)
  - Kubernetes (operational overhead too high for team size)
  - Railway/Render (can't run Dockerode)
- **Rationale**: Dockerode needs direct Docker socket access. Managed platforms abstract this away.
- **Consequences**: We own the infrastructure. No auto-scaling. Manual provisioning.
- **Date**: 2026-02-15
```

## Pre-Consultation Rule

The DevOps agent reads the logbook BEFORE every operation:

| Operation | Must read |
|-----------|----------|
| Deploy | RUNBOOK.md, DEPLOYMENTS.md, MIGRATIONS.md |
| Rollback | DEPLOYMENTS.md (what to roll back to), INCIDENTS.md |
| Migrate | MIGRATIONS.md, DECISIONS.md |
| Health check | RUNBOOK.md (expected topology) |
| Provision | DECISIONS.md, TOPOLOGY.md, RUNBOOK.md |

This is enforced in the `wopr-devops.md` agent definition:

```
## Hard Constraints
1. Read RUNBOOK.md FIRST — before any operation
2. Record EVERY operation in the appropriate logbook file
3. Commit and push logbook changes to wopr-ops
```

## Logbook Maintenance

After recording, the DevOps agent commits and pushes:

```bash
cd /tmp/wopr-ops
git add .
git commit -m "ops: <operation description>"
git push
```

The logbook is version-controlled. Every change is tracked in git history. This provides an audit trail of who changed what and when.
