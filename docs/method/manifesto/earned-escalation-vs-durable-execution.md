# Earned Escalation vs Durable Execution

> Builds on: [The Thesis](the-thesis.md) — the launch protocol argument.

There are two philosophies for making workflows survive failure.

**Durable execution** says: write your workflow as code, and the platform will replay event history to reconstruct state after crashes. The workflow survives because the runtime is persistent. The workflow is code. The durability is infrastructure.

**Earned escalation** says: workflows advance only when they prove readiness. Each stage presents evidence. A deterministic gate verifies it. The workflow survives not by recovering from failure, but by refusing to advance on unverified output.

These answer different questions.

Durable execution asks: *Did the workflow complete?*

Earned escalation asks: *Did the workflow earn completion?*

## When Durable Execution Is the Right Choice

Durable execution is the right model for workflows where the work itself is the only question. Payment processing. Order fulfillment. Microservice choreography. The output is deterministic — a charge either succeeds or it doesn't. The risk is failure to complete, not failure to verify.

## When Earned Escalation Is the Right Choice

Earned escalation is the right model when the output requires judgment to verify. When the agent doing the work can produce output that looks correct but isn't. When "the task is done" and "the task is done correctly" are different claims that require separate evidence.

AI agents are exactly this kind of worker. An agent can produce output that passes superficial checks — tests green, linter clean — while introducing subtle regressions, security holes, or logic errors. Durability doesn't help here. The workflow completed. That's the problem.

## Workflow-as-Data vs Workflow-as-Code

Durable execution typically encodes workflows as deterministic code functions. The workflow definition is a source file.

An alternative is workflow-as-data: the state machine definition lives in a database. Entities advance through states. Gates are shell commands or API calls, not inline code. This makes flows inspectable, mutable at runtime, and decoupled from deployment.

The tradeoff: workflow-as-code is easier to version and test. Workflow-as-data is easier to evolve without redeployment and gives agents the ability to inspect and modify their own pipeline.

## The Gate Is the Design

In earned escalation, the gate is not a validation layer bolted on at the end. The gate is the central design decision. Every state transition must answer: what evidence is required, and how is it verified deterministically?

- Not: does the output look correct to the agent?
- Not: does the agent believe the output is correct?
- Yes: does the shell command return exit code 0?

The agent does work. The gate decides if the work is sufficient. These are separate concerns performed by separate systems.

### Gate Output as Next-Agent Specification

A gate's failure output is not a consolation message. It is the **specification for the next agent invocation**. The gate knows exactly what went wrong — a missing spec comment, a failing test, an unresolved review finding. The failure prompt should encode that knowledge as actionable instructions. Each correction attempt is more likely to succeed when the gate tells the agent exactly what to fix, not just that something is wrong.

This makes the flow definition itself the primary engineering artifact. The flow author is not configuring a workflow — they are writing the prompts, the gates, the failure specifications, and the context assembly hooks that determine whether agents spend their tokens on work or on figuring out what work to do. 90% of the engineering effort is in the flow definition: getting the context assembly right, getting the gate predicates right, getting the failure prompts right. The agent is the easy part.

## Composability

Earned escalation and durable execution are not mutually exclusive. A pipeline can use durable execution for stages where completion is the only concern, and earned escalation at boundaries where verification is required. The key is recognizing which question each stage is answering.

---

See [WOPR implementation](../../wopr/manifesto/earned-escalation-vs-durable-execution.md)
