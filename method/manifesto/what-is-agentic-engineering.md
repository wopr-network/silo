# What is Agentic Engineering?

Agentic engineering is a software development methodology where AI agents perform the work and deterministic gates verify every action. The human's role shifts from writing code to designing gates — the system of checks that ensures every AI output meets the project's standards before it can affect anything.

## The Core Distinction

In traditional development, a human writes code and trusts their own judgment. In AI-assisted development ("vibe coding"), an AI writes code and the human trusts the AI's output. In agentic engineering, an AI writes code and **nobody trusts anybody** — the gates verify everything.

```
Traditional:          Human writes → Human reviews → Production
Vibe coding:          Human prompts AI → Hope → Production
Agentic engineering:  Human designs gates → AI works → Gates verify → Production
```

The difference is where trust lives:

| Approach | Trust Model | Failure Mode |
|----------|------------|--------------|
| Traditional | Trust the human developer | Human makes mistakes, but slowly |
| Vibe coding | Trust the AI output | AI makes mistakes, but quickly |
| Agentic engineering | Trust the gates | Gates are deterministic — they pass or fail |

## What Makes a Gate Deterministic

A gate is deterministic when its output is binary (pass/fail) and repeatable (same input always produces same output). Gates are not opinions, suggestions, or "looks good to me." They are automated checks with no ambiguity.

Examples of deterministic gates:
- Type checker passes (tsc, mypy, pyright)
- Linter has zero errors (biome, eslint, ruff)
- All tests pass (vitest, pytest, jest)
- No hardcoded secrets detected (custom script or tool)
- No raw SQL outside approved modules (custom script)
- Build succeeds (tsc, webpack, docker build)
- CI pipeline passes (all of the above, plus integration tests)
- All review bots have posted their findings (synchronization gate)
- Merge queue requirements met (required approvals, required checks)

Examples of things that are NOT deterministic gates:
- "This code looks clean" (subjective)
- "I think this is correct" (opinion)
- "The AI said it's fine" (non-deterministic — same prompt can produce different outputs)

## The Agent Model

Agentic engineering uses specialized, ephemeral agents. Each agent has:

- **One job** — architect, coder, reviewer, fixer, deployer, tester
- **One assignment** — a single issue, PR, or operation
- **A defined lifecycle** — spawn, do the job, report, shut down
- **No accumulated state** — everything the agent produces goes into an external system (git, issue tracker, operational logbook)

Agents are not general-purpose assistants. They are specialized workers with behavioral contracts defined in agent specification files. The specification tells the agent exactly what to do, what gates to check, and how to report its output.

## The Pipeline

Work flows through a pipeline of stages. Each stage has an agent type and a gate:

```
Groom ──→ Architect ──→ Implement ──→ Review ──→ Fix ──→ Merge ──→ Deploy ──→ Verify
  │          │             │            │          │        │          │          │
  gate       gate          gate         gate       gate     gate       gate       gate
```

No work advances to the next stage without passing the current stage's gate. The pipeline is a state machine — transitions happen on events, not on hope.

## Why This Works

See [Why This Works](why-this-works.md) for the full argument.

The short version: deterministic gates create a **ratchet**. Code quality can only go up because gates prevent regressions. Feedback loops make gates stronger over time. The compound effect means sprint 100 is easier than sprint 1.

## Why This Matters

Software built by AI agents without gates is a liability. It might work today. It will break tomorrow. Nobody will know why because nobody verified anything.

Software built by AI agents WITH gates is an asset. Every merge is verified. Every deploy is tested. Every finding feeds back to prevent recurrence. The system gets more reliable over time, not less.

The question isn't whether AI will write your software — it already does. The question is whether you have gates, or just hope.
