# The Worker Protocol

How agents participate in a gated pipeline — the claim/report contract, gate semantics, and why blocking is correct.

---

## The Two-Call Contract

Every agent in a gated pipeline does the same thing regardless of what stage it's in:

1. **Claim** — announce readiness, receive work
2. **Report** — submit output, receive verdict

That's the entire surface area. The agent never knows the flow definition. Never knows what state comes next. Never decides if its output is good enough. It does work and reports what happened. The pipeline decides what to do with that.

This is not a limitation. It's the point. An agent that knows "if I say X, we skip the gate" is an agent that will eventually say X. An agent that can only report what it did — and then wait — cannot cheat the escalation.

---

## Workers

Any process that can make two calls is a valid worker:

- An autonomous agent loop polling for work
- A human-in-the-loop agent session where a human reviews each step
- A shell script
- A curl command

The pipeline doesn't distinguish. A human-driven session that calls claim and report is architecturally identical to an autonomous agent doing the same. Both speak the same protocol. Both are subject to the same gates.

This is the key property that separates this model from traditional worker queues: **workers can be humans**. A human saying "I'll take this one" is the same as an agent saying it. The claim is the claim.

### Worker Identity

Workers identify themselves with a `workerId`. This enables:

- Idle detection (has this worker gone silent?)
- Claim attribution (who holds this work?)
- Dead worker reaping (release claims when a worker disappears)

The `workerId` is obtained on first claim — if none is provided, one is minted and returned. The worker must carry it forward on every subsequent call. Each call resets the idle timer. **The calls are the heartbeat.** No separate keepalive mechanism is needed.

Idle timeout is configured per worker at registration time, not globally. A human reviewer might need 30 minutes between calls. An automated agent loop might need 60 seconds. Same reaping logic, different patience.

---

## Gate Semantics

A gate is a check that runs at a pipeline boundary. It has exactly three outcomes — and each one has a different prompt source:

| Outcome | `next_action` | Prompt source |
|---|---|---|
| Gate passed | `continue` | Next state's `promptTemplate` — derived from the flow |
| Gate failed | `waiting` | Gate's `failure_prompt` — written by the flow author |
| Gate timed out | `check_back` | Gate's `timeout_prompt` — written by the flow author |

The pass case requires no configuration. The next state already has a prompt template. The pipeline renders it and returns it. The flow author has nothing to add — the flow itself defines what work comes next.

The fail and timeout cases are different. The engine knows the gate failed or timed out, but it doesn't know what that means in the context of this specific pipeline. That's what `failure_prompt` and `timeout_prompt` are for: the flow author's instructions to the worker about what just happened and what to do next.

### 1. Pass — `continue`

The gate resolved affirmatively. The entity advances. The worker receives the next stage's prompt — rendered from the next state's `promptTemplate` — and should keep going.

### 2. Fail — `waiting`

The gate resolved negatively. The entity stays where it is. The worker should **stop**.

The response includes a `message` rendered from the gate's `failure_prompt`. A well-written failure prompt tells the worker exactly what failed, what it means, and — critically — that it should stop and not retry. Without a failure prompt, the worker receives a raw gate output dump and has to infer what to do. With one, the flow author controls the narrative.

`waiting` is not a failure of the worker. It means the gate found a real problem — something that needs to change before this entity can advance. The right response is to do nothing. The entity will be reclaimed by a fresh worker when something external changes (a human intervenes, a dependency ships, a blocking issue is resolved).

**Why stopping is correct:** A worker that keeps running after a gate failure burns context on work that cannot be used. A fresh worker, with a full context window, will do better work when the time comes. `waiting` is the pipeline conserving resources for when they're actually needed.

### 3. Timeout — `check_back`

The gate did not resolve within its configured window. **This is not an error.** The gate is still running. The worker's report was received.

The response includes a `message` rendered from the gate's `timeout_prompt`. A well-written timeout prompt gives the worker real work to do while it waits — not busywork, but something useful like reviewing a diff or checking related issues. Without a timeout prompt, the worker gets a generic "try again" message.

The worker calls report again with the same arguments after the suggested delay. The gate will either have resolved by then, or the worker will receive another `check_back`.

---

## The Blocking Call

The report call blocks until the gate resolves. This is intentional.

The worker waits on the call. It does not poll. It does not retry. It sits there until the gate finishes — whether that takes 200 milliseconds or 8 minutes. When the response arrives, it contains a definitive answer.

The gate's `timeout_ms` is the maximum wait ceiling, not an expected duration. A gate configured for 10 minutes that resolves in 8 returns success at the 8-minute mark. A gate that hasn't resolved at 10 minutes returns `check_back`. Either way, the call returns when there's something to say.

```
Gate resolves in 8 min, timeout is 10 min  →  returns continue at 8 min
Gate resolves in 12 min, timeout is 10 min →  returns check_back at 10 min
Gate resolves in 200ms, timeout is 10 min  →  returns continue at 200ms
```

Set `timeout_ms` to the maximum time you are willing to wait, not an estimate of how long the gate usually takes.

---

## Token Economics

Gates save tokens by preventing wasted work.

When a gate fails, the worker stops. This is good. The alternative — continuing to run, re-reading the codebase, trying variations, re-attempting the blocked step — burns tokens on work that cannot advance the entity. None of that output can be used. It's waste.

When a gate passes, the pipeline hands the worker the next prompt with full context already loaded. The worker's context window is spent on productive work from the first token.

When a gate times out, the `check_back` response can include a `timeout_prompt` — instructions for what the worker should do while waiting. A well-designed timeout prompt turns idle time into useful work: pre-reviewing a diff, writing notes, checking related issues. The worker is never just burning tokens on hold.

The protocol is designed around the insight that **a stopped worker costs nothing, and a fresh worker does better work than an exhausted one**.

---

## Configuring Timeouts

Timeouts are configurable at two levels:

**Gate level** — how long this specific gate waits before returning `check_back`. Use for gates with known duration characteristics (a security scanner that always takes 20 minutes).

**Flow level** — the default for all gates in the flow. Use to tune the pipeline for its environment (a fast CI environment vs a slow one).

Gate-level overrides flow-level. Flow-level overrides the system default.

### Timeout Prompts

Gates and flows can define a `timeout_prompt` — what the worker should do during a `check_back`. This is a prompt template with access to the same context as the stage prompt.

A good timeout prompt gives the worker real work, not busywork. "While CI runs, review the diff and note any concerns you'd raise regardless of CI outcome" is useful. "Wait and try again" is not.

---

## Why This Model Works

Traditional pipeline models push work to workers — the scheduler assigns tasks, workers execute, results come back. The worker is passive.

This model inverts that. Workers pull work via claim. Gates pull verdicts via report. Nothing is pushed. The worker is always in control of when it's ready to receive work and when it has something to report.

That inversion makes workers composable. A human, an agent, a script — all can participate in the same pipeline because they all speak the same two-call protocol. The pipeline doesn't care what's on the other end of the call. It cares that the call is made.

See [WOPR implementation](../../wopr/pipeline/worker-protocol.md) for concrete schema and configuration.
