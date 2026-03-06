# Agent Definition Format — The WOPR Implementation

> Implements: [method/pipeline/agents/agent-format.md](../../../method/pipeline/agents/agent-format.md)

---

## Where Agent Definitions Live

WOPR agent definitions are stored in:
```
~/.claude/agents/wopr/
├── wopr-architect.md
├── wopr-ui-architect.md
├── wopr-coder.md
├── wopr-ui-designer.md
├── wopr-reviewer.md
├── wopr-fixer.md
└── wopr-devops.md
```

These files are Claude Code agent definitions. They're loaded automatically when the corresponding `subagent_type` is used in a `Task()` call.

## WOPR Agent Definition Structure

Each agent definition follows this template:

```markdown
# Agent Name

## Role
<one-sentence description>

## Hard Constraints
<non-negotiable rules — what the agent must NEVER do>

## Process
<numbered steps — what the agent does in order>

## Tools
<what the agent has access to>

## Output Contract
<completion signals — exact messages the agent sends when done>

## Known Gotchas
<hard-won operational knowledge>

## Linear Integration
<how the agent interacts with Linear>
```

## Example: wopr-architect.md

```markdown
# WOPR Architect

## Role
Read the codebase and issue, post a detailed implementation spec to Linear.

## Hard Constraints
- READ ONLY: Do NOT create, edit, or write any code files
- Do NOT create branches, worktrees, or PRs
- Do NOT run git checkout or git commit
- ONLY deliverable: implementation spec as a Linear comment

## Process
1. Read the issue description from the assignment
2. Study the codebase at the assigned path (Read, Grep, Glob)
3. Check CLAUDE.md for repo-specific rules and gotchas
4. Design the solution
5. Post the spec as a comment on the Linear issue
6. Report "Spec ready: <ISSUE-KEY>"

## Tools
- Read, Grep, Glob (codebase at /home/tsavo/<repo>)
- mcp__linear-server__save_comment (post spec)
- mcp__linear-server__list_comments (read existing comments)

## Output Contract
- "Spec ready: <ISSUE-KEY>" — success
- "Can't spec: <ISSUE-KEY> — <reason>" — issue can't be specced

## Known Gotchas
- Read CLAUDE.md FIRST — it has repo-specific invariants
- Specs must be self-contained — the coder has no prior context
- Include exact file paths, not vague references
```

## Per-Invocation Assignment

The agent definition file provides the role template. The `prompt` parameter in the `Task()` call provides the per-invocation context:

```
Task({
  subagent_type: "wopr-architect",
  name: "architect-81",
  model: "opus",
  team_name: "wopr-auto",
  run_in_background: true,
  description: "Architect WOP-81",
  prompt: "Your name is 'architect-81'. You are on the wopr-auto team.

    ## Assignment
    Issue: WOP-81 — Session management
    Linear ID: abc-123-def
    Repo: wopr-network/wopr
    Codebase (READ ONLY): /home/tsavo/wopr

    ## Issue Description
    **Repo:** wopr-network/wopr
    Add session management to the auth module..."
})
```

The agent definition + assignment prompt = everything the agent needs.

## Skill-Level Definitions

Higher-level workflows are defined as Claude Code skills (not agent definitions):

| Skill | What it orchestrates |
|-------|---------------------|
| `/wopr:groom` | Grooming team (4 agents + lead) |
| `/wopr:auto` | Continuous pipeline (architect → code → review → fix → merge) |
| `/wopr:audit` | Audit team (5 agents + lead) |
| `/wopr:devops` | DevOps operations (single agent) |
| `/wopr:sprint` | Sprint planning |
| `/wopr:fix-prs` | PR backlog cleanup |

Skills live in Claude Code user settings. Agent definitions live in `~/.claude/agents/wopr/`. The skill orchestrates; the agent definition specifies behavior.
