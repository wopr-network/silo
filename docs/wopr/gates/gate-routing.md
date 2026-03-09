# Gate Routing — WOPR Implementation

How WOPR uses outcome-based gate routing to eliminate unnecessary agent invocations.

> Method: [docs/method/gates/gate-routing.md](../../method/gates/gate-routing.md)

---

## Implementation

Gate routing is implemented in `src/engine/gate-evaluator.ts` and `src/engine/engine.ts`.

### Gate Evaluator (`gate-evaluator.ts`)

`evaluateGate()` runs the gate command and parses the last non-empty line of stdout for structured JSON:

```typescript
const lastLine = result.output.split("\n").map(l => l.trim()).filter(Boolean).at(-1);
if (lastLine?.startsWith("{")) {
  const parsed = JSON.parse(lastLine);
  if (typeof parsed.outcome === "string") {
    return { passed, timedOut, output, outcome: parsed.outcome, message: parsed.message };
  }
}
```

The `GateEvalResult` interface includes optional `outcome` and `message` fields:

```typescript
interface GateEvalResult {
  passed: boolean;
  timedOut: boolean;
  output: string;
  outcome?: string;   // Named outcome from JSON output
  message?: string;   // Human-readable message
}
```

### Engine Routing (`engine.ts`)

`resolveGate()` returns a discriminated union with three kinds:

```typescript
| { kind: "proceed"; gatesPassed: string[] }
| { kind: "redirect"; toState: string; trigger: string; gatesPassed: string[] }
| { kind: "block"; gateTimedOut: boolean; gateOutput: string; ... }
```

The routing logic:

1. Evaluate the gate → get `GateEvalResult`
2. Look up `gateResult.outcome` in `gate.outcomes` map
3. If outcome has `toState` → return `redirect`
4. If outcome has `proceed: true` → return `proceed`
5. If no named outcome matches, fall back to pass/fail based on exit code

The caller (`report()`) handles the redirect:

```typescript
const toState = routing.kind === "redirect" ? routing.toState : transition.toState;
const trigger = routing.kind === "redirect" ? routing.trigger : signal;
```

A redirected transition uses `gate:{gateName}:{outcome}` as its trigger for event logging.

### Schema (`zod-schemas.ts`)

```typescript
const GateOutcomeSchema = z.object({
  proceed: z.boolean().optional(),
  toState: z.string().min(1).optional(),
});

const BaseGateSchema = z.object({
  // ...
  outcomes: z.record(z.string(), GateOutcomeSchema).optional(),
});
```

### Domain Events

Gate routing emits `gate.redirected`:

```typescript
{ type: "gate.redirected", entityId, gateId, outcome, toState, emittedAt }
```

This is distinct from `gate.passed` and `gate.failed` — it represents a routing decision, not a simple pass/fail.

---

## Current Usage: merge-queue

The `merge-queue` gate in `seed/flows.json` uses outcome routing:

```json
{
  "name": "merge-queue",
  "type": "command",
  "command": "gates/merge-queue.sh {{entity.artifacts.prNumber}} {{entity.refs.github.repo}}",
  "timeoutMs": 1800000,
  "outcomes": {
    "merged":  { "proceed": true },
    "blocked": { "toState": "fixing" },
    "closed":  { "toState": "stuck" }
  }
}
```

The gate script (`gates/merge-queue.sh`) emits:
- `{"outcome":"merged","message":"PR #N merged successfully"}` → entity proceeds to `done`
- `{"outcome":"blocked","message":"PR #N is blocked"}` → entity redirects to `fixing`
- `{"outcome":"closed","message":"PR #N was closed"}` → entity redirects to `stuck`

---

## Planned Usage: review-bots-ready

WOP-2022 adds outcome routing to `review-bots-ready` for the `fixing → reviewing` transition:

```json
{
  "outcomes": {
    "ready":     { "proceed": true },
    "ci_failed": { "toState": "fixing" }
  }
}
```

This eliminates the wasted reviewer invocation when CI is red. The gate routes directly to `fixing` with the CI failure details, skipping the reviewer entirely.

---

## Gate Failure Accumulation

When a gate fails (returns `block`), the engine automatically appends to `entity.artifacts.gate_failures`:

```typescript
await this.entityRepo.updateArtifacts(entity.id, {
  gate_failures: [
    ...priorFailures,
    { gateId, gateName, output, failedAt: new Date().toISOString() },
  ],
});
```

This is already implemented in `resolveGate()`. Prompt templates can iterate over failures:

```handlebars
{{#if entity.artifacts.gate_failures}}
## Prior Gate Failures
{{#each entity.artifacts.gate_failures}}
- **{{this.gateName}}** ({{this.failedAt}}): {{this.output}}
{{/each}}
{{/if}}
```

---

## Cross-References

- [gate-taxonomy.md](gate-taxonomy.md) — WOPR gate categories and scripts
- [gate-scripts.md](gate-scripts.md) — how gate scripts are resolved and executed
- `src/engine/gate-evaluator.ts` — gate evaluation and JSON outcome parsing
- `src/engine/engine.ts` — `resolveGate()` routing logic
