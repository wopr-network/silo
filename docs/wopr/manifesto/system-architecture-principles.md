# System Architecture Principles — The WOPR Implementation

> Implements: [method/manifesto/system-architecture-principles.md](../../method/manifesto/system-architecture-principles.md)
>
> See also: [The Thesis](the-thesis.md) — the full stack and naming convention

---

## Principle 1: Ephemeral Agents, Persistent State

### How WOPR Does It

**Agents**: Every WOPR agent is spawned via Claude Code's `Task` tool with `run_in_background: true`. Each agent gets a name tied to the Linear issue number (e.g., `architect-81`, `coder-81`, `reviewer-81`). When done, the pipeline lead sends a `shutdown_request` message.

**Persistent state lives in**:
- **Linear**: issue status, specs (as comments), priority, blocking relationships
- **GitHub**: PRs, branches, CI results, review comments, merge status
- **wopr-ops**: deployment log, incident log, migration log, decision log, runbook
- **CLAUDE.md files**: per-repo rules and gotchas (version-controlled)
- **Agent memory files**: `~/.claude/projects/*/memory/MEMORY.md` — session handoff state

**Nothing is stored in agent memory**. When a session ends, the pipeline state is reconstructable from Linear + GitHub + wopr-ops.

## Principle 2: Event Bus, Not Orchestrator

### How WOPR Does It

WOPR uses a **hybrid** approach:

- **Discord guild** serves as the event bus with concern-partitioned channels:
  - `#engineering` — PR events, review events, merge events (webhook from GitHub)
  - `#devops` — deploy events, health checks (webhook from GitHub releases)
  - `#alerts` — failures, stuck agents, backpressure warnings
  - `#grooming` — backlog discussions, proposal summaries

- **GitHub webhooks** trigger events:
  - PR created → appears in `#engineering`
  - CI fails → appears in `#alerts`
  - Push to main → appears in `#devops`

- **Claude Code session** acts as the session orchestrator:
  - Reads messages from agents (via Task tool message protocol)
  - Spawns new agents in response to messages
  - Manages pipeline state in memory during the session

The Discord channels provide durability and observability. The Claude Code session provides real-time orchestration.

## Principle 3: Verification at Every Boundary

### How WOPR Does It

Every boundary has a gate:

| Boundary | Gate |
|----------|------|
| Code → git | Pre-commit: `biome check`, `tsc --noEmit` |
| Branch → PR | CI: lint, type check, build, test (GitHub Actions) |
| PR → approved | Review bots (Qodo, CodeRabbit, Devin, Sourcery) + agent reviewer |
| Approved → main | Merge queue (re-runs CI on integrated code) |
| main → production | Pre-deploy: migration safety, secret validation |
| Production → confirmed | Post-deploy: health check, smoke tests |

No boundary is unguarded. The scripts that implement these gates:
- `~/wopr-await-reviews.sh` — synchronization gate for review bots
- `~/wopr-pr-watch.sh` — merge queue watcher
- GitHub Actions workflows — CI gates
- Biome config (`biome.json`) — lint/format rules per repo

## Principle 4: Concern-Partitioned Channels

### How WOPR Does It

Discord channels partition concerns:

| Channel | Concern | Who Posts | Who Reads |
|---------|---------|-----------|-----------|
| `#engineering` | Build pipeline events | GitHub webhooks, agents | Pipeline lead, developers |
| `#devops` | Operational events | Deploy scripts, health checks | DevOps agent, on-call |
| `#alerts` | Urgent issues | Monitoring, stuck detection | Everyone |
| `#grooming` | Backlog management | Grooming agents | Team lead, product |
| `#general` | Human discussion | Humans | Humans |

Within the Claude Code session, agents communicate through the Task tool's message protocol — structured signals like `"Spec ready: WOP-42"`. This is the intra-session event bus.

## Principle 5: Observability is Architecture

### How WOPR Does It

**Pipeline observability**:
- Every agent spawn is logged with issue key and role
- Every state transition is reported to the pipeline lead
- The pipeline lead maintains a mental state table (tracked in-session)
- Session handoff notes in `~/.claude/projects/*/memory/MEMORY.md`

**Production observability**:
- wopr-ops RUNBOOK.md — current production state
- wopr-ops DEPLOYMENTS.md — append-only deploy log
- wopr-ops INCIDENTS.md — incident records with root cause
- GitHub Actions — CI results with full logs
- Discord `#devops` — real-time operational events

**Code observability**:
- GitHub PR diffs — what changed
- Linear comments — why it changed (architect's spec)
- Review bot comments — what was flagged
- Merge queue status — integration state

## Principle 6: The Feedback Loop is the Product

### How WOPR Does It

WOPR's feedback loop in action:

1. **Gate evolution**: Early WOPR had no `biome` rule for `@ts-ignore`. Agents kept using it. After 3 occurrences, `noTsIgnore` was added to `biome.json`. Now `@ts-ignore` is a CI failure.

2. **Prompt evolution**: Early reviewers declared CLEAN before Qodo posted. After 2 missed findings, the reviewer prompt was updated: "Wait for `~/wopr-await-reviews.sh` before reviewing." Now reviewers always wait.

3. **Config self-tuning**: The review bot timeout started at 5 minutes. Qodo consistently took 7-8 minutes. Timeout was increased to 10 minutes. Fewer false "TIMEOUT" alarms.

4. **Cross-repo propagation**: The `console.log → ctx.log` rule was discovered in `wopr-plugin-discord`. It was propagated to all `wopr-plugin-*` repos.

5. **SOP self-evolution**: The QA team didn't exist in the original WOPR design. After deploys with no post-deploy verification, the QA team was designed and documented (this repo is the result).

The CLAUDE.md `## Gotchas` section in each repo is the living artifact of this feedback loop. After every fix cycle, a one-shot updater checks if the findings represent generalizable invariants and adds them to CLAUDE.md.
