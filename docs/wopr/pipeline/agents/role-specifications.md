# Agent Role Specifications — The WOPR Implementation

> Implements: [method/pipeline/agents/role-specifications.md](../../../method/pipeline/agents/role-specifications.md)

---

## How DEFCON Defines Roles

There are no separate agent types in DEFCON. There are no `wopr-architect`, `wopr-coder`, or `wopr-reviewer` agent definitions. Roles are states in the flow, not separate agents.

An engineering worker is the architect, coder, reviewer, fixer, and merger. These are tasks within one discipline. The worker owns one entity end-to-end via sequential `flow.report` calls. The state changes; the worker does not.

The prompt template on each state IS the agent definition. No external files. No `~/.claude/agents/wopr/` directory.

---

## State-to-Role Mapping

| State | Model Tier | Mode | Who provides the prompt |
|-------|-----------|------|------------------------|
| `backlog` | — | passive | No prompt — waiting for `start` signal |
| `architecting` | opus | active | `state_definitions[].promptTemplate` in seed |
| `coding` | sonnet | active | `state_definitions[].promptTemplate` in seed |
| `reviewing` | sonnet | active | `state_definitions[].promptTemplate` in seed |
| `fixing` | sonnet | active | `state_definitions[].promptTemplate` in seed |
| `merging` | haiku | active | `state_definitions[].promptTemplate` in seed |
| `stuck` | — | passive | No prompt — human intervention required |
| `done` | — | passive | Terminal state |

`modelTier` is used in **active mode** — when DEFCON spawns agents autonomously. In passive mode, the worker's model is whatever the caller is running.

---

## Active vs Passive Mode

**Active mode** (`mode: "active"`): DEFCON spawns a Claude Code session with the rendered prompt. The `modelTier` field determines which model.

**Passive mode** (`mode: "passive"`): DEFCON waits for a worker to call `flow.claim`. The state has no promptTemplate — it's a gate or waiting state.

---

## Model Selection Rationale

| Model Tier | Cost | Speed | Used For | Why |
|-----------|------|-------|----------|-----|
| **opus** | $$$ | Slow | `architecting` | Deep analysis and design decisions. A shallow spec wastes all downstream work. |
| **sonnet** | $$ | Fast | `coding`, `reviewing`, `fixing` | Follows clear instructions. Specs provide the reasoning; sonnet executes. |
| **haiku** | $ | Very fast | `merging` | Simple conditional logic: watch a PR, report the result. |

---

## Team Coordination

Workers communicate with the pipeline lead via `SendMessage`:

```
SendMessage({ type: "message", recipient: "team-lead", content: "Spec ready: WOP-81" })
```

The pipeline lead is the main Claude Code session or DEFCON's active runner. It receives messages and coordinates entity advancement.

---

## Pipeline Lead

In passive mode (human-driven): the pipeline lead is the main Claude Code session. It interacts with DEFCON via MCP tools (`flow.claim`, `flow.report`) or REST API. It does not manage an in-memory state table — entity state lives in the database.

In active mode (DEFCON-driven): DEFCON itself is the pipeline lead. It spawns agents based on `modelTier`, routes signals, and advances entities automatically.

The human's role in both modes: set priorities in Linear, handle escalations, approve destructive operations.
