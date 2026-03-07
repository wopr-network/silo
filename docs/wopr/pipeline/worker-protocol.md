# Worker Protocol — DEFCON Implementation

The concrete implementation of the [worker protocol](../../method/pipeline/worker-protocol.md) in DEFCON.

---

## The Two MCP Tools

DEFCON exposes the worker protocol as two MCP tools:

### `flow.claim`

```json
{
  "workerId": "wkr_abc123",
  "agentRole": "reviewer"
}
```

Both fields are optional. If `workerId` is omitted, DEFCON auto-registers a new worker and returns the ID in the response — the worker must carry it forward on every subsequent call.

`agentRole` filters claims to invocations matching that role. Omit to claim any available work.

**Response (work available):**
```json
{
  "entityId": "feat-392",
  "invocationId": "inv_xyz",
  "stage": "reviewing",
  "prompt": "Check CI on the PR at https://github.com/...",
  "workerId": "wkr_abc123"
}
```

**Response (no work available):**
```json
{
  "workerId": "wkr_abc123",
  "invocation": null
}
```

**Response (first call, no workerId provided):**
```json
{
  "entityId": "feat-392",
  "invocationId": "inv_xyz",
  "stage": "reviewing",
  "prompt": "...",
  "workerId": "wkr_abc123",
  "worker_notice": "No workerId provided. A worker has been registered for you. YOU MUST pass workerId: \"wkr_abc123\" in all future flow.claim and flow.report calls. Omitting it will generate a new worker each time."
}
```

---

### `flow.report`

```json
{
  "workerId": "wkr_abc123",
  "entityId": "feat-392",
  "signal": "clean",
  "artifacts": {
    "prUrl": "https://github.com/...",
    "reviewSummary": "All checks pass."
  }
}
```

**This call blocks until the gate resolves.** Do not set a short timeout on the MCP client. The call will return when it has something definitive to say — which may take milliseconds or many minutes.

**Response — gate passed (`continue`):**
```json
{
  "next_action": "continue",
  "new_state": "merging",
  "prompt": "Enter merge queue. Report 'merged' when done."
}
```

**Response — gate failed (`waiting`):**
```json
{
  "next_action": "waiting",
  "gated": true,
  "gateName": "ci-gate",
  "gate_output": "Tests failed: 3 assertions in auth.test.ts",
  "message": "CI failed on https://github.com/... The gate output was:\n\nTests failed: 3 assertions in auth.test.ts\n\nThis entity is now gated. Do not retry — wait to be reclaimed when the failures are addressed."
}
```

Stop. Do not retry. Wait for reclaim. The `message` is rendered from the gate's `failure_prompt`. If no `failure_prompt` is configured, `message` is omitted and only `gate_output` is returned.

**Response — gate timed out (`check_back`):**
```json
{
  "next_action": "check_back",
  "message": "Your report was received. The gate is still evaluating — this is not an error. Call flow.report again with the same arguments after a short wait.",
  "retry_after_ms": 30000
}
```

Call `flow.report` again with the same `entityId`, `signal`, and `artifacts` after `retry_after_ms`. No state is lost.

---

## Worker Identity and Idle Reaping

Every `flow.claim` and `flow.report` call resets the worker's idle timer. These calls are the heartbeat. No separate keepalive is needed.

If a worker goes idle (no claim or report for longer than its `idle_timeout_ms`), DEFCON releases its held claims so other workers can pick them up.

`idle_timeout_ms` is configured per worker:
- Automated agent loops: default 60s
- Human/Claude Code sessions: default 1800s (30 min)

Workers created via `defcon worker new` (CLI) or auto-registered on first claim use the appropriate default based on context.

---

## Gate Configuration

Gates are defined in the flow seed file. All three prompt types are configurable at gate and flow level:

