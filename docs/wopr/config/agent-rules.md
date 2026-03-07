# Agent Rules — The WOPR Implementation

> Implements: [method/config/agent-rules.md](../../method/config/agent-rules.md)

---

## WOPR's Instruction Layers

### Layer 1: Organization Rules

Applies to ALL agents across ALL wopr-network repos.

**Source**: Baked into flow seed prompt templates and DEFCON configuration.

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

### Layer 3: State Prompt Templates

Agent role rules are embedded in the `promptTemplate` of each state in the seed file. There are no separate `~/.claude/agents/wopr/*.md` files.

| State | Key Rules in Template |
|-------|----------------------|
| `architecting` | READ ONLY. No code, no branches, no PRs. Only output: spec as Linear comment. |
| `coding` | Implement FROM spec. TDD. Targeted tests only (`npx vitest run <file>`). Work in `entity.artifacts.worktreePath`. |
| `reviewing` | Check CI first. Wait for all bots. Read all 3 comment feeds. Never CLEAN with open Qodo suggestions. |
| `fixing` | Rebase first. Fix findings only. Minimal changes. Don't refactor. |
| `merging` | Watch PR. Report MERGED/BLOCKED/CLOSED/TIMEOUT. |

### Layer 4: Entity Context

Per-invocation context comes from `entity.refs` and `entity.artifacts` — populated by DEFCON at render time. This replaces the old pattern of the pipeline lead constructing a `Task({ prompt: "..." })` string with issue keys and worktree paths.

| Data | Template variable | Set by |
|------|------------------|--------|
| Issue key, title, description | `entity.refs.linear.*` | DEFCON on entity creation |
| GitHub repo | `entity.refs.github.repo` | DEFCON on entity creation |
| Worktree path, branch | `entity.artifacts.worktreePath`, `.branch` | `onEnter` hook on `coding` state |
| PR URL, number | `entity.artifacts.prUrl`, `.prNumber` | Worker via `flow.report` artifacts |
| Review findings | `entity.artifacts.reviewFindings` | Worker via `flow.report` artifacts |
| Gate failures | `entity.artifacts.gate_failures` | DEFCON on gate failure |

### Layer 5: Standing Orders (MEMORY.md)

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

---

## Rule File Locations

| Layer | Source | Scope |
|-------|--------|-------|
| Org | Baked into flow seed prompts | All flows |
| Project | `/home/tsavo/<repo>/CLAUDE.md` | One repo |
| Role | `states[].promptTemplate` in seed file | One state |
| Assignment | `entity.refs` + `entity.artifacts` | One invocation |
| Standing | `~/.claude/projects/*/memory/MEMORY.md` | Cross-session |

---

## Rule Evolution in WOPR

Real examples of the feedback loop:

1. **@ts-ignore** — agents kept using it → caught in review 3x → added `noTsIgnore` to biome.json → now a CI gate

2. **pnpm test OOM** — agents ran full test suite in worktrees → OOM killed → added to CLAUDE.md as gotcha → added to MEMORY.md as standing order → now enforced in seed prompt templates

3. **Missing inline comments** — reviewer used `gh pr view` (no inline comments) → missed Qodo findings → added standing order: "ALWAYS call `gh api repos/.../pulls/<N>/comments`" → now in reviewing state promptTemplate

4. **Stale Qodo line:null** — reviewer treated outdated Qodo comments as blocking → couldn't declare CLEAN → added standing order: "If line: null, reply to resolve, don't block" → now in reviewing state promptTemplate

5. **Merge queue mutations** — `gh pr merge` doesn't work with merge queue → discovered GraphQL `enqueuePullRequest` → added to MEMORY.md standing orders
