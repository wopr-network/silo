# Event Bus — The WOPR Implementation

> Implements: [method/pipeline/triggers/event-bus.md](../../../method/pipeline/triggers/event-bus.md)

---

## WOPR's Hybrid Event System

WOPR uses a hybrid approach: Discord channels as the durable event bus + Claude Code's Task message protocol for intra-session orchestration.

## Discord Channels (Durable Event Bus)

| Channel | Events | Webhook Source |
|---------|--------|---------------|
| `#engineering` | PR created, PR merged, CI failed, review posted | GitHub webhooks |
| `#devops` | Deploy started, deploy succeeded, health check results | DevOps agent posts |
| `#alerts` | CI failures, stuck agents, backpressure warnings, incidents | Monitoring + agent alerts |
| `#grooming` | Grooming summaries, new issues created | Grooming skill output |
| `#general` | Human discussion, announcements | Humans |

### GitHub Webhook Integration

GitHub sends webhooks to Discord for:
- `pull_request` events (opened, closed, merged) → `#engineering`
- `check_suite` events (completed with failure) → `#alerts`
- `push` to main → `#devops`
- `issues` events → `#engineering`

Configuration: GitHub repo settings → Webhooks → Discord webhook URL per channel.

## Claude Code Task Messages (Session Bus)

Within a `/wopr:auto` session, agents communicate through structured messages:

### Message Protocol

```
Signal: "Spec ready: WOP-81"
  → Pipeline lead: shutdown architect, spawn coder

Signal: "PR created: https://github.com/.../pull/42 for WOP-81"
  → Pipeline lead: shutdown coder, spawn reviewer, fill slot

Signal: "CLEAN: https://github.com/.../pull/42"
  → Pipeline lead: shutdown reviewer, queue merge, spawn watcher

Signal: "ISSUES: https://github.com/.../pull/42 — <findings>"
  → Pipeline lead: shutdown reviewer, check stuck, spawn fixer

Signal: "Fixes pushed: https://github.com/.../pull/42"
  → Pipeline lead: shutdown fixer, spawn reviewer (re-review)

Signal: "Merged: https://github.com/.../pull/42 for WOP-81"
  → Pipeline lead: shutdown watcher, refresh queue, fill slot

Signal: "BLOCKED: https://github.com/.../pull/42 for WOP-81 — CI failing: <checks>"
  → Pipeline lead: shutdown watcher, spawn fixer

Signal: "Can't resolve: https://github.com/.../pull/42 — <reason>"
  → Pipeline lead: shutdown fixer, escalate to human, remove from pipeline
```

### Implementation

Agents send messages via the `SendMessage` tool:
```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "Spec ready: WOP-81",
  summary: "Spec posted for WOP-81"
})
```

The pipeline lead (main session) receives these messages and reacts according to the pipeline schema.

## Cross-Channel Events

Some events flow between channels:

```
GitHub webhook: PR #42 CI failed
  → Discord #alerts: "CI failed on PR #42"
  → Pipeline lead sees reviewer report: "ISSUES: CI failing"
  → Pipeline lead spawns fixer

Fixer pushes fix → CI re-runs
  → GitHub webhook: PR #42 CI passed
  → Discord #engineering: "CI passed on PR #42"
  → Reviewer re-reviews → "CLEAN"
```

## Trigger Configuration

| Trigger | Source | Target |
|---------|--------|--------|
| Issue created in Linear | `/wopr:groom` creates it | `/wopr:auto` picks it up on next run |
| PR created on GitHub | Coder agent creates it | GitHub webhook → Discord `#engineering` |
| CI failure | GitHub Actions | GitHub webhook → Discord `#alerts` |
| PR merged | Merge queue/auto-merge | GitHub webhook → Discord `#engineering` + `#devops` |
| Cron (grooming) | Human runs `/wopr:groom` weekly | N/A — currently manual |
| Cron (health) | Human runs `/wopr:devops health` | N/A — currently manual |

## Future: Fully Automated Triggers

Currently, `/wopr:groom` and `/wopr:auto` are manually invoked by a human typing the slash command. The roadmap includes:

- Discord bot watching `#engineering` for new issues → auto-trigger architect
- Cron job running `/wopr:groom` weekly
- Webhook from Linear → trigger pipeline on issue state change
- Health check cron → trigger `/wopr:devops health` every 6 hours