```json
{
  "id": "my-pipeline",
  "gate_timeout_ms": 600000,
  "failure_prompt": "A gate failed. The entity is now gated — do not retry. Wait to be reclaimed.",
  "timeout_prompt": "The gate is still evaluating. Review any open questions on this entity and add notes. Then call flow.report again with the same arguments.",
  "states": [
    {
      "name": "reviewing",
      "transitions": [
        {
          "on": "clean",
          "to": "merging",
          "gates": [
            {
              "name": "merge-queue-gate",
              "type": "shell",
              "command": "gh pr checks {{entity.artifacts.prNumber}} --repo {{entity.refs.github.repo}} --watch",
              "timeout_ms": 1200000,
              "failure_prompt": "The merge queue failed for {{entity.artifacts.prUrl}}. Output:\n\n{{gate.output}}\n\nThe entity is gated — check if CI failed on the merge commit or if there are conflicts. Do not retry.",
              "timeout_prompt": "The merge queue is still running for {{entity.artifacts.prUrl}}. No action needed — call flow.report again with the same signal after the retry delay."
            }
          ]
        }
      ]
    }
  ]
}
```

### Timeout resolution order

1. Gate `timeout_ms` — if set on the gate
2. Flow `gate_timeout_ms` — if set on the flow
3. `DEFCON_DEFAULT_GATE_TIMEOUT_MS` env var
4. System default: 300000ms (5 minutes)

### Prompt resolution order (same for all three prompt types)

| Prompt type | Gate field | Flow field | System default |
|---|---|---|---|
| Pass | — | — | Next state's `promptTemplate` (always) |
| Fail | `failure_prompt` | `failure_prompt` | Raw `gate_output` only, no `message` |
| Timeout | `timeout_prompt` | `timeout_prompt` | "Not an error, call again" |

All prompt templates are Handlebars and share the same context: `entity` (fields + refs + artifacts), `gate` (name, output), `flow` (name, config).

---

## Three Outcomes — Decision Table

| Gate result | `next_action` | Prompt source | Worker should |
|---|---|---|---|
| Resolved true | `continue` | Next state's `promptTemplate` | Keep going |
| Resolved false | `waiting` | Gate/flow `failure_prompt` | Stop — do not retry |
| Timed out | `check_back` | Gate/flow `timeout_prompt` | Do timeout work, call report again |

**Pass** — the flow decides what comes next. The worker receives the next state's rendered prompt and continues.

**Fail** — the flow author decides what the worker should know. A good `failure_prompt` names the gate, quotes the output, and explicitly says "do not retry." Without it, the worker gets raw output and has to infer.

**Timeout** — the flow author decides what the worker should do while waiting. A good `timeout_prompt` gives the worker real work, not just "try again." Without it, the worker gets a generic message.

`waiting` is not a failure of the worker. It means a real problem was found. A fresh worker with a full context window will handle it when something changes. Stopping is the correct response — running burns context on work that cannot advance the entity.

`check_back` is not an error. The gate is still running. The report was received. Call again after `retry_after_ms`.

---

## Why `flow.report` Blocks

The blocking behavior is deliberate and load-bearing.

When `flow.report` blocks, the worker's context window is occupied by the current task. It cannot be reassigned. It cannot drift. It is waiting for a definitive answer before deciding what to do next.

When `flow.report` returns, the answer is final. Pass, fail, or check-back — there is no ambiguous state. The worker acts on it immediately.

If `flow.report` were non-blocking — if it returned "submitted, check back later" — the worker would need to manage its own retry state, decide how often to poll, and handle the case where it's been reassigned in the meantime. All of that complexity is eliminated by blocking. The call is simple because the semantics are simple: wait until there's an answer, then act on it.

The MCP client must not apply a short HTTP timeout to `flow.report`. The stdio transport has no timeout by default. For HTTP/SSE transports, configure an explicit long timeout (24h is safe) on this tool specifically.

---

## Spawning a Claude Code Session as a Worker

```bash
defcon worker new --role reviewer --idle-timeout 1800
```

This registers a new worker and opens a Claude Code session with a rendered prompt:

```
You are DEFCON worker wkr_abc123. Role: reviewer.
Connected to DEFCON at <mcpUrl> via MCP.

Use flow.claim to pick up available work, perform the task, then use
flow.report to submit your result. Pass your workerId in every call.

Keep claiming until no work is available or you are told to stop.
```

The human drives the session. DEFCON sees a registered worker. The claim/report protocol is identical to any other worker. The pipeline does not know or care that there's a human making the decisions.

This is the mechanism for human-in-the-loop stages: define a stage with `agentRole: "human-reviewer"`, assign workers with that role to human sessions, and those stages will only be claimed by humans. The gate still runs. The escalation still holds. The human is just the one doing the work.
