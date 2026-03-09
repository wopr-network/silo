# onEnter Hooks

> WOPR implementation: [docs/wopr/pipeline/onenter-hooks.md](../../wopr/pipeline/onenter-hooks.md)

---

## What onEnter Hooks Are

An **onEnter hook** is a setup command bound to a pipeline state. It runs once, automatically, when an entity enters that state — before the state becomes claimable by any worker.

The hook's output is merged into the entity's shared context (artifacts). Workers that subsequently claim the entity receive that context without having to reconstruct it.

### The Context Assembly Contract

An onEnter hook is not convenience infrastructure. It is the **contract** that the agent will receive complete context at invocation time.

**Every tool call an agent makes to gather context is a failure of the onEnter hook to provide it.** If the agent calls an API to read its own issue description, the hook should have fetched it. If the agent checks CI status, the gate should have pre-verified it. If the agent searches for the PR it's supposed to review, the hook should have placed the PR number in artifacts.

The measure of a well-engineered onEnter hook: can the agent complete its job with zero context-gathering tool calls? All tool calls should be *work* — writing code, posting comments, running tests — never reconnaissance.

A hook that fetches 80% of what the agent needs is not 80% good. It guarantees that the agent burns 20% of its invocation on tool calls that should have been pre-computed.

### The Output Schema Is a Contract Between States

The JSON keys an onEnter hook produces define the interface between the current state and the prompt template that consumes them. If the prompt template references `{{entity.artifacts.architectSpec}}` but the onEnter hook doesn't produce `architectSpec`, the prompt will render with missing context and the agent will spend tool calls discovering what should have been given.

Design the onEnter output schema the same way you'd design an API contract: the producer (hook) guarantees the keys; the consumer (prompt template) depends on them. A missing key is a broken contract, not a "the agent will figure it out" situation.

---

## When They Run

```
Entity transitions into state S
  → engine evaluates onEnter for S
  → if onEnter is defined: run setup command
      → success: merge artifacts, mark state claimable
      → failure: hold entity in non-claimable sub-state
  → if onEnter is absent: mark state claimable immediately
```

onEnter runs **after** the transition into the state and **before** the first claim. It does not run on reclaims — if an entity is dropped and re-picked, the artifacts are already present.

---

## What They Can Produce

The hook command writes structured output (e.g., JSON) to stdout. The engine extracts named keys and merges them into the entity's artifact store. Workers reference these by key in their prompt templates or tool calls.

Typical outputs:
- Filesystem paths (worktree, scratch directory)
- Identifiers (branch name, container ID, resource handle)
- Configuration (environment variables, credential references)

---

## Error Handling Contract

If the setup command exits with a non-zero status or exceeds the configured timeout:

- The entity is **held** in the entering state — it does not become claimable
- The engine records the failure in the artifact store for visibility
- Manual intervention is required to either resolve the setup failure or patch the artifacts directly

onEnter failures are considered infrastructure failures, not work failures. They do not increment retry counters on the entity or trigger normal gate logic.

---

## Idempotency

If all named artifact keys are already present on the entity when a state is entered, the hook is skipped. This ensures that re-entry into a state (e.g., after a gate failure routes back) does not re-run expensive setup.

Design onEnter commands to be safely re-runnable anyway, as a defensive measure.

---

## Relationship to Gates

onEnter hooks and gates are complementary, not interchangeable:

| | Gate | onEnter Hook |
|---|---|---|
| Bound to | A transition (between states) | A state definition |
| Runs | After leaving a state, before entering the next | Before first claim on the entered state |
| Purpose | Validate completed work | Prepare environment for upcoming work |
| Failure outcome | Block the transition (entity stays / retries) | Block entry (entity held, manual fix required) |

Gates and onEnter hooks together form the **context assembly pipeline**:

1. Gate asks: "Was the prior work done correctly?" — if yes, transition proceeds
2. onEnter asks: "Can I assemble complete context for the next agent?" — if yes, state becomes claimable
3. Agent receives: assembled artifacts + rendered prompt template — no reconstruction needed

Gates ask "was the work done correctly?" onEnter hooks ask "is the environment ready for work to begin?" Together they guarantee that the agent's first token is spent on reasoning, not on figuring out what it's supposed to do.

---

## Cross-References

- [gate-taxonomy.md](../gates/gate-taxonomy.md) — full gate lifecycle and the relationship between gates and state hooks
- [pipeline-schema.md](pipeline-schema.md) — where onEnter fits in the state machine definition
- [lifecycle.md](lifecycle.md) — entity lifecycle from creation to completion
