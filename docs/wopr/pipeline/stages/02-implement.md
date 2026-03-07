# Stage 2: Implement — The WOPR Implementation

> Implements: [method/pipeline/stages/02-implement.md](../../../method/pipeline/stages/02-implement.md)

---

## Worktree Setup via onEnter

Before the `coding` state becomes claimable, DEFCON runs the `onEnter` hook configured on the state:

```json
{
  "name": "coding",
  "onEnter": {
    "command": "scripts/create-worktree.sh {{entity.refs.github.repo}} {{entity.refs.linear.key}}",
    "artifacts": ["worktreePath", "branch"],
    "timeout_ms": 60000
  }
}
```

The `create-worktree.sh` script:
1. Fetches and pulls the main clone at `/home/tsavo/<repo>`
2. Creates an isolated worktree at `/home/tsavo/worktrees/wopr-<repo>-coder-<ISSUE_NUM>`
3. Creates branch `agent/coder-<ISSUE_NUM>/<issue-key-lowercase>` from `origin/main`
4. Runs `pnpm install --frozen-lockfile`
5. Returns `{ "worktreePath": "...", "branch": "..." }` as JSON

DEFCON merges the output into `entity.artifacts`. The coder receives `{{entity.artifacts.worktreePath}}` and `{{entity.artifacts.branch}}` already populated in its prompt.

The pipeline lead does not run `git worktree add` manually.

See [onenter-hooks.md](../onenter-hooks.md) for full onEnter documentation.

---

## The Coding State

The `coding` state is configured in `seeds/wopr-changeset.json`:

```json
{
  "name": "coding",
  "flowName": "wopr-changeset",
  "modelTier": "sonnet",
  "mode": "active",
  "promptTemplate": "Your name is \"coder-{{entity.refs.linear.id}}\"..."
}
```

- **Active mode**: DEFCON spawns a Sonnet agent with the rendered coding prompt.
- **Passive mode**: The engineering worker that called `flow.claim` receives the coding prompt after `flow.report({ signal: "spec_ready" })` advances the entity.

There is no `~/.claude/agents/wopr/wopr-coder.md` file. The prompt template in the seed IS the agent definition.

---

## The Spec-First Process

The coder reads the architect's spec from Linear:

```
mcp__linear-server__list_comments({ issueId: "{{entity.refs.linear.id}}" })
```

Then follows the spec step by step:
1. Write the test first (it must fail)
2. Implement the minimal code to pass the test
3. Run the targeted test: `npx vitest run <test-file>`
4. **Never** `pnpm test` in worktrees (OOMs — standing order in MEMORY.md)

---

## PR Creation

```bash
cd {{entity.artifacts.worktreePath}}
git add <specific-files>
git commit -m "feat(<area>): <description>

Closes {{entity.refs.linear.key}}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push -u origin {{entity.artifacts.branch}}

gh pr create \
  --repo {{entity.refs.github.repo}} \
  --title "feat: {{entity.refs.linear.title}} ({{entity.refs.linear.key}})" \
  --body "## Summary
- <changes>

Closes {{entity.refs.linear.key}}

## Test Plan
- <what was tested>"
```

---

## Completion Signal

The coder sends to team-lead:

```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "PR created: https://github.com/wopr-network/wopr/pull/42 for WOP-81",
  summary: "PR #42 created for WOP-81"
})
```

Then calls `flow.report` with artifacts:

```json
{
  "workerId": "wkr_abc123",
  "entityId": "feat-392",
  "signal": "pr_created",
  "artifacts": {
    "prUrl": "https://github.com/wopr-network/wopr/pull/42",
    "prNumber": "42"
  }
}
```

DEFCON evaluates `ci-green` then `review-bots-ready` gates before advancing to `reviewing`.

---

## Known Gotchas

- **OOM in worktrees**: `pnpm test` tries to run all 4000+ tests. Use `npx vitest run <file>`.
- **Don't index worktrees**: `node_modules` makes Claude Code indexing take 20+ minutes.
- **Frozen lockfile**: Always `pnpm install --frozen-lockfile` — never `pnpm install` (modifies lockfile).
- **Push real commit for CI**: GitHub Actions CI needs a real commit push to trigger. Empty pushes don't trigger workflows.
