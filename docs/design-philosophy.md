# Design Philosophy

## Why Not Temporal?

You might be thinking: "This sounds like a workflow engine. Why not use Temporal?"

Temporal is excellent. It's battle-tested, widely adopted, and built for durable execution of distributed systems. If you're orchestrating payment flows, order processing, or microservice choreography — use Temporal. Seriously.

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

DEFCON is the escalation ladder. But a ladder needs someone to climb it and someone to watch the room.

**[WOPR](https://github.com/wopr-network/wopr)** is the AI that climbs. It writes code, runs tests, opens PRs — playing the game as hard as it can, trying to reach DEFCON 1. That's its job. That's what you want it to do.

**[NORAD](https://github.com/wopr-network/norad)** is the operations center. It watches the world for events, claims work from DEFCON, dispatches WOPR, and feeds signals back. It manages the floor — how many workers, what they're working on, routing results between the thing that does the work and the thing that decides if the work is good enough.

```text
NORAD watches → event arrives → claims from DEFCON → dispatches WOPR
WOPR works → emits signal → NORAD reports to DEFCON → gate checks → escalate or hold
```

WOPR doesn't know what DEFCON is. DEFCON doesn't know what WOPR is. NORAD connects them. Three systems, three roles, one metaphor that refuses to break down.

We looked at the movie. We understood the warning. And we said: yeah, but what if WOPR was actually good at its job? What if the game it's playing isn't a simulation — it's real work, with real gates, and if it plays perfectly, we trust the launch?

**We gave an AI the launch codes. On purpose.**

The movie ended with "the only winning move is not to play." That's a fine lesson for thermonuclear war. But we're not launching missiles. We're launching software. And software that never launches is software that never ships.

The only winning move is to have gates.
