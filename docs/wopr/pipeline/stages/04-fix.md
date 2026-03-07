# Stage 4: Fix — The WOPR Implementation

> Implements: [method/pipeline/stages/04-fix.md](../../../method/pipeline/stages/04-fix.md)

---

## The Fixing State

When the reviewer signals `issues`, the entity transitions to `fixing`. DEFCON injects `entity.artifacts.reviewFindings` into the `fixing` state's promptTemplate:

```
## Reviewer Findings
{{entity.artifacts.reviewFindings}}

Address each finding. Run targeted tests after each fix: `npx vitest run <test-file>`
```

The fixer is the same engineering worker that has been handling the entity all along — no new spawn, no new claim. The worker calls `flow.report({ signal: "issues", artifacts: { reviewFindings } })` and receives the fixing prompt as the response.

- **Active mode**: DEFCON spawns a Sonnet agent with the rendered fixing prompt.
- **Passive mode**: The engineering worker receives the fixing prompt as the `flow.report` response.

There is no `~/.claude/agents/wopr/wopr-fixer.md` file. The prompt template in the seed IS the agent definition.

---

## Worktree Reuse

The fixer reuses the worktree created by the `onEnter` hook during the `coding` state:

```
{{entity.artifacts.worktreePath}}
```

This path was created before coding began and persists across all states. The fixer does not create a new worktree.

If the worktree was manually cleaned up (uncommon), re-create it:

```bash
cd /home/tsavo/<repo> && git fetch origin
git worktree add {{entity.artifacts.worktreePath}} {{entity.artifacts.branch}}
cd {{entity.artifacts.worktreePath}} && pnpm install --frozen-lockfile
```

---

## Rebase Protocol

The fixer ALWAYS rebases before making changes:

```bash
cd {{entity.artifacts.worktreePath}}
git fetch origin
git rebase origin/main
```

If rebase conflicts:
1. Attempt to resolve
2. `git rebase --continue`
3. If unresolvable: send `"Can't resolve: {{entity.artifacts.prUrl}} — rebase conflict in <filename>: <description>"`

---

## Fix Commit Style

```bash
git add <specific-files>
git commit -m "fix: address review findings

- Add null check in auth.ts
- Remove unused import in handler.ts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push origin {{entity.artifacts.branch}}
```

---

## Completion Signals

The fixer calls `flow.report`:

```json
{
  "workerId": "wkr_abc123",
  "entityId": "feat-392",
  "signal": "fixes_pushed"
}
```

Entity returns to `reviewing`. The reviewer sees prior gate failures via `{{entity.artifacts.gate_failures}}` in the prompt template — no need for the pipeline lead to pass findings manually.

Escalation (can't fix):
```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "Can't resolve: https://github.com/wopr-network/wopr/pull/42 — rebase conflict in schema.ts: migration column order"
})
```

---

## CI Trigger

After pushing fixes, CI re-runs automatically (GitHub Actions triggers on push to PR branch). The `ci-green` gate will re-evaluate before the entity can advance to `reviewing` again.

**Known gotcha**: Push a real commit to trigger CI. Empty pushes or `--allow-empty` may not trigger workflows on all repos.

---

## CLAUDE.md Learning

After a fix cycle completes (entity reaches `done` via a path that included at least one `fixing` state), the pipeline lead may spawn a CLAUDE.md updater based on the findings in `entity.artifacts.reviewFindings`. This is the feedback loop: review findings → persistent rules → CI gates.
