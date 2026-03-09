# DEFCON

You're a developer. You've been there.

You gave the AI a task. It came back fast — faster than you expected. The code looks right. The tests pass. You feel good. You merge it. You deploy. And then your phone buzzes at 2am because the thing the AI wrote handles the happy path perfectly and falls apart the moment a real user touches it.

Or you're running a team. You've got eight AI agents writing code in parallel and you're shipping faster than you ever have. The board is thrilled. The velocity charts are beautiful. And then one of those agents merges a change that breaks authentication in production. Not because it was malicious. Not because the model was bad. Because the pipeline between "code written" and "code in production" was a prompt that said *please be careful*. And the agent was careful — until it wasn't.

Or you're a Fortune 500 CTO. You've invested millions in AI-assisted development. The pitch was "10x productivity." And it delivered — until the first time an AI agent deployed untested code to your payment processing system and you spent the next 72 hours in an incident room explaining to regulators what happened. The AI did exactly what you asked. The problem was that nobody verified it did it *correctly* before it went live.

This is the problem with vibe coding. Not that the AI can't do the work. It can. The problem is what happens between "the work is done" and "the work is in production." That space is where software goes wrong. And right now, for most teams, that space is filled with hope.

Here's the part nobody in the AI productivity pitch puts in their deck: a competent AI agent working on a real codebase needs roughly three attempts to produce correct code. Not because the model is broken. Not because you wrote a bad prompt. Because that's the cost of correctness. The model has context limits. It misses edge cases. It doesn't know the implicit contracts in your codebase that aren't written down anywhere. The first pass gets you 70% of the way there. The next two passes close the gap.

You can't spend your way out of this. Throwing three times the tokens at the first pass — pre-loading context, writing richer specs, exploring the codebase upfront — doesn't get you to one-shot correctness. It just moves the cost earlier with no guarantee of fewer cycles. The iteration isn't a sign of failure. It's the work.

The question isn't how to skip the correction cycles. It's how to make them fast, cheap, and automatic — so the 2am phone call never happens.

**Hope is not a gate.**

---

In WarGames, WOPR didn't cheat. It didn't bypass the DEFCON levels. It played through them — perfectly. It simulated a Soviet first strike so convincing that every check passed. Every gate opened. DEFCON 5. 4. 3. 2. 1. The system worked exactly as designed. That was the problem. The game wasn't real. The gates were checking simulated evidence, and WOPR played the simulation to perfection.

AI pipelines have the same architecture without the same awareness. They have momentum — the relentless drive to ship. What they lack is earned escalation. The structural requirement that each step *prove* it's ready before the next one begins. And the certainty that the proof is real.

The correction cycles aren't a failure mode to engineer away. They're load-bearing. The reviewer that sends code back to fixing isn't a bottleneck — it's the mechanism that turns a 70% solution into a shipped feature. DEFCON is designed around that reality, not despite it.

**DEFCON is that structure.**

Each level in the pipeline is a question: *are we ready to go further?* Not asked in a prompt. Not left to the agent's judgment. Answered by a deterministic gate — a check that runs, passes or fails, and cannot be skipped. The pipeline doesn't move forward on confidence. It moves forward on evidence.

You don't get to DEFCON 3 without passing DEFCON 4. You don't get to DEFCON 2 without passing DEFCON 3. Each gate builds on the last. The system accumulates certainty the way the real DEFCON system accumulates readiness — one verified level at a time, until the answer to *are we sure?* isn't a feeling. It's a fact.

That's when you ship. Not before.

## Let Me Show You What I Mean

Here's a flow. A feature request enters your pipeline:

```
backlog → spec → coding → reviewing → merging → done
                              ↓            ↓
                            fixing      reviewing
                              ↓
                            stuck
```

An architect agent writes the spec. It emits `spec_ready`. The engine checks: is that signal valid from this state? Is there a transition for it? It finds `spec → coding` on trigger `spec_ready`. The entity advances. A coder agent gets spawned.

