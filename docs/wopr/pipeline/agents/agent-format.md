# Agent Definition Format — The WOPR Implementation

> Implements: [method/pipeline/agents/agent-format.md](../../../method/pipeline/agents/agent-format.md)

---

## Where Agent Definitions Live

WOPR agent definitions are prompt templates on state definitions in the seed file. There is no `~/.claude/agents/wopr/` directory. There are no separate agent definition files.

Each state in `seeds/wopr-changeset.json` has a `promptTemplate` field. That template, rendered with Handlebars against the current entity's context, is the agent's complete instructions.

---

## Prompt Template Structure

Each `promptTemplate` contains:

1. **Identity** — who the agent is (`"Your name is \"architect-{{entity.refs.linear.id}}\""`)
2. **Role constraints** — what the agent must and must not do
3. **Assignment context** — issue key, repo, worktree path, PR URL, etc.
4. **Process** — numbered steps, specific and actionable
5. **Prior gate failures** — surfaced via `{{#if entity.artifacts.gate_failures}}` block
6. **Output contract** — exact completion signal to send

---

## Handlebars Context

Templates have access to:

| Variable | Source | Example |
|----------|--------|---------|
| `{{entity.refs.linear.key}}` | Linear issue key | `WOP-392` |
| `{{entity.refs.linear.id}}` | Linear issue UUID | `abc-123-def` |
| `{{entity.refs.linear.title}}` | Issue title | `Add session management` |
| `{{entity.refs.linear.description}}` | Issue body | Full markdown |
| `{{entity.refs.github.repo}}` | GitHub repo | `wopr-network/wopr` |
| `{{entity.artifacts.worktreePath}}` | Set by onEnter | `/home/tsavo/worktrees/wopr-wopr-coder-392` |
| `{{entity.artifacts.branch}}` | Set by onEnter | `agent/coder-392/wop-392` |
| `{{entity.artifacts.prUrl}}` | Set by worker | `https://github.com/.../pull/42` |
| `{{entity.artifacts.prNumber}}` | Set by worker | `42` |
| `{{entity.artifacts.reviewFindings}}` | Set by reviewer | Findings text |
| `{{flow.name}}` | Flow definition | `wopr-changeset` |

---

## Example: architecting State Template

From `seeds/wopr-changeset.json`:

```
Your name is "architect-{{entity.refs.linear.id}}". You are on the {{flow.name}} team.

## YOUR ROLE — READ ONLY
You are a spec writer, NOT a coder. Do NOT create, edit, or write any code files.
Do NOT create branches, worktrees, or PRs. Do NOT run git checkout or git commit.
Your ONLY deliverable is an implementation spec posted as a Linear comment.
Read the codebase at the path below for context only. Then post your spec and
send "Spec ready: {{entity.refs.linear.key}}" to team-lead.

## Assignment
Issue: {{entity.refs.linear.key}} — {{entity.refs.linear.title}}
Linear ID: {{entity.refs.linear.id}}
Repo: {{entity.refs.github.repo}}
Codebase (READ ONLY): {{entity.artifacts.codebasePath}}

## Issue Description
{{entity.refs.linear.description}}

## Deliverable
Post a detailed implementation spec as a Linear comment...
```

This is the complete agent definition. No external file. No `subagent_type`.

---

## Gate Failure Context

When a gate fails and the entity re-enters a state (e.g., `coding` after CI failure), the prompt template includes prior failures via the `gate_failures` block:

```
{{#if entity.artifacts.gate_failures}}
## Prior Gate Failures — Address These
{{#each entity.artifacts.gate_failures}}
- **{{this.gateName}}** ({{this.failedAt}}): {{this.output}}
{{/each}}
{{/if}}
```

This surfaces the specific gate output to the worker without requiring the pipeline lead to manually copy error messages.

---

## Per-Invocation Context

Per-invocation context comes from `entity.refs` and `entity.artifacts`, not from a hardcoded prompt string passed by the pipeline lead. The pipeline lead does not construct prompts — the seed file defines them. DEFCON renders them with the current entity's data at claim time.

This means:
- The same template works for WOP-81, WOP-462, and any future issue
- The architect and coder receive consistent, complete instructions
- Gate failure context is automatically injected when relevant
- No copy-paste of issue keys, repo names, or worktree paths by the pipeline lead
