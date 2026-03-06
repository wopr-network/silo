# Stage 4: Fix — The WOPR Implementation

> Implements: [method/pipeline/stages/04-fix.md](../../../method/pipeline/stages/04-fix.md)

---

## The Fixer Agent

```
Task({
  subagent_type: "wopr-fixer",
  name: "fixer-81",
  model: "sonnet",
  team_name: "wopr-auto",
  run_in_background: true,
  prompt: "Your name is fixer-81. You are on the wopr-auto team.
    PR: https://github.com/wopr-network/wopr/pull/42 (#42)
    Issue: WOP-81
    Repo: wopr-network/wopr
    Worktree: /home/tsavo/worktrees/wopr-wopr-coder-81
    Branch: agent/coder-81/wop-81

    ## Step 1: Rebase before touching anything
    cd /home/tsavo/worktrees/wopr-wopr-coder-81
    git fetch origin
    git rebase origin/main

    ## Step 2: Fix the findings

    ## Reviewer Findings
    - Missing null check in auth.ts:42 (Qodo)
    - Unused import in handler.ts:3 (agent review)"
})
```

The agent definition lives at `~/.claude/agents/wopr/wopr-fixer.md`.

## Worktree Reuse

The fixer reuses the coder's worktree — no new worktree is created:

```
/home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM>
```

If the worktree was cleaned up (e.g., after a CLEAN verdict that later got ejected from merge queue), re-create it:

```bash
cd /home/tsavo/<repo> && git fetch origin
git worktree add /home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM> <branch>
cd /home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM> && pnpm install --frozen-lockfile
```

## Rebase Protocol

The fixer ALWAYS rebases before making changes:

```bash
cd /home/tsavo/worktrees/wopr-wopr-coder-81
git fetch origin
git rebase origin/main
```

If rebase conflicts:
1. Attempt to resolve
2. `git rebase --continue`
3. If unresolvable: `"Can't resolve: <PR_URL> — rebase conflict in <filename>: <description>"`

## Fix Commit Style

```bash
git add <specific-files>
git commit -m "fix: address review findings

- Add null check in auth.ts
- Remove unused import in handler.ts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push origin agent/coder-81/wop-81
```

## Completion Signals

Success:
```
"Fixes pushed: https://github.com/wopr-network/wopr/pull/42"
```

Escalation:
```
"Can't resolve: https://github.com/wopr-network/wopr/pull/42 — rebase conflict in schema.ts: migration column order"
```

## CI Trigger

After pushing fixes, CI re-runs automatically (GitHub Actions triggers on push to PR branch). The next reviewer will check CI status before reviewing code.

**Known gotcha**: Push a real commit to trigger CI. Empty pushes or `--allow-empty` may not trigger workflows on all repos.

## CLAUDE.md Learning

After a fix cycle completes (fixer ran at least once AND reviewer says CLEAN), the pipeline lead spawns a one-shot CLAUDE.md updater:

```
Task({
  subagent_type: "general-purpose",
  name: "claude-md-updater-81",
  model: "haiku",
  prompt: "Read /home/tsavo/wopr/CLAUDE.md. For each finding,
    ask: does this represent a generalizable invariant?
    If YES: add one line under ## Gotchas.
    At most 3 new lines per PR. Keep CLAUDE.md under 1000 lines."
})
```

This is how the feedback loop turns review findings into persistent rules.
