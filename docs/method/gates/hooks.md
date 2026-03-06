# Development Hooks

Inline gates that run during the development process — before commits, before pushes, before edits.

---

## What is a Hook?

A hook is a gate that runs at a specific point in the development workflow. Unlike CI gates (which run in a pipeline), hooks run on the developer's machine (or the agent's environment) at the moment of action.

```
Developer writes code
  ↓
git commit
  ↓
[PRE-COMMIT HOOK]  ←── gate runs HERE
  ↓ pass
Commit created
  ↓
git push
  ↓
[PRE-PUSH HOOK]  ←── gate runs HERE
  ↓ pass
Code pushed
```

If the hook fails, the action is blocked. The commit doesn't happen. The push doesn't happen. The code doesn't leave the developer's machine until it passes the gate.

## Why Hooks Matter for Agents

Agents generate code fast. Without hooks, an agent can:
- Commit code with lint errors
- Push code with type errors
- Create a PR with failing tests
- Include unused imports, debug logs, or formatting violations

Hooks catch these at the earliest possible point — before the code even enters version control. This is orders of magnitude cheaper than catching them in CI.

## Hook Taxonomy

### Pre-Commit Hooks

Run before a commit is created. The cheapest gate — catches issues before they enter history.

| Check | What it catches | Speed |
|-------|----------------|-------|
| Linter | Unused imports, dead code, style violations | Fast (< 5s) |
| Formatter | Inconsistent formatting | Fast (< 2s) |
| Type checker | Type errors, interface mismatches | Medium (5-30s) |
| Secret scanner | API keys, passwords, tokens | Fast (< 2s) |

**The rule**: Pre-commit hooks must be fast. If a hook takes > 30 seconds, it belongs in CI, not pre-commit.

### Pre-Push Hooks

Run before code is pushed to the remote. More expensive checks that would slow down individual commits.

| Check | What it catches | Speed |
|-------|----------------|-------|
| Targeted tests | Regressions in changed files | Medium (10-60s) |
| Build verification | Compilation errors | Medium (10-30s) |
| Schema validation | Protocol/API schema drift | Fast (< 5s) |

### Pre-Edit Hooks (Agent-Specific)

Some agent platforms support hooks that run before a file is edited. These provide context:

- "What does this file do?"
- "What patterns does the codebase use?"
- "Are there relevant tests?"

Pre-edit hooks don't block — they inform. They help agents make better decisions before writing code.

### Post-Edit Hooks (Agent-Specific)

Run after a file is modified. These learn from the edit:

- Record what changed and why
- Detect patterns in agent behavior
- Flag potential issues in the edit

## The Gate Chain

Hooks and CI gates form a chain from development to production:

```
Edit code
  ↓ [pre-edit hook: context]
  ↓ [post-edit hook: learning]
  ↓
Commit
  ↓ [pre-commit: lint, format, type check, secret scan]
  ↓
Push
  ↓ [pre-push: targeted tests, build]
  ↓
CI
  ↓ [full test suite, all gates]
  ↓
Review
  ↓ [review bot sync, agent review]
  ↓
Merge
  ↓ [merge queue: integrated CI]
  ↓
Deploy
  ↓ [pre-deploy: migration safety, secret validation]
  ↓
Production
  ↓ [post-deploy: health, smoke tests, metrics]
```

Each layer catches what the previous layer missed. Earlier layers are cheaper. The total cost of a bug is determined by which layer catches it:

| Caught At | Cost |
|-----------|------|
| Pre-edit | ~$0 (immediate feedback) |
| Pre-commit | ~$0 (local, instant) |
| Pre-push | Low (local, seconds) |
| CI | Medium (pipeline run, minutes) |
| Review | High (review cycle, hours) |
| Production | Very high (incident, customer impact) |

## Hook Management

### Configuration

Hooks should be:
- **Version controlled** — checked into the repo, not configured per-machine
- **Consistent** — every developer/agent gets the same hooks
- **Skippable with audit** — `--no-verify` exists for emergencies, but its use should be logged and reviewed

### For Agents

Agents should **never** skip hooks. If a hook fails, the agent must fix the issue and retry. The `--no-verify` flag is a human escape hatch, not an agent shortcut.

### For Humans

Humans may occasionally need to skip hooks (emergency fixes, work-in-progress commits). But skipping should be rare and justified. If a hook is failing too often, the hook needs fixing, not skipping.

## Anti-Patterns

- **No hooks** — relying entirely on CI to catch issues. CI runs after the code is pushed — by then, the error is public.
- **Too many pre-commit hooks** — making every commit take 2 minutes. Keep pre-commit fast (< 30s total). Move slow checks to pre-push or CI.
- **Skipping hooks routinely** — if `--no-verify` is used more than rarely, the hooks are too strict or too slow. Fix the hooks.
- **Hooks that modify code** — a hook that auto-formats on commit creates invisible changes. Hooks should check, not change. Formatting should be explicit.
- **Hooks not in version control** — per-machine hooks mean different developers have different gates. Check hooks into the repo.
