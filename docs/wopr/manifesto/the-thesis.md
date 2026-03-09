# The Thesis — The WOPR Stack

> Implements: [method/manifesto/the-thesis.md](../../method/manifesto/the-thesis.md)

How one system answers the question: You will give AI the keys. How safely will you do it?

---

## The Stack

Six components. Each named for a piece of the nuclear command and control system. Not because we're building weapons — because we're building the safeguards.

```
WOPR ─── the AI. The machine that plays the game.
DEFCON ─ the state machine. Prevents escalation without evidence.
RADAR ── detection and dispatch. Finds work, launches agents, tracks them.
NUKES ── the agents in flight. Docker containers running Claude. Expensive. Observable.
NORAD ── the command center. Dashboard. Watches everything. Touches nothing.
SILO ─── the payload. Flow definitions, gate scripts, agent roles, prompt templates.
```

### WOPR — Without Official Permission Required

[wopr-network/wopr](https://github.com/wopr-network/wopr)

The AI itself. Self-sovereign AI session management with plugin-based extensibility. Multi-provider support (Claude, OpenAI, more via plugins). Channel integrations (Discord, Slack, Telegram, WhatsApp, Signal, iMessage, Teams). P2P agent-to-agent communication. Scheduled injections. Skills system.

WOPR is the thing being built by the pipeline. It's also the thing that plays the game — the AI that writes code, opens PRs, and tries to reach production. In War Games, WOPR was the machine that couldn't tell simulation from reality. Our WOPR can't either — but it doesn't need to, because DEFCON tells it what's real.

### DEFCON — The State Machine

[wopr-network/defcon](https://github.com/wopr-network/defcon)

The escalation ladder. Every entity (issue, PR, task) is at a DEFCON level — a state in the machine. Transitions between states require evidence. Gates verify the evidence. No entity advances without earning it.

DEFCON doesn't know what WOPR is. It doesn't know what code looks like or what a PR is. It knows: states, transitions, gates, signals. It's a ~5000-line TypeScript engine with SQLite storage. Flows are data in the database, not code in a source file. Agents can inspect and modify their own pipeline at runtime.

DEFCON asks one question: did the work earn escalation?

### RADAR — Detection and Dispatch

[wopr-network/radar](https://github.com/wopr-network/radar)

The operations center. RADAR scans for work (Linear issues, GitHub events, webhooks), claims entities from DEFCON, dispatches agents (NUKES), parses their signals, and reports results back to DEFCON.

RADAR owns the claim/report protocol. It doesn't decide what work to do — DEFCON's flow definition decides that. RADAR decides HOW to do it: which model tier, which agent role, how many concurrent slots, when to reap hung agents.

RADAR doesn't trust WOPR. It reads the agent's stdout, extracts signal phrases, and reports the signal to DEFCON. The agent emits `PR created: <url>`. RADAR parses it, extracts the artifacts, and calls DEFCON's API. The agent never talks to DEFCON directly.

### NUKES — Agents in Flight

The Docker containers running Claude Code agents. Each nuke is a single agent invocation: an architect writing a spec, a coder implementing it, a reviewer reading a diff, a fixer addressing findings.

Nukes are expensive. Each one costs tokens — $0.03 to $0.50 depending on model tier and context size. You want as few as possible hitting the target. This is why gates exist: every gate that routes an entity without launching a nuke saves money. The merge-queue gate that checks PR state is a $0.00 shell script making a decision that would cost $0.03 if an agent did it.

Nukes are observable. RADAR tracks every one in flight — when it launched, what it's working on, how long it's been running. NORAD displays them. If a nuke hangs, RADAR reaps it after a timeout.

Nukes are ephemeral. They launch, do one job, emit a signal, and die. No accumulated state. No memory between invocations. Everything they produce goes into an external system: a git commit, a Linear comment, a PR review.

### NORAD — The Command Center

[wopr-network/norad](https://github.com/wopr-network/norad)

The dashboard. A Next.js application that displays the pipeline in real time: entity status, activity feeds, worker health, gate results, agent invocations.

NORAD watches everything and touches nothing. It connects to DEFCON via WebSocket for live state updates and to RADAR via REST for worker metrics. Humans watch NORAD to understand what the system is doing. NORAD doesn't intervene — it earns trust through transparency.

### SILO — The Payload

[wopr-network/bunker](https://github.com/wopr-network/bunker) *(to be renamed)*

Where the warhead is assembled. The SILO contains:

- **Flow definitions** (`seed/flows.json`) — the state machine definition, prompt templates, gate configurations, transition rules
- **Gate scripts** (`seed/gates/`) — deterministic shell scripts that verify work
- **onEnter hooks** (`seed/scripts/`) — context assembly scripts that run before a state becomes claimable
- **Agent role files** (`~/.claude/agents/wopr-*.md`) — behavioral contracts for each agent type
- **Test harness** (`docker-compose.yml`) — Docker Compose environment for running the full stack locally

The flow definition in the SILO is the primary engineering artifact. Not the code the agents produce. Not the agents themselves. The flow definition — because it determines every prompt, every gate, every context assembly hook, every routing decision. 90% of the engineering effort is here.

---

## Why These Names

The names encode the philosophy:

**DEFCON prevents escalation.** Work doesn't advance without evidence. The naming isn't cute — it's the design constraint. The question at every transition is: has the work earned the next DEFCON level?

**NUKES are expensive.** You don't launch one unless you're sure of the target. Gates ensure the context is complete before an agent fires. Every skipped gate is a wasted nuke — an agent invocation that burns tokens discovering what a gate should have verified.

**RADAR tracks everything in flight.** You don't launch nukes and hope. You track them. Every agent invocation is observable: when it launched, what signal it emitted, how long it ran, what it cost.

**NORAD watches but never fires.** The dashboard doesn't make decisions. It provides situational awareness. Humans trust the system because they can see what it's doing, not because they're told it's working.

**SILO holds the payload.** The flow definition is the warhead — carefully assembled, precisely targeted, tested before launch. You don't modify the payload in flight. You modify it in the silo, test it, and deploy it.

**WOPR plays the game.** The AI writes the code, opens the PRs, runs the tests. It plays as hard as it can. That's what you want it to do. The gates decide if it wins.

---

## The War Games Argument

In 1983, War Games asked: what happens when you give an AI the launch codes?

The movie's answer: don't play. The AI can't be trusted. The only winning move is not to play.

We disagree. Not with the premise — AI can't be trusted. With the conclusion. Because "don't play" means "don't ship." And software that doesn't ship is software that doesn't exist.

Our answer: play, but build the launch protocol. Gates at every boundary. Signals at every transition. A state machine that refuses to advance on unverified output. A dashboard that shows everyone what's happening. A learning loop that makes every launch safer than the last.

We gave an AI the launch codes. On purpose. And then we built DEFCON to make sure it earns every escalation.

The only winning move is to have gates.

---

## The Numbers

| Component | What it costs | What it replaces |
|-----------|--------------|-----------------|
| Gate script (shell) | ~0ms, $0.00 | Agent invocation that would produce a deterministic answer |
| onEnter hook (context assembly) | ~1-5s, $0.00 | Agent tool calls for context gathering ($0.01-0.10 in tokens) |
| Agent invocation (nuke) | ~30-300s, $0.03-0.50 | The actual work — reasoning, not routing |

The ratio: for every 1 coder invocation, roughly 2.8 reviewer/fixer invocations. This is physics — the correction cycle IS the work. But every gate that routes without launching a nuke, every onEnter hook that pre-assembles context, every prompt template that eliminates a tool call — these reduce the cost per entity without reducing the quality.

The goal is not fewer nukes. The goal is fewer WASTED nukes.

---

## Cross-References

- [method/manifesto/the-thesis.md](../../method/manifesto/the-thesis.md) — the principle this implements
- [DEFCON implementation](earned-escalation-vs-durable-execution.md) — how DEFCON implements earned escalation
- [What is Agentic Engineering](what-is-agentic-engineering.md) — the WOPR gate system
- [Gate Taxonomy](../gates/gate-taxonomy.md) — the 11 categories of gates
- [Gate Routing](../gates/gate-routing.md) — how gates make routing decisions
