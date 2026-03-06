# Observability — The WOPR Implementation

> Implements: [method/qa/observability.md](../../method/qa/observability.md)

---

## Pipeline Observability

### What's Tracked

Every `/wopr:auto` session tracks:

| Data Point | Where | How |
|-----------|-------|-----|
| Pipeline state table | In-session memory | Pipeline lead maintains mental state |
| Issue transitions | Linear | Auto-updated by GitHub↔Linear integration |
| PR status | GitHub | Queried via `gh pr view` |
| CI results | GitHub Actions | Queried via `gh pr checks` |
| Review bot findings | GitHub PR comments | Read via `gh api repos/.../pulls/<N>/comments` |
| Agent spawn/shutdown | In-session | Pipeline lead logs each spawn |
| Session handoff | MEMORY.md | Written before session ends |

### Pipeline Metrics (Derived)

These can be calculated from Linear + GitHub data:

| Metric | Calculation |
|--------|-------------|
| Issues per session | Count of "MERGED THIS SESSION" in MEMORY.md |
| Cycle time | Linear issue created → PR merged (timestamps) |
| Fix ratio | PRs with ISSUES verdict / total PRs |
| Stuck rate | Issues hitting 3+ fix cycles / total issues |
| Concurrent throughput | Peak pipeline slots used |

### Observability Gaps

Currently NOT tracked (planned):

| Gap | Why it matters | Planned fix |
|-----|---------------|-------------|
| Per-agent cost (tokens) | Can't optimize model routing without cost data | Claude API usage logging |
| Per-agent time | Can't identify slow agents | Timestamp spawn/shutdown |
| Fix cycle breakdown | Can't tell if fixer or reviewer is the bottleneck | Track fix count per finding type |

## Production Observability

### Current Infrastructure

| Component | Observability | Tool |
|-----------|--------------|------|
| Platform API | Access logs, error logs | Caddy access log, application stdout |
| Platform UI | Build errors, runtime errors | Next.js error overlay, browser console |
| Database | Slow query log, connection count | PostgreSQL `pg_stat_statements` |
| Docker containers | Resource usage, restart events | `docker stats`, `docker events` |
| GPU services | Health endpoints | `curl <service>/health` |

### The wopr-ops Logbook as Observability

The wopr-ops git repo provides historical observability:

```
RUNBOOK.md     → Current state (what IS)
DEPLOYMENTS.md → Deploy history (what CHANGED)
INCIDENTS.md   → Failure history (what WENT WRONG)
MIGRATIONS.md  → Schema history (what EVOLVED)
DECISIONS.md   → Design history (what was DECIDED and WHY)
```

Every operational action is recorded. `git log` on wopr-ops shows the complete operational history.

### Discord as Real-Time Observability

Discord channels provide real-time visibility:

| Channel | What you see |
|---------|-------------|
| `#engineering` | PR events — created, reviewed, merged |
| `#devops` | Deploy events — started, succeeded, failed |
| `#alerts` | Failures — CI failed, agent stuck, health degraded |
| `#grooming` | Backlog events — issues created, priorities set |

Humans can watch these channels to see the system working in real time.

## Metrics and Thresholds

### Pipeline Health

| Metric | Healthy | Warning | Critical | Action |
|--------|---------|---------|----------|--------|
| Open PRs per repo | < 4 | 4 | > 6 | Pause new work, run `/wopr:fix-prs` |
| Fix cycles per PR | < 2 | 2-3 | > 3 | Stuck detection → escalate |
| Queue depth | < 10 | 10-20 | > 20 | Run `/wopr:groom` less frequently |
| CI pass rate | > 95% | 80-95% | < 80% | Investigate flaky tests |

### Production Health

| Metric | Healthy | Warning | Critical | Action |
|--------|---------|---------|----------|--------|
| Health endpoint | 200 | — | non-200 | Auto-rollback |
| API response time | < 200ms | 200-500ms | > 500ms | Investigate |
| Error rate | < 1% | 1-5% | > 5% | Auto-rollback |
| Memory usage | < 70% | 70-85% | > 85% | Scale or optimize |
| Disk usage | < 80% | 80-90% | > 90% | Clean up or expand |
