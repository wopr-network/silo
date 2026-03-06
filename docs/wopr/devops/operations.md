# Operations — The WOPR Implementation

> Implements: [method/devops/operations.md](../../method/devops/operations.md)

---

## The /wopr:devops Skill

```
/wopr:devops status    — Read current production state
/wopr:devops deploy    — Push update to production
/wopr:devops rollback  — Revert to last known-good
/wopr:devops migrate   — Run DB migrations
/wopr:devops health    — Check all services
/wopr:devops gpu-provision — Provision GPU node
/wopr:devops initial-deploy — First production deployment
```

The skill spawns a `wopr-devops` agent:

```
Task({
  subagent_type: "wopr-devops",
  prompt: "Operation: deploy\n\nRead RUNBOOK.md first, then execute the deploy procedure."
})
```

Agent definition: `~/.claude/agents/wopr/wopr-devops.md`

## WOPR's Operations

### Deploy

```bash
# 1. Read logbook
cd /tmp/wopr-ops && git pull
cat RUNBOOK.md  # Check current state
cat DEPLOYMENTS.md | tail -20  # Check recent deploys

# 2. Build and push (automated via GitHub Actions + GHCR)
# Merging to main triggers: build Docker image → push to GHCR

# 3. Deploy (automated via Watchtower)
# Watchtower polls GHCR → detects new image → pulls → restarts container

# 4. Verify
curl -sf http://localhost:3000/health
curl -sf http://localhost:3001/

# 5. Record
cat >> DEPLOYMENTS.md << 'EOF'
## $(date -u +%Y-%m-%dT%H:%M:%SZ)
- **Version**: <prev> → <new>
- **Commit**: <hash>
- **Result**: SUCCESS
- **Health**: API 200, UI 200
EOF
cd /tmp/wopr-ops && git add . && git commit -m "ops: deploy <version>" && git push
```

### Rollback

```bash
# 1. Identify previous version from deployment log
PREV=$(grep "Version:" DEPLOYMENTS.md | tail -2 | head -1)

# 2. Pin previous image tag in docker-compose
# Edit docker-compose.yml to use specific image tag

# 3. Pull and restart
docker compose pull && docker compose up -d

# 4. Verify
curl -sf http://localhost:3000/health

# 5. Record rollback + create incident
cat >> INCIDENTS.md << 'EOF'
## INC-XXX — Rollback
- **Severity**: SEV2
- **Root cause**: <reason>
- **Resolution**: Rolled back to <prev>
EOF
```

### Migrate

```bash
# 1. Check migration log
cat MIGRATIONS.md

# 2. Check for destructive operations
grep -i "drop\|delete\|truncate" migrations/*.sql

# 3. If destructive → require human approval
echo "⚠️ Migration contains DROP TABLE. Approve? [y/N]"

# 4. Backup database
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# 5. Apply migration
npx drizzle-kit push

# 6. Verify
psql $DATABASE_URL -c "SELECT * FROM information_schema.tables WHERE table_schema = 'public'"

# 7. Record
cat >> MIGRATIONS.md << 'EOF'
## Migration XXXX — <name>
- **Date**: $(date -u +%Y-%m-%d)
- **Destructive**: YES/NO
- **Result**: SUCCESS
EOF
```

### Health Check

```bash
# Check all services
echo "=== Platform API ==="
curl -sf http://localhost:3000/health && echo "OK" || echo "FAILED"

echo "=== Platform UI ==="
curl -sf http://localhost:3001/ -o /dev/null && echo "OK" || echo "FAILED"

echo "=== Database ==="
psql $DATABASE_URL -c "SELECT 1" && echo "OK" || echo "FAILED"

echo "=== Docker Containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo "=== Resource Usage ==="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

## Infrastructure

### Production Topology

```
Internet → Cloudflare → Caddy (reverse proxy)
                          ├── Platform API (port 3000)
                          ├── Platform UI (port 3001)
                          └── PostgreSQL (port 5432)

Separate GPU Node:
  ├── llama.cpp (port 8080)
  ├── whisper (port 8081)
  ├── chatterbox (port 8082)
  └── embeddings (port 8083)
```

### Key Decisions (from DECISIONS.md)

- **Bare VPS over managed platforms**: Dockerode needs direct Docker socket access
- **No Kubernetes**: Operational overhead too high for current team size
- **Caddy for TLS**: Auto-HTTPS with Cloudflare proxy OFF (Caddy handles certs)
- **GHCR as registry**: GitHub Container Registry — integrated with GitHub Actions
- **Watchtower for CD**: Polls GHCR for new images, auto-restarts containers
- **GPU node separate**: Different hardware requirements, separate scaling
