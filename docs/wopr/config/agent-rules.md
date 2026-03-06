# Agent Rules — The WOPR Implementation

> Implements: [method/config/agent-rules.md](../../method/config/agent-rules.md)

---

## WOPR's Instruction Layers

### Layer 1: Organization Rules

Applies to ALL agents across ALL wopr-network repos.

**Source**: Baked into skill definitions (`/wopr:auto`, `/wopr:groom`, etc.) and agent prompts.

Rules:
- Conventional commits with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`
- Squash merge, delete branch after merge
- Never commit secrets (`.env` files)
- Issue descriptions start with `**Repo:** wopr-network/<repo>`
- Linear issues always created with `state: "Todo"` (never Triage)

### Layer 2: Project/Repo Rules (CLAUDE.md)

Each repo has a `CLAUDE.md` at root with repo-specific rules.

**Examples from wopr CLAUDE.md**:
```markdown
## Gotchas
- **fleet**: Container names use wopr- prefix; node agent uses tenant_ prefix
- **tests**: Never run pnpm test in worktrees — OOMs
- **biome**: @ts-ignore is banned; use declare module ambient declarations
```

**Examples from wopr-platform CLAUDE.md**:
```markdown
## Build
- pnpm lint && pnpm format && pnpm build && pnpm test

## Database
- Drizzle ORM with repository pattern
- No raw SQL outside repository modules
- Migrations via drizzle-kit
```

Agents read CLAUDE.md first when entering a repo.

### Layer 3: Agent Role Rules (Definition Files)

Agent definitions at `~/.claude/agents/wopr/`:

| File | Key Rules |
|------|-----------|
| `wopr-architect.md` | READ ONLY. No code, no branches, no PRs. Only output: spec as Linear comment. |
| `wopr-coder.md` | Implement FROM spec. TDD. Targeted tests only. Work in assigned worktree. |
| `wopr-reviewer.md` | Check CI first. Wait for all bots. Read all 3 comment feeds. Never CLEAN with open Qodo suggestions. |
| `wopr-fixer.md` | Rebase first. Fix findings only. Minimal changes. Don't refactor. |
| `wopr-devops.md` | Read RUNBOOK.md first. Record every operation. Never skip health checks. |

### Layer 4: Assignment Rules (Per-Invocation)

Passed in the `prompt` parameter of each `Task()` call:

```
Your name is "coder-81". You are on the wopr-auto team.

## Assignment
Issue: WOP-81 — Session management
Linear ID: abc-123
Repo: wopr-network/wopr
Worktree: /home/tsavo/worktrees/wopr-wopr-coder-81
Branch: agent/coder-81/wop-81
```

## Standing Orders (MEMORY.md)

Some rules apply across sessions and are stored in `~/.claude/projects/*/memory/MEMORY.md`:

```markdown
## STANDING ORDERS
- NEVER run pnpm test in worktrees — OOMs. Use npx vitest run <specific-file>.
- Build slot cap: 4. Reviewers/watchers free.
- wopr merge queue: use GraphQL enqueuePullRequest mutation.
- wopr-plugin-* (no merge queue): gh pr merge --squash --auto.
- biome noTsIgnore: @ts-ignore is banned.
- Stale Qodo comments: If line: null, it's outdated. Reply to resolve, don't block on it.
```

## Rule File Locations

| Layer | File | Scope |
|-------|------|-------|
| Org | Skill definitions | All repos |
| Project | `/home/tsavo/<repo>/CLAUDE.md` | One repo |
| Role | `~/.claude/agents/wopr/<agent>.md` | One agent type |
| Assignment | `Task({ prompt: "..." })` | One invocation |
| Standing | `~/.claude/projects/*/memory/MEMORY.md` | Cross-session |

## Rule Evolution in WOPR

Real examples of the feedback loop:

1. **@ts-ignore** — agents kept using it → caught in review 3x → added `noTsIgnore` to biome.json → now a CI gate

2. **pnpm test OOM** — agents ran full test suite in worktrees → OOM killed → added to CLAUDE.md as gotcha → added to MEMORY.md as standing order

3. **Missing inline comments** — reviewer used `gh pr view` (no inline comments) → missed Qodo findings → added standing order: "ALWAYS call `gh api repos/.../pulls/<N>/comments`"

4. **Stale Qodo line:null** — reviewer treated outdated Qodo comments as blocking → couldn't declare CLEAN → added standing order: "If line: null, reply to resolve, don't block"

5. **Merge queue mutations** — `gh pr merge` doesn't work with merge queue → discovered GraphQL `enqueuePullRequest` → added to MEMORY.md standing orders