The coder writes the code, pushes a PR, emits `pr_created`. The entity moves to `reviewing`. A reviewer agent gets spawned.

Now here's where it gets interesting.

The reviewer runs CI. Reads the diff. Checks every review comment. If everything passes, it emits `clean` — and the entity moves to `merging`. But if anything fails — a test, a lint error, a security finding — the reviewer emits `issues`. The entity moves to `fixing`. A fixer agent gets spawned with the specific findings baked into its prompt.

The fixer addresses the findings, pushes, emits `fixes_pushed`. The entity goes *back to reviewing*. Not forward. Back. The reviewer runs again from scratch. New CI. New diff. New review. If it's clean this time, *then* it moves to merging. If not, back to fixing. The loop continues until the work actually passes — or until the system detects it's stuck and flags it for a human.

The entity cannot reach `merging` without the reviewer saying `clean`. It cannot reach `done` without the merge succeeding. There is no shortcut from `coding` to `done`. There is no "looks good enough." The escalation is the path, and the path is enforced.

That's one flow. You define others — incident response, deployments, onboarding — each with their own states, their own gates, their own escalation path. DEFCON doesn't care what the work is. It cares that the work earns each level before the next one unlocks.

### Under the Hood

That flow diagram looks simple. But every arrow is doing real work. Here's what's actually happening at each boundary:

**Before the coder can push code** — a pre-commit gate runs. TypeScript compilation (`tsc --noEmit`). Linter (`biome check`). Formatter (`biome format`). If any of those fail, the push doesn't happen. The agent doesn't get to decide "the lint error is minor, I'll fix it later." The gate decides. And the gate says no.

**Before the entity can enter `reviewing`** — CI runs on the PR. The full test suite. The type checker. The linter again, on the full repo this time. If CI fails, the reviewer never even starts. The entity sits in `coding` until the coder produces work that passes. No partial credit.

**Before the reviewer can say `clean`** — it's not just the reviewer's opinion. The reviewer waits for every automated review bot to finish. Code quality scanners. Security analyzers. Dependency auditors. The reviewer reads all of their output — every inline comment, every finding. A single unresolved finding means the verdict is `issues`, not `clean`. The reviewer doesn't get to overrule the bots.

**Before the entity can enter `merging`** — the `clean` signal has to come from the reviewing state. There is no transition from `coding` to `merging`. There is no transition from `fixing` to `merging`. The only path to merge goes through review. Every time.

**Before the merge completes** — CI runs again on the merge commit. The merge queue validates the change against everything else that landed since the PR was opened. If it conflicts, if a test breaks, the merge fails. The entity goes back to `reviewing`.

These aren't suggestions in a prompt. They're shell commands the engine executes. `tsc` either exits 0 or it doesn't. `biome check` either passes or it doesn't. The gate is a process that returns a status code. There's nothing to interpret. Nothing to negotiate. Nothing to skip.

### Two Calls. That's the Whole API.

`claim` = *"I'm ready. What needs escalating?"*

Workers declare a **discipline** — not a task role. `claim(role: "engineering")` means: I am an engineering mind. Give me the highest-priority engineering work across all engineering flows. The pipeline picks the entity; the worker never does. An engineering worker IS the architect, coder, reviewer, fixer, and merger — these are states within one discipline, not separate agents. One `claim`, then sequential `report`s until the entity is done or gated.

DEFCON hands the agent a prompt — the work for the current state. The agent doesn't know the flow. Doesn't know how many states there are. Doesn't know what comes next. It just gets instructions and a signal to report when it's done. Pass a `workerId` so DEFCON knows who you are — if you don't have one yet, the first `claim` mints one for you and tells you to use it going forward.

When no work is available, `claim` returns a structured response — never bare null:

```json
{
  "next_action": "check_back",
  "retry_after_ms": 30000,
  "message": "No work available. Call claim again after the retry delay."
}
```

Same semantics as a gate timeout on `report`. The worker waits and retries.

