# Stage 1: Architect — The WOPR Implementation

> Implements: [method/pipeline/stages/01-architect.md](../../../method/pipeline/stages/01-architect.md)

---

## Invocation

The architect is spawned by `/wopr:auto` when an issue enters the pipeline:

```
Task({
  subagent_type: "wopr-architect",
  name: "architect-81",
  model: "opus",
  team_name: "wopr-auto",
  run_in_background: true,
  prompt: "<assignment>"
})
```

The agent definition lives at `~/.claude/agents/wopr/wopr-architect.md`.

## The Read-Only Constraint in Practice

The architect prompt includes an explicit constraint:

```
## YOUR ROLE — READ ONLY
You are a spec writer, NOT a coder. Do NOT create, edit, or write any code files.
Do NOT create branches, worktrees, or PRs. Do NOT run git checkout or git commit.
Your ONLY deliverable is an implementation spec posted as a Linear comment.
Read the codebase at the path below for context only.
```

The architect reads the codebase at `/home/tsavo/<repo>` (the main clone, not a worktree) using `Read`, `Grep`, and `Glob` tools.

## The Spec Format

The architect posts its spec as a comment on the Linear issue via:

```
mcp__linear-server__save_comment({
  issueId: "<ISSUE_ID>",
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

## Agent Routing

The pipeline lead routes based on issue type:

| Signal | Treatment |
|--------|-----------|
| Repo is `wopr-platform-ui` | Technical architect (opus) THEN UI architect (opus) THEN designer (opus) |
| Description contains "Design Tooling (MANDATORY)" | Same as above |
| Labels include `wopr-platform` + UI keywords in title | Same as above |
| Everything else | Technical architect (opus) THEN coder (sonnet) |

For UI stories, the UI architect posts a design spec covering:
- Aesthetic direction (dark-mode-first, WOPR brand)
- Typography (font choices, hierarchy)
- Color palette (specific hex values)
- Animations and transitions
- Responsive strategy

## Completion Signal

```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "Spec ready: WOP-81",
  summary: "Spec posted for WOP-81"
})
```

For UI architects:
```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "Design ready: WOP-81",
  summary: "Design spec posted for WOP-81"
})
```

## Model Choice

**Opus** for architects. The spec is the contract — a shallow spec causes every downstream agent to fail. The reasoning cost is front-loaded here to save it everywhere else.
