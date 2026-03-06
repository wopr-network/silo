# CI/CD Bridge — The WOPR Implementation

> Implements: [method/devops/ci-cd-bridge.md](../../method/devops/ci-cd-bridge.md)

---

## CI: GitHub Actions

Every WOPR repo has CI via GitHub Actions:

### Trigger

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

CI runs on every PR push and every merge to main.

### CI Jobs

| Job | What it runs | Time |
|-----|-------------|------|
| Lint and Type Check | `pnpm lint` + `pnpm format --check` + `tsc --noEmit` | ~30s |
| Build | `pnpm build` | ~30s |
| Test | `pnpm test` (vitest full suite) | ~2 min |

Total CI time: ~3 minutes per PR.

### Required Checks

| Repo | Required Checks | Merge Queue |
|------|----------------|-------------|
| wopr | Lint and Type Check, Build, Test | Yes (GitHub native) |
| wopr-platform | CI | Yes (ruleset ID 12966480) |
| wopr-plugin-discord | varies | No |
| wopr-plugin-types | ci (null app_id — use `--admin`) | No |
| wopr-plugin-msteams | ci (null app_id — use `--admin`) | No |
| wopr-plugin-whatsapp | standard | No |

## CD: GHCR + Watchtower

### Build Pipeline

```
PR merges to main
  ↓
GitHub Actions workflow triggers on push to main:
  1. Checkout code
  2. Build Docker image
  3. Tag with commit SHA and 'latest'
  4. Push to ghcr.io/wopr-network/<repo>
  ↓
Image available in GHCR
```

### Deploy Pipeline

```
Watchtower runs on VPS (polls every 5 minutes):
  1. Check GHCR for new 'latest' tag
  2. If new image found: pull
  3. Stop current container gracefully
  4. Start new container with same config
  5. Container healthy → done
  6. Container unhealthy → Watchtower keeps old container
```

### End-to-End: PR to Production

```
Agent creates PR
  ↓ (GitHub webhook → Discord #engineering)
CI runs (3 min)
  ↓ all checks pass
Review bots post (5-10 min)
  ↓ wopr-await-reviews.sh blocks
Agent reviewer → CLEAN
  ↓
Merge queue (wopr, wopr-platform) or auto-merge (plugins)
  ↓ CI re-runs on integrated code
PR merges to main
  ↓ (GitHub webhook → Discord #engineering + #devops)
GitHub Actions builds Docker image → pushes to GHCR
  ↓ (~2 min)
Watchtower detects new image → pulls → restarts container
  ↓ (~30s)
Health check confirms service is up
  ↓
Deploy complete
```

Total time from PR merge to production: ~5 minutes (automated, no human intervention).

## CI Interaction with the Pipeline

### Reviewer checks CI first

```bash
gh pr checks <N> --repo wopr-network/<repo>
```

- If FAILING → report ISSUES immediately, skip code review
- If PENDING → wait 3 minutes, re-check
- If PASSING → proceed to code review

### Merge queue re-runs CI

For repos with merge queue (wopr, wopr-platform), the merge queue rebases on current main and re-runs ALL required checks. This catches integration conflicts between concurrent PRs.

### Fixer addresses CI failures

When CI fails after merge queue:
1. Watcher reports "BLOCKED: CI failing"
2. Pipeline spawns fixer with failing check names
3. Fixer pushes fix → CI re-runs → PR re-enters queue

## Known Gotchas

- **Push real commit for CI**: Empty pushes (`--allow-empty`) don't always trigger GitHub Actions
- **wopr-plugin-types CI**: The `ci` required check has `app_id: null` — it's a stale check that never runs. Use `gh pr merge --admin` to bypass.
- **Watchtower polling interval**: 5 minutes by default. Not instant. Deploys appear delayed by up to 5 minutes after image push.