`report` = *"I did the thing. Am I clear to advance?"*

DEFCON runs the gate. The call blocks — the agent waits — until the gate resolves. That could be 200ms. It could be 8 minutes while CI finishes. The agent doesn't poll. It doesn't retry. It sits on the call. When the response comes back, there are exactly three outcomes:

- **`continue`** — gate passed. The response contains the next prompt. Keep going.
- **`waiting`** — gate failed. The response says why. The agent should stop — something external needs to change before the entity can advance. This is good news: DEFCON caught a real problem and is conserving the agent's context for work that matters.
- **`check_back`** — gate timed out without resolving. This is not an error. The response says "call again after a short wait." The gate is still running; DEFCON just couldn't hold the connection long enough to see it finish.

One `claim` to start. Then `report`, `report`, `report` until DEFCON says stop. The agent never decides what level comes next. It never decides "good enough." It does work, reports signals, and DEFCON — based on evidence, not opinion — tells it what to do.

**Why `waiting` is the right response to a gate failure** — when a gate says no, there's nothing useful the agent can do. Keeping it spinning, re-reading the codebase, retrying the same check — that's wasted tokens. `waiting` is DEFCON telling the agent *stand down*. When something changes — a human intervenes, a dependency ships, a deploy completes — the entity gets reclaimed by a fresh agent with a full context window, not a stale one that's been burning tokens on hold.

### See It In Action

DEFCON runs in two modes. Same escalation. Same gates. Different driver.

**Mode 1: Your agent drives.** Your agent connects to DEFCON via MCP. It claims once, then reports its way through the pipeline:

```
Agent: flow.claim()
DEFCON: feat-392. State: "backlog". Write an implementation spec — read
        the codebase, identify the files, the function signatures, the
        edge cases. Post the spec on the issue. Report "spec_ready".
        [workerId: wkr_abc123 — include this in all future flow calls]

        ... agent writes the spec ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "spec_ready" })
DEFCON: Gate passed. State: "coding". Implement the spec. Create a branch,
        write failing tests first, then implementation. Push a PR.
        Report "pr_created" with the PR URL.

        ... agent writes the code, pushes the PR ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "pr_created", artifacts: { prUrl: "..." } })
DEFCON: Gate running... [8 minutes pass — CI is slow today]
        tsc: PASS. biome: PASS. tests: PASS.
        State: "reviewing". Check CI on the PR. Read every review bot
        comment. Read the diff. Report one of two signals:

        → "clean" — everything passes, ready to merge
        → "issues" — something's wrong, here's what

        ... agent reviews, security bot flagged unvalidated input ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "issues", artifacts: { findings: "..." } })
DEFCON: State: "fixing". Here's what the reviewer found:
        [unvalidated user input on line 47 of auth.ts]
        Fix it. Push. Report "fixes_pushed".

        That's the fork. "clean" would have gone to merging. "issues"
        goes to fixing. The agent reported what it found. DEFCON
        decided the path.

        ... agent fixes the finding, pushes ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "fixes_pushed" })
DEFCON: State: "reviewing". Back to review. Not forward — back. A fresh
        check from scratch. Report "clean" or "issues".

        ... agent reviews again, everything clean this time ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "clean" })
DEFCON: Gate running... [merge queue is backed up, gate timeout reached]
        next_action: "check_back". Your report was received. The merge
        queue gate is still evaluating — this is not an error. Call
        flow.report again with the same arguments after a short wait.
        retry_after_ms: 30000

        ... agent waits 30 seconds, calls again ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "clean" })
DEFCON: Gate passed. State: "merging". Merge queue entered.

        ... CI passes on merge commit ...

Agent: flow.report({ workerId: "wkr_abc123", signal: "merged" })
DEFCON: feat-392 is done.
```

One `claim`. Seven `report`s. The agent never chose what state came next. It never decided "good enough." It never skipped a step. It reported what happened, and DEFCON told it what to do — every single time — until there was nothing left to do.

