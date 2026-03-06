# Stage 1: Architect

Spec writing — how issues become implementation plans.

---

## Purpose

The architect reads an issue, studies the codebase, and produces a detailed implementation spec. The spec is the contract between "what to build" (the issue) and "how to build it" (the coder's instructions).

## The Read-Only Constraint

The architect is **read-only**. It reads the codebase for context but does not create branches, write code, or modify files. Its only output is a spec posted to the issue tracker.

**Why read-only?**

- Separation of concerns. Analysis and implementation are different skills requiring different reasoning depths.
- The architect uses a high-reasoning model (expensive, slow, thorough). The coder uses a fast-execution model (cheaper, faster, follows instructions). Splitting the work matches the model to the task.
- A read-only architect cannot accidentally break anything. Its blast radius is zero.

## What the Spec Contains

A good implementation spec includes:

1. **Files to create or modify** — exact paths, not vague references
2. **Function signatures** — names, parameters, return types
3. **Data structures** — schemas, types, interfaces
4. **Implementation steps** — ordered, specific, actionable
5. **Test plan** — which tests to write, what they should assert
6. **Edge cases and gotchas** — things the coder should watch for
7. **Dependencies** — what this change depends on, what depends on this change

A good spec is detailed enough that a coder with no prior context can implement it by following the steps.

## The Architect's Process

```
1. Read the issue description
2. Study the codebase:
   - File structure and conventions
   - Existing patterns for similar features
   - Who calls what (dependency graph)
   - Who imports what (module boundaries)
3. Design the solution
4. Post the spec as a comment on the issue
5. Report "Spec ready: ISSUE-KEY"
6. Shut down
```

## Agent Routing

Not all issues get the same architect treatment. Route based on the work:

| Signal | Additional Architect | Why |
|--------|---------------------|-----|
| Frontend/UI work | Design architect (aesthetic, typography, palette, animations, responsive strategy) | Visual work needs design thinking, not just code structure |
| Backend/API work | None needed | Technical spec is sufficient |
| Infrastructure work | None needed | Technical spec is sufficient |

For UI work, two architects produce two specs — a technical spec (what to build) and a design spec (how it looks). The implementing agent reads both.

## Gate

The architect stage is complete when:

- A spec has been posted to the issue tracker
- The spec contains all required sections (files, signatures, steps, tests, gotchas)
- The "Spec ready" message has been sent

## Anti-Patterns

- **Architect writes code** — violates read-only constraint. The architect's job is to think, not to type.
- **Spec is too vague** — "implement the feature as described in the issue" is not a spec. It's a punt.
- **Spec assumes context** — the coder is ephemeral. It has no memory of previous sessions. The spec must be self-contained.
- **Spec over-engineers** — the spec should describe the minimal solution, not the ideal architecture. YAGNI applies to specs too.
