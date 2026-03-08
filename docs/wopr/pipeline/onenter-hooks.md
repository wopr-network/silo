# onEnter Hooks — The WOPR Implementation

> Implements: [method/pipeline/onenter-hooks.md](../../method/pipeline/onenter-hooks.md)

---

## What onEnter Does

When an entity enters a state, DEFCON can run a setup command before the state becomes claimable. The output is merged into `entity.artifacts`. Only after this succeeds does the state appear in claim results.

This is how the coding worktree is created automatically before any worker receives the coding prompt.

---

## Schema

```json
{
  "onEnter": {
    "command": "scripts/create-worktree.sh {{entity.refs.github.repo}} {{entity.refs.linear.key}}",
    "artifacts": ["worktreePath", "branch"],
    "timeout_ms": 60000
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Shell command. Handlebars-rendered against entity context. |
| `artifacts` | yes | Keys to extract from stdout (parsed as JSON). Merged into `entity.artifacts`. |
| `timeout_ms` | no | Max runtime in ms. Defaults to system-wide `DEFCON_ONENTER_TIMEOUT_MS`. |

The command must write a JSON object to stdout containing at minimum the keys listed in `artifacts`. Additional keys in the output are ignored.

---

## Idempotency

onEnter is skipped if all named `artifacts` already exist on the entity. This means re-entering a state (e.g., after a gate failure) does not re-run setup. The worktree is created once and reused.

---

## Error Handling

If the command fails (non-zero exit code) or times out:

- DEFCON records `onEnter_error` in `entity.artifacts` with the command output and error message
- DEFCON emits an `onEnter.failed` event
- The entity is held in the entering state — it does not become claimable
- An alert is sent to the pipeline lead for manual intervention

The entity remains in a "pending" sub-state until a human resolves the issue (usually by running the command manually and patching the artifacts).

---

## WOPR Usage: Worktree Creation

The `architecting` state uses `onEnter` to provision a git worktree before the architect agent claims the entity. The live configuration in `seeds/wopr-changeset.json`:

```json
{
  "name": "architecting",
  "flowName": "wopr-changeset",
  "onEnter": {
    "command": "node $CLI provision-worktree {{entity.refs.github.repo}} {{entity.refs.linear.key}} --base-path /data/worktrees --clone-root /data/repos | node -e \"...tail-scanner...\"",
    "artifacts": ["codebasePath", "worktreePath", "branch"],
    "timeout_ms": 120000
  }
}
```

When an entity enters `architecting`, DEFCON runs `provision-worktree wopr-network/wopr WOP-392`, which clones the repo (or reuses an existing clone under `/data/repos`) and creates a worktree under `/data/worktrees`. It returns:

```json
{
  "worktreePath": "/data/worktrees/wopr-wopr-coder-392",
  "codebasePath": "/data/worktrees/wopr-wopr-coder-392",
  "branch": "agent/coder-392/wop-392"
}
```

DEFCON merges these into `entity.artifacts`. The architect's `promptTemplate` can then reference:

```
Codebase (READ ONLY): {{entity.artifacts.codebasePath}}
```

The agent never runs `git worktree add` or `git clone`. The worktree arrives ready.

### stdout contamination

`provision-worktree` internally runs `pnpm install`, which writes progress lines to stdout alongside the final JSON result. Naive JSON parsing fails because the output is not pure JSON.

Fix: pipe through a tail-scanner that scans lines from the end and returns the first valid JSON object:

```bash
provision-worktree ... | node -e "
let d='';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  const lines = d.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const r = JSON.parse(lines[i]); process.stdout.write(JSON.stringify(r)); return; }
    catch(e) {}
  }
  process.exit(1);
});
"
```

Apply this same pattern to any onEnter command that invokes a package manager.

---

## Why onEnter, Not Gate

onEnter is distinct from gates:

| | Gate | onEnter |
|---|---|---|
| Position | On a transition, AFTER the entity leaves a state | On a state definition, BEFORE first claim |
| Purpose | Validate that work completed correctly | Set up environment for upcoming work |
| Outcome | pass/fail/timeout → advance, gate, or retry | success → claimable; failure → held |
| Blocks | Transition to next state | Entry into current state |

Gates block leaving a state. onEnter blocks entering a state.

---

See [../../method/gates/gate-taxonomy.md](../../method/gates/gate-taxonomy.md) for the full method-level description of state lifecycle hooks.

See [pipeline-schema.md](pipeline-schema.md) for how onEnter fits into the state machine definition.