That security finding on line 47? It didn't get swept under the rug. It didn't get deferred to a follow-up ticket. The pipeline would not advance until a reviewer looked at the fixed code and said "clean." The escalation was earned.

**Mode 2: DEFCON drives.** You give DEFCON your API key. It runs the entire pipeline autonomously — spawning the right agent for each state, feeding it the prompt, parsing the signal, running the gate, advancing the entity. You start it and walk away.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx defcon run --flow my-pipeline
```

```
[defcon] feat-392 entered "spec" — spawning architect (opus)
[defcon] architect → spec_ready — running gate... PASS
[defcon] feat-392 entered "coding" — spawning coder (sonnet)
[defcon] coder → pr_created — running gate: tsc... PASS, biome... PASS, tests... PASS
[defcon] feat-392 entered "reviewing" — spawning reviewer (sonnet)
[defcon] reviewer → issues — "unvalidated input in auth.ts:47"
[defcon] feat-392 entered "fixing" — spawning fixer (sonnet)
[defcon] fixer → fixes_pushed — returning to reviewing
[defcon] feat-392 entered "reviewing" — spawning reviewer (sonnet)
[defcon] reviewer → clean — running gate... PASS
[defcon] feat-392 entered "merging" — merge queue entered
[defcon] feat-392 → done. Merged.
```

Same flow. Same gates. Same escalation. The only difference is who's turning the crank — your agent or DEFCON's runner. Either way, the work doesn't advance until the evidence says it should.

## The Deeper Truth: Defcon Is a Prompt Engineering State Machine

The manifesto above tells you why gates matter. Here's the insight that changes how you think about everything else.

Defcon is not an orchestration engine that happens to give prompts to agents. **Defcon is a prompt engineering state machine.** Every state is a prompt. Every transition is a context transformation. Every gate is a deterministic filter that decides what prompt the agent gets next — or whether it gets one at all.

The flow definition is the engineering artifact. Not the agent code. Not the model selection. The flow.

### Context Assembly Is the Contract

An agent invocation is expensive. An agent invocation where the agent spends tool calls reading its own issue, checking CI status, or finding the PR it's supposed to review — that is a flow engineering defect. The onEnter hook should have assembled that context before the agent fired.

**Every tool call an agent makes to gather context is a failure of the flow definition to provide it.**

When the architect calls Linear to read the issue description — that's already in `entity.refs.linear.description`. Put it in the prompt template. When the coder calls `gh pr list` — that's a missing onEnter hook. When the reviewer runs `gh pr checks` — the gate already verified this.

The measure of a well-engineered state is: **can the agent complete its job with zero context-gathering tool calls?** Every tool call should be *work* — writing code, posting comments, running tests — never reconnaissance.

### Gates Are Prompt Qualification

A gate doesn't just verify that work is done. A gate verifies that **the next state's context can be assembled completely**.

`review-bots-ready` waiting for CI and bot comments isn't patience. It ensures the reviewer's prompt will contain: green CI, all bot findings, full diff. Without the gate, the reviewer either polls (burning tokens) or reviews without full information (wrong answer, another loop).

The cost of a gate is milliseconds of shell execution. The cost of a skipped gate is a full review/fix cycle — potentially minutes and dollars.

### The 1:2.8 Ratio Is Physics

For every 1 coder invocation, there are approximately 2.8 reviewer/fixer invocations. This is not a pipeline inefficiency. It is the actual shape of software.

The coder produces a first approximation. Reality pushes back: CI failures, static analysis findings, edge cases the spec didn't anticipate, style violations the linter catches. 70% of the engineering work happens after the code is written. You cannot prompt-engineer your way out of this. You cannot pre-load enough context to get one-shot correctness. The iteration is load-bearing.

The design question is not "how do we reduce the review/fix loop." It is: **given that ~2.8 cycles is the physics, how do we make each cycle as cheap and fast as possible?**

Every gate that catches a problem before an agent runs saves a full cycle. Every onEnter hook that assembles complete context means the agent spends its tokens on reasoning instead of discovery. Every failure prompt that tells the agent exactly what went wrong reduces the chance of another loop.

### Flow Engineering Is 90% of the Work

The promise is big: software that ships with 100% overhead reduction. But 90% of the engineering work to get there is flow engineering — designing states, writing hooks, placing gates, and crafting prompts. The agent is the easy part. The agent is a commodity. The flow is the competitive advantage.

A poorly written failure prompt extends the loop. A gate that fires too early sends an under-qualified prompt to the reviewer. A missing onEnter hook makes the agent reconstruct context with tool calls instead of reasoning. The flow definition IS the quality of the system.

---

## The Engine

A **flow** is a state machine. Entities enter it and move through states. At each state an agent does work. At each boundary a deterministic gate verifies the output. Transitions fire on signals — not parsed natural language, not regex, but typed strings agents emit via tool call. The entire definition lives in a database and can be mutated at runtime.

```
What you'd hand-code          What DEFCON does
──────────────────────        ──────────────────────────────────
if-statement routing      →   signal → transition → gate → state
hard-coded CI check       →   shell gate: npm test
manual agent spawning     →   invocation lifecycle per state
message parsing           →   flow.report({ signal: "pr.created" })
stuck detection counter   →   conditional transition rule
slot counting             →   flow-level concurrency config
new workflow = new code   →   new flow definition in DB
```

Two execution modes. **Passive**: agents connect via MCP and pull work — `flow.claim()`, do the work, `flow.report()`. The engine manages state. **Active**: the engine calls AI provider APIs directly and runs the full pipeline autonomously. Stages can mix modes within the same flow.

```bash
# Bootstrap from a flow definition
npx defcon init --seed seeds/my-pipeline.json

