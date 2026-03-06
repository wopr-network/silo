# Stage 2: Implement — The WOPR Implementation

> Implements: [method/pipeline/stages/02-implement.md](../../../method/pipeline/stages/02-implement.md)

---

## Worktree Setup

Before the coder spawns, the pipeline lead creates an isolated worktree:

```bash
cd /home/tsavo/<repo>
git fetch origin && git pull origin main
git worktree add /home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM> \
  -b agent/coder-<ISSUE_NUM>/<issue-key-lowercase> origin/main
cd /home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM>
pnpm install --frozen-lockfile
```

**Critical**: Do NOT index the worktree (`node_modules` makes it take 20+ minutes). The main clone at `/home/tsavo/<repo>` is already indexed — agents query that for codebase context.

## The Coder Agent

```
Task({
  subagent_type: "wopr-coder",
  name: "coder-81",
  model: "sonnet",
  team_name: "wopr-auto",
  run_in_background: true,
  prompt: "Your name is coder-81. You are on the wopr-auto team.
    Issue: WOP-81 — Session management
    Repo: wopr-network/wopr
    Worktree: /home/tsavo/worktrees/wopr-wopr-coder-81
    Branch: agent/coder-81/wop-81
    ..."
})
```

The agent definition lives at `~/.claude/agents/wopr/wopr-coder.md`.

## The Spec-First Process

The coder reads the architect's spec from Linear:

```
mcp__linear-server__list_comments({ issueId: "<ISSUE_ID>" })
```

Then follows the spec step by step:
1. Write the test first (it must fail)
2. Implement the minimal code to pass the test
3. Run the targeted test: `npx vitest run <test-file>`
4. **Never** `pnpm test` in worktrees (OOMs — standing order in MEMORY.md)

## PR Creation

```bash
cd /home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM>
git add <specific-files>
git commit -m "feat(<area>): <description>

Closes WOP-81

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push -u origin agent/coder-81/wop-81

gh pr create \
  --repo wopr-network/<repo> \
  --title "feat(<area>): <description> (WOP-81)" \
  --body "## Summary
- <changes>

Closes WOP-81

## Test Plan
- <what was tested>"
```

## Completion Signal

```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "PR created: https://github.com/wopr-network/wopr/pull/42 for WOP-81",
  summary: "PR #42 created for WOP-81"
})
```

## UI Stories: Designer Agent

For UI stories, the designer agent (opus) replaces the coder (sonnet):

```
Task({
  subagent_type: "wopr-ui-designer",
  name: "designer-462",
  model: "opus",
  ...
})
```

The designer reads BOTH specs from Linear (technical + design) and implements with:
- Dark-mode-first design (WOPR brand)
- No generic shadcn defaults
- Polished typography, animations, responsive strategy
- The design spec's color palette and aesthetic direction

## Known Gotchas

- **OOM in worktrees**: `pnpm test` tries to run all 4000+ tests. Use `npx vitest run <file>`.
- **Don't index worktrees**: `node_modules` makes Claude Code indexing take 20+ minutes.
- **Frozen lockfile**: Always `pnpm install --frozen-lockfile` — never `pnpm install` (modifies lockfile).
- **Push real commit for CI**: GitHub Actions CI needs a real commit push to trigger. Empty pushes don't trigger workflows.
