# Earned Escalation in the WOPR Stack

> Implements: [method/manifesto/earned-escalation-vs-durable-execution.md](../../method/manifesto/earned-escalation-vs-durable-execution.md)
>
> See also: [The Thesis](the-thesis.md) — why we built this and what the names mean

## Why Not Temporal?

Temporal is excellent. It's battle-tested, widely adopted, and built for durable execution of distributed systems. If you're orchestrating payment flows, order processing, or microservice choreography — use Temporal.

But Temporal's model is: write your workflow as deterministic code, and we'll replay event history to reconstruct state after failures. The workflow is code. The durability comes from the server. The platform runs as a cluster.

DEFCON's model is different:

- **Flows are data, not code.** They live in SQLite. Agents can mutate them at runtime. A flow definition is persisted in the database, not a source file.
- **Gates are the point, not durability.** Temporal makes workflows survive crashes. DEFCON makes workflows survive *AI agents* — which is a different kind of unreliability entirely.
- **The whole thing is ~5000 lines.** One file for state. Zero ops. No cluster. No managed service. `better-sqlite3` and a state machine.
- **It's built for agents shipping software.** Prompts are first-class. Invocations are tracked. The claim/report protocol is designed for things that think, not things that compute.

Temporal asks: "Did the workflow complete?"
DEFCON asks: "Did the workflow *earn* completion?"

Different question. Different tool.

## The Full Stack

DEFCON is the escalation ladder. But a ladder needs someone to climb it, someone to launch the climbers, and someone to watch the room.

```
WOPR ─── the AI. The machine that plays the game.
DEFCON ─ the state machine. Prevents escalation without evidence.
RADAR ── detection and dispatch. Finds work, launches nukes, tracks them.
NUKES ── the agents in flight. Claude containers doing the actual work.
NORAD ── the command center. Dashboard. Watches everything. Touches nothing.
SILO ─── the payload. Flow definitions, gate scripts, agent roles.
```

**[WOPR](https://github.com/wopr-network/wopr)** is the AI that plays. It writes code, runs tests, opens PRs — playing the game as hard as it can, trying to earn escalation to the next DEFCON level. That's its job. That's what you want it to do.

**[RADAR](https://github.com/wopr-network/radar)** is detection and dispatch. It scans for work (Linear issues, GitHub events), claims entities from DEFCON, launches nukes (agent containers), parses their signals, and reports results back. RADAR manages the floor — how many workers, what they're working on, routing results between the thing that does the work and the thing that decides if the work is good enough.

**[NORAD](https://github.com/wopr-network/norad)** is the command center. A real-time dashboard showing entity status, activity feeds, worker health, gate results. NORAD watches everything and touches nothing. Humans trust the system because they can see what it's doing.

**NUKES** are the agents in flight. Docker containers running Claude Code. Each one is expensive ($0.03-$0.50 per invocation). You want as few as possible hitting the target. Gates exist to prevent wasted launches.

**SILO** is where the payload is assembled. Flow definitions, gate scripts, onEnter hooks, agent role files, prompt templates. The flow definition in the SILO is the primary engineering artifact — it determines every prompt, every gate, every routing decision.

```text
SILO defines the payload
RADAR detects work -> claims from DEFCON -> launches a NUKE
NUKE works -> emits signal -> RADAR reports to DEFCON
DEFCON checks gates -> escalate or hold
NORAD watches the whole thing
```

WOPR doesn't know what DEFCON is. DEFCON doesn't know what WOPR is. RADAR connects them. NORAD observes. The SILO defines the rules. Five systems, five roles, one metaphor that refuses to break down.

We looked at the movie. We understood the warning. And we said: yeah, but what if WOPR was actually good at its job? What if the game it's playing isn't a simulation — it's real work, with real gates, and if it plays perfectly, we trust the launch?

**We gave an AI the launch codes. On purpose.**

The movie ended with "the only winning move is not to play." That's a fine lesson for thermonuclear war. But we're not launching missiles. We're launching software. And software that never launches is software that never ships.

The only winning move is to have gates.