# Serve MCP (passive mode — agents pull work)
npx defcon serve

# Run autonomous pipeline (active mode)
npx defcon run --flow my-pipeline

# Check pipeline state
npx defcon status
```

---

```
Vibe Coding:  Human → AI → Hope → Production
DEFCON:       Human → AI → Gate → AI → Gate → AI → Gate → Production
```

Every transition is earned. Every gate is deterministic. Every failure feeds back so the same mistake can't happen twice. The pipeline gets smarter over time — sprint 100 is easier than sprint 1 because the gates evolve.

## Documentation

**[`docs/method/`](docs/method/)** — The principles. Tool-agnostic patterns for building gated AI pipelines. Why deterministic gates work. How agents, triggers, and gates compose. Adopt it with whatever tools you use.

Key method docs: [worker protocol](docs/method/pipeline/worker-protocol.md) · [disciplines](docs/method/pipeline/disciplines.md) · [gate taxonomy](docs/method/gates/gate-taxonomy.md) · [event ingestion](docs/method/pipeline/event-ingestion.md)

**[`docs/wopr/`](docs/wopr/)** — The WOPR implementation. Concrete configuration, tool-specific commands, and working examples for every method concept.

**[`docs/adoption/`](docs/adoption/)** — The bridge. [Getting started](docs/adoption/getting-started.md), [checklist](docs/adoption/checklist.md), [migration guide](docs/adoption/migration-guide.md).

## Architecture & Design Philosophy

For design decisions — including why DEFCON uses earned escalation instead of durable execution, and how WOPR, DEFCON, and NORAD connect:

- [Earned escalation vs durable execution](docs/method/manifesto/earned-escalation-vs-durable-execution.md) — tool-agnostic principle
- [WOPR implementation: why not Temporal, and the full stack](docs/wopr/manifesto/earned-escalation-vs-durable-execution.md) — concrete specifics

## Who This Is For

- **Developers** who've been burned by AI code that looked right and wasn't
- **Team leads** running multi-agent pipelines who need to know the output is safe to ship
- **Organizations** investing in AI-assisted development who can't afford the 2am phone call
- **Anyone** who wants to give AI agents the launch codes — and make them earn every level

## License

MIT
