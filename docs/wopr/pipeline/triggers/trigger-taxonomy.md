# Trigger Taxonomy — The WOPR Implementation

> Implements: [method/pipeline/triggers/trigger-taxonomy.md](../../../method/pipeline/triggers/trigger-taxonomy.md)

---

## WOPR's Trigger Sources

### 1. Human Invocation (Primary — Current State)

Most WOPR pipeline actions are currently triggered by a human typing a slash command:

| Command | What it triggers |
|---------|-----------------|
| `/wopr:groom` | Adversarial grooming session (3 advocates + skeptic) |
| `/wopr:auto` | Continuous pipeline (backlog → architect → code → review → merge) |
| `/wopr:auto max=2` | Pipeline with 2 concurrent slots |
| `/wopr:devops deploy` | Production deployment |
| `/wopr:devops rollback` | Rollback to previous version |
| `/wopr:devops health` | Health check sweep |
| `/wopr:audit wopr-plugin-discord` | 5-agent repo audit |
| `/wopr:fix-prs` | PR backlog cleanup |
| `/wopr:sprint` | Sprint planning |

### 2. Webhooks (GitHub → Discord)

GitHub sends webhooks that appear in Discord channels. These are currently informational (humans see them), not programmatic triggers.

| GitHub Event | Discord Channel | Human Action |
|-------------|----------------|-------------|
| PR created | `#engineering` | Human may run `/wopr:auto` to process the review |
| CI failed | `#alerts` | Human investigates or runs `/wopr:fix-prs` |
| PR merged | `#engineering` + `#devops` | Watchtower auto-deploys (CD) |
| Push to main | `#devops` | Watchtower auto-deploys (CD) |

### 3. Cross-Session Injection (Intra-Session)

Within a `/wopr:auto` session, agents trigger each other through the message protocol:

```
architect-81 → "Spec ready: WOP-81" → pipeline lead spawns coder-81
coder-81 → "PR created: #42" → pipeline lead spawns reviewer-81
reviewer-81 → "CLEAN: #42" → pipeline lead queues merge, spawns watcher-81
watcher-81 → "Merged: #42" → pipeline lead refreshes queue, fills slot
```

### 4. Threshold Monitors (Inline in Pipeline)

The pipeline lead checks thresholds before every action:

```bash
# Backpressure check (before filling slots)
gh pr list --repo wopr-network/<repo> --state open --json number --jq 'length'
# If >= 4: pause new work in this repo

# Stuck detection (before spawning fixer)
# If same finding flagged 3+ times: escalate to human

# Queue depletion
# If queue is empty and pipeline is empty: stop
```

### 5. Automated CD (Watchtower)

Watchtower runs on the VPS and auto-deploys when new Docker images appear in GHCR:

```
PR merges → GitHub Actions builds image → pushes to GHCR
→ Watchtower polls GHCR → detects new image → pulls and restarts container
```

This is the only fully automated trigger chain in WOPR today.

## Trigger Chain: Issue to Production

```
Human types /wopr:groom
  → Advocates scan, skeptic challenges, lead creates Linear issue
Human types /wopr:auto
  → Pipeline fetches backlog from Linear
  → Spawns architect (opus) for top-priority unblocked issue
    → Architect posts spec → "Spec ready"
      → Pipeline spawns coder (sonnet)
        → Coder creates PR → "PR created"
          → CI runs (GitHub Actions trigger on push)
          → Review bots trigger (GitHub app webhooks)
          → Pipeline spawns reviewer (sonnet)
            → Reviewer waits for bots → reads comments → "CLEAN"
              → Pipeline queues merge → spawns watcher (haiku)
                → Merge queue processes PR → merges to main
                  → GitHub Actions builds Docker image → pushes to GHCR
                    → Watchtower detects new image → restarts container
                      → Health check confirms service is up
```

Each `→` is a trigger. Each trigger is traceable: you can follow the chain from `/wopr:groom` to "container restarted."

## What's Missing (Roadmap)

| Trigger | Current | Target |
|---------|---------|--------|
| Grooming | Human types `/wopr:groom` | Cron (weekly) or threshold (backlog < 3 items) |
| Pipeline start | Human types `/wopr:auto` | Webhook from Linear (issue created → auto-process) |
| Health check | Human types `/wopr:devops health` | Cron (every 6 hours) |
| Incident response | Human notices | Alert threshold → auto-trigger incident handler |
