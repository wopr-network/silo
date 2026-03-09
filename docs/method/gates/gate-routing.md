# Gate Routing

How gates make routing decisions — directing entities to different states based on evidence, not just pass/fail.

> WOPR implementation: [docs/wopr/gates/gate-routing.md](../../wopr/gates/gate-routing.md)

---

## Beyond Pass/Fail

The basic gate model has three outcomes: pass, fail, timeout. This covers verification — did the work meet the bar? But many gates evaluate evidence that implies more than a binary answer.

A merge-queue gate doesn't just pass or fail. The PR might be merged (success), blocked (needs fixes), or closed (abandoned). Each is a different routing decision. A CI gate doesn't just pass or fail. CI might be green with bots posted (ready for review), or CI might be red (needs fixes — skip review entirely). Forcing these into pass/fail either loses information or wastes agent invocations.

A **routing gate** evaluates evidence and directs the entity to one of N possible states based on what it finds.

---

## The Outcome Map

A gate definition includes an optional `outcomes` map: named outcomes mapped to routing decisions.

```json
{
  "name": "review-bots-ready",
  "type": "command",
  "command": "gates/review-bots-ready.sh {{entity.artifacts.prNumber}} {{entity.refs.github.repo}}",
  "timeoutMs": 1800000,
  "outcomes": {
    "ready":     { "proceed": true },
    "ci_failed": { "toState": "fixing" }
  }
}
```

Each outcome entry has one of:

| Key | Meaning |
|-----|---------|
| `proceed: true` | Continue to the transition's original `toState` |
| `toState: "X"` | Redirect the entity to state X instead |

The gate script signals its outcome by emitting a JSON object as the last line of stdout:

```json
{"outcome": "ci_failed", "message": "checks lint, test failed on PR #456"}
```

The engine parses the last non-empty line of gate output. If it's valid JSON with an `outcome` field, the engine looks up that outcome in the gate's outcome map. If the outcome maps to a `toState`, the entity is redirected. If it maps to `proceed: true`, the original transition continues. If the outcome isn't found in the map, the gate falls back to the standard three-outcome model based on exit code.

---

## The Routing Decision Flow

```
Gate script runs
  → stdout last line is JSON with "outcome" field?
    → YES: look up outcome in gate.outcomes map
      → outcome has toState?    → REDIRECT to that state
      → outcome has proceed?    → PROCEED to transition.toState
      → outcome not in map?     → fall through to exit code
    → NO: use exit code
      → exit 0?                 → PASS (proceed to transition.toState)
      → exit 1?                 → FAIL (block)
      → killed by timeout?      → TIMEOUT (check_back)
```

This means:
- **Every existing gate works unchanged.** No outcome map = pure pass/fail/timeout.
- **Routing is opt-in.** Add an `outcomes` map when the gate knows more than yes/no.
- **The gate script decides.** The engine just follows the map.

---

## When to Use Routing Gates

Use a routing gate when **the gate's evidence implies a routing decision that an agent would make deterministically**.

| Scenario | Simple gate | Routing gate |
|----------|-------------|--------------|
| CI red on PR | Block. Entity stays. Needs reclaim. | Route to `fixing` with failure details. No reviewer wasted. |
| PR merged | Pass. Continue. | `merged` → `done`. `blocked` → `fixing`. `closed` → `stuck`. |
| Spec missing | Block. | Block (same — there's no alternative route). |

The test: **if an agent would receive this gate's failure and always make the same decision**, the gate should make that decision directly. The reviewer that says "ISSUES: CI failed" every time CI is red is a deterministic function of the gate's output. Replace the agent with a gate route.

---

## The Philosophical Point

A routing gate is the strongest expression of the core principle: **agents should spend tokens on reasoning, not on routing decisions the system already knows the answer to.**

Every agent invocation that produces a deterministic output given its input is a candidate for replacement by a gate route. The merge watcher that polls until merged and says "Merged: url" — that's a gate. The reviewer that sees red CI and says "ISSUES: CI failed" — that's a gate. The fixer that sees an unresolvable conflict and says "cant_resolve" — that might genuinely require agent judgment, so it stays as an agent.

The flow engineer's job is to push deterministic decisions into gates and reserve agent invocations for genuine reasoning. Routing gates are the mechanism for this.

---

## Gate Script Contract for Routing

A routing gate script must:

1. **Emit the outcome as the last line of stdout** — JSON object with `outcome` field
2. **Include a human-readable `message`** — this gets logged and may appear in prompts
3. **Exit with a sensible code** — exit 0 for "good" outcomes, exit 1 for "bad" ones (used as fallback if outcome parsing fails)

```bash
#!/bin/sh
# Example: review-bots-ready.sh with routing outcomes

# ... check CI status ...

if [ "$FAILED" -gt "0" ]; then
  echo "{\"outcome\":\"ci_failed\",\"message\":\"$FAILED check(s) failing on PR #$PR_NUMBER\"}"
  exit 1
fi

# ... check bot comments ...

if [ "$BOT_COUNT" -gt "0" ]; then
  echo "{\"outcome\":\"ready\",\"message\":\"CI green, $BOT_COUNT bot comments posted\"}"
  exit 0
fi

# No bots yet — let the timeout handle check_back
echo "Waiting for review bots..." >&2
exit 0
```

---

## Relationship to Failure Prompts

Routing and failure prompts serve different purposes:

| Mechanism | When | Purpose |
|-----------|------|---------|
| Outcome routing | Gate resolved with a named outcome | Route entity to the correct next state |
| Failure prompt | Gate failed (no matching outcome) | Tell the current worker what went wrong |
| Timeout prompt | Gate didn't resolve in time | Tell the worker what to do while waiting |

A routed outcome (e.g. `ci_failed → fixing`) does NOT use the failure prompt. The entity transitions to `fixing` and the fixer receives that state's prompt template — with the gate's message available in artifacts. The failure prompt fires only when the gate fails without a matching named outcome.

This means: if every failure mode has a named outcome with a route, the failure prompt is never used. The gate handles all routing. The failure prompt is the fallback for unexpected failures.

---

## Cross-References

- [gate-taxonomy.md](gate-taxonomy.md) — the three-outcome model and gate categories
- [worker-protocol.md](../pipeline/worker-protocol.md) — how workers respond to gate outcomes
- [pipeline-schema.md](../pipeline/pipeline-schema.md) — where gates attach to transitions in the state machine
