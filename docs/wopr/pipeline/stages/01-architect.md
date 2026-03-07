# Stage 1: Architect — The WOPR Implementation

> Implements: [method/pipeline/stages/01-architect.md](../../../method/pipeline/stages/01-architect.md)

---

## Invocation

When an entity enters the `architecting` state:

- **Active mode**: DEFCON spawns an Opus agent with the `architecting` state's rendered `promptTemplate`. No `Task()` call needed from the pipeline lead.
- **Passive mode**: An engineering worker that called `flow.claim` receives the rendered `architecting` prompt as the response.

The `architecting` state is configured in `seeds/wopr-changeset.json`:

```json
{
  "name": "architecting",
  "flowName": "wopr-changeset",
  "modelTier": "opus",
  "mode": "active",
  "promptTemplate": "..."
}
```

There is no `~/.claude/agents/wopr/wopr-architect.md` file. The prompt template in the seed IS the agent definition.

---

## The Read-Only Constraint in Practice

The `architecting` prompt template includes an explicit constraint:

```
## YOUR ROLE — READ ONLY
You are a spec writer, NOT a coder. Do NOT create, edit, or write any code files.
Do NOT create branches, worktrees, or PRs. Do NOT run git checkout or git commit.
Your ONLY deliverable is an implementation spec posted as a Linear comment.
```

The architect reads the codebase at `{{entity.artifacts.codebasePath}}` (the main clone, not a worktree) using `Read`, `Grep`, and `Glob` tools.

---

## The Spec Format

The architect posts its spec as a comment on the Linear issue via:

```
mcp__linear-server__save_comment({
  issueId: "{{entity.refs.linear.id}}",
  body: "<spec>"
})
```

The spec contains:
1. **Files to create or modify** — exact paths relative to repo root
2. **Function signatures** — TypeScript types, parameters, return types
3. **Data structures** — interfaces, schemas, database tables
4. **Implementation steps** — numbered, specific, actionable
5. **Test plan** — which test files to create/modify, what to assert
6. **Edge cases and gotchas** — from CLAUDE.md and codebase analysis
7. **Dependencies** — npm packages to add, cross-file impacts

---

## Completion Signal

The architect sends to team-lead:

```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "Spec ready: WOP-81",
  summary: "Spec posted for WOP-81"
})
```

Then calls `flow.report` (in passive mode) or DEFCON advances automatically (in active mode):

```json
{
  "workerId": "wkr_abc123",
  "entityId": "feat-392",
  "signal": "spec_ready"
}
```

DEFCON evaluates the `spec-posted` gate (verifies the spec comment exists in Linear), then advances to `coding`.

---

## Model Choice

**Opus** for `architecting`. The spec is the contract — a shallow spec causes every downstream state to fail. The reasoning cost is front-loaded here to save it everywhere else.
