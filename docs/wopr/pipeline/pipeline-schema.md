# Pipeline Schema — The WOPR Implementation

> Implements: [method/pipeline/pipeline-schema.md](../../method/pipeline/pipeline-schema.md)

---

## WOPR's State Machine

WOPR's pipeline state lives in DEFCON's SQLite database, not in session memory. The state machine is defined by four tables:

| Table | Purpose |
|-------|---------|
| `flow_definitions` | Flow-level config: `discipline`, `maxConcurrent`, `maxConcurrentPerRepo`, `initialState` |
| `state_definitions` | Per-state config: `modelTier`, `mode`, `promptTemplate`, `onEnter` |
| `transition_rules` | Edges: `from_state`, `signal`, `to_state`, `gates[]` |
| `gate_definitions` | Gate scripts, timeouts, `failurePrompt`, `timeoutPrompt` |
| `entities` | Runtime state: one row per issue in the pipeline |
| `invocations` | One row per active work assignment (claim → report cycle) |

There is no in-memory pipeline state table. The database is the single source of truth. Sessions can crash and restart; entities persist.

---

## State Transitions

State transitions are driven by `flow.report`. The claim/report cycle is:

```
flow.claim({ workerId: "wkr_abc123", role: "engineering" })
  → returns entity + rendered prompt for current state

[worker performs work]

flow.report({ workerId: "wkr_abc123", entityId: "feat-392", signal: "spec_ready" })
  → DEFCON evaluates gates on the transition
  → if gates pass: entity advances to next state, returns next prompt
  → if gate fails: entity enters "waiting", returns failure_prompt
  → if gate times out: returns timeout_prompt + retry_after_ms
```

One worker claim covers the entire entity lifecycle. The worker keeps calling `flow.report` as states advance. No re-claim between states.

---

## State Definitions

States are defined in `seeds/wopr-changeset.json`. Each state has:

```json
{
  "name": "architecting",
  "flowName": "wopr-changeset",
  "modelTier": "opus",
  "mode": "active",
  "promptTemplate": "Your name is \"architect-{{entity.refs.linear.id}}\"...",
  "onEnter": {
    "command": "scripts/create-worktree.sh {{entity.refs.github.repo}} {{entity.refs.linear.key}}",
    "artifacts": ["worktreePath", "branch"],
    "timeout_ms": 60000
  }
}
```

Key fields:

| Field | Purpose |
|-------|---------|
| `modelTier` | Model DEFCON spawns in active mode (`opus`, `sonnet`, `haiku`) |
| `mode` | `active` (DEFCON spawns agent) or `passive` (worker must claim) |
| `promptTemplate` | Handlebars template — the rendered text IS the agent's instructions |
| `onEnter` | Command that runs before the state becomes claimable |

**`modelTier` is for active mode only.** It tells DEFCON what model to spawn autonomously. Passive workers use whatever model they are running.

---

## Worktree Creation via onEnter

Worktrees are created by DEFCON's `onEnter` hook on the `coding` state — not by the pipeline lead manually. When an entity enters `coding`:

1. DEFCON runs `scripts/create-worktree.sh <repo> <linear-key>`
2. The script creates the worktree and returns JSON: `{ "worktreePath": "...", "branch": "..." }`
3. DEFCON merges these into `entity.artifacts`
4. The `coding` promptTemplate receives `{{entity.artifacts.worktreePath}}` and `{{entity.artifacts.branch}}` already populated

The worker never needs to create the worktree. It arrives ready.

See [onenter-hooks.md](onenter-hooks.md) for full onEnter documentation.

---

## Agent Naming

Agent names are derived from entity refs in the prompt template:

```
"Your name is \"architect-{{entity.refs.linear.id}}\""
"Your name is \"coder-{{entity.refs.linear.id}}\""
```

The pipeline lead does not name agents. The seed defines the naming convention via Handlebars. This makes it clear which agent owns which entity without any manual bookkeeping.

---

## Worktree Naming Convention

The `create-worktree.sh` script creates worktrees following this pattern:

```
/home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM>
```

Branch naming:
```
agent/coder-<ISSUE_NUM>/<issue-key-lowercase>
```

---

## Concurrency

Concurrency is configured on the flow definition in the seed file:

```json
{
  "name": "wopr-changeset",
  "discipline": "engineering",
  "maxConcurrent": 4,
  "maxConcurrentPerRepo": 4
}
```

`maxConcurrent` — maximum entities in non-passive states simultaneously across all repos.
`maxConcurrentPerRepo` — cap per repo (prevents overwhelming a single repo's CI/review queue).

There is no `/wopr:auto max=4` argument. Concurrency is configuration, not a runtime argument.

---

## Merge Strategy by Repo

| Repo | Merge Queue | Strategy | Required Checks |
|------|-------------|----------|----------------|
| wopr | Yes (GitHub native) | Squash | Lint and Type Check, Build, Test |
| wopr-platform | Yes (ruleset ID 12966480) | Squash | CI checks |
| wopr-plugin-* | No | `gh pr merge --squash --auto` | Varies (some have `ci` check with null app_id → use `--admin`) |
| wopr-plugin-types | No | `gh pr merge --squash --admin` | `ci` check has null app_id |

The `merge-queue` gate in the seed handles waiting for the merge queue to resolve:

```json
{
  "name": "merge-queue",
  "type": "command",
  "command": "gates/merge-queue.sh {{entity.artifacts.prNumber}} {{entity.refs.github.repo}}",
  "timeoutMs": 1800000,
  "failurePrompt": "PR #{{entity.artifacts.prNumber}} failed in the merge queue..."
}
```

---

## Seed File Reference

The canonical seed is at `seeds/wopr-changeset.json`. It defines:

- The `wopr-changeset` flow with `discipline: "engineering"`
- All states: `backlog`, `architecting`, `coding`, `reviewing`, `fixing`, `merging`, `stuck`, `done`
- All gates: `spec-posted`, `ci-green`, `review-bots-ready`, `merge-queue`
- Transition rules connecting states via signals

See [disciplines.md](disciplines.md) for the discipline model.
See [worker-protocol.md](worker-protocol.md) for the claim/report protocol.
See [onenter-hooks.md](onenter-hooks.md) for state lifecycle hooks.
