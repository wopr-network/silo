# Agent Role Specifications — The WOPR Implementation

> Implements: [method/pipeline/agents/role-specifications.md](../../../method/pipeline/agents/role-specifications.md)

---

## WOPR Agent Roster

### Build Phase

| Role | Agent Type | Model | Claude Code Tool |
|------|-----------|-------|-----------------|
| Architect | `wopr-architect` | Opus | `Task({ subagent_type: "wopr-architect", model: "opus" })` |
| UI Architect | `wopr-ui-architect` | Opus | `Task({ subagent_type: "wopr-ui-architect", model: "opus" })` |
| Coder | `wopr-coder` | Sonnet | `Task({ subagent_type: "wopr-coder", model: "sonnet" })` |
| Designer | `wopr-ui-designer` | Opus | `Task({ subagent_type: "wopr-ui-designer", model: "opus" })` |
| Reviewer | `wopr-reviewer` | Sonnet | `Task({ subagent_type: "wopr-reviewer", model: "sonnet" })` |
| Fixer | `wopr-fixer` | Sonnet | `Task({ subagent_type: "wopr-fixer", model: "sonnet" })` |

### Operational Phase

| Role | Agent Type | Model | Claude Code Tool |
|------|-----------|-------|-----------------|
| Watcher | `general-purpose` | Haiku | `Task({ model: "haiku" })` |
| CLAUDE.md Updater | `general-purpose` | Haiku | `Task({ model: "haiku" })` |
| DevOps | `wopr-devops` | Sonnet | `Task({ subagent_type: "wopr-devops" })` |

### Grooming Phase

| Role | Agent Type | Model | Team |
|------|-----------|-------|------|
| Codebase Advocate | spawned via Agent tool | Sonnet | `wopr-groom` |
| Ecosystem Advocate | spawned via Agent tool | Sonnet | `wopr-groom` |
| Security Advocate | spawned via Agent tool | Sonnet | `wopr-groom` |
| Skeptic | spawned via Agent tool | Sonnet | `wopr-groom` |

### Audit Phase

| Role | Agent Type | Model | Team |
|------|-----------|-------|------|
| Correctness Auditor | spawned via Agent tool | Opus | `wopr-audit` |
| Completeness Auditor | spawned via Agent tool | Opus | `wopr-audit` |
| Practices Auditor | spawned via Agent tool | Opus | `wopr-audit` |
| Test Auditor | spawned via Agent tool | Opus | `wopr-audit` |
| Security Auditor | spawned via Agent tool | Opus | `wopr-audit` |

## Model Routing Rationale

| Model | Cost | Speed | Used For | Why |
|-------|------|-------|----------|-----|
| **Opus** | $$$ | Slow | Architect, UI Architect, Designer, Auditors | Deep analysis, design decisions. A shallow spec wastes all downstream work. |
| **Sonnet** | $$ | Fast | Coder, Reviewer, Fixer, Advocates, Skeptic | Follows clear instructions. Specs provide the reasoning; sonnet executes. |
| **Haiku** | $ | Very fast | Watcher, CLAUDE.md Updater | Simple conditional logic. Watch a PR, update a file. |

## Naming Convention

Agent names encode the issue number:

```
WOP-81 → architect-81 → coder-81 → reviewer-81 → fixer-81 → watcher-81
WOP-462 → architect-462 → ui-architect-462 → designer-462 → reviewer-462
```

This makes it instantly clear which agent owns which issue in the pipeline state table.

## Team Coordination

WOPR uses Claude Code's Team tool for multi-agent coordination:

```
TeamCreate({ team_name: "wopr-auto", description: "WOPR continuous pipeline" })
```

Agents communicate with the pipeline lead via:
```
SendMessage({ type: "message", recipient: "team-lead", content: "Spec ready: WOP-81" })
```

The pipeline lead receives messages and reacts (spawn next agent, shutdown previous, fill slots).

Shutdown:
```
SendMessage({ type: "shutdown_request", recipient: "architect-81", content: "Spec posted, shutting down" })
```

At session end:
```
TeamDelete()
```

## Pipeline Lead

The pipeline lead is NOT a spawned agent — it's the main Claude Code session. It:
- Manages the pipeline state table
- Receives messages from all agents
- Makes spawn/shutdown decisions
- Handles backpressure and stuck detection
- Reports progress to the human

The human's role: set priorities, handle escalations, approve destructive operations. The pipeline lead handles everything else.
