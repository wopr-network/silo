# Development Hooks — The WOPR Implementation

> Implements: [method/gates/hooks.md](../../method/gates/hooks.md)

---

## WOPR's Hook Chain

### Pre-Commit Hooks

Configured via Biome and TypeScript in each repo:

```bash
# What runs before every commit
biome check src/         # Lint + format check
tsc --noEmit             # Type check
```

In repos with the full gate chain (wopr-platform, wopr):
```bash
pnpm lint && pnpm format && pnpm build && pnpm test
```

### Claude Code Hooks

WOPR repos have Claude Code hook configurations that run automatically:

**Pre-edit hooks** (context before editing):
- Check CLAUDE.md for repo-specific rules
- Identify existing patterns in the file being edited

**Post-edit hooks** (learning after editing):
- Record what changed for potential CLAUDE.md updates
- Detect patterns in agent behavior

### CI Pipeline (GitHub Actions)

Every repo has a `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format --check

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

## The Full Gate Chain

```
Agent writes code in worktree
  ↓
Pre-commit: biome check + tsc --noEmit
  ↓ pass
git commit (with conventional commit message)
  ↓
git push to feature branch
  ↓
GitHub Actions CI triggers:
  ├── Lint and Type Check (biome + tsc)
  ├── Build (pnpm build)
  └── Test (vitest — full suite)
  ↓ all pass
Review bots trigger:
  ├── Qodo (code review + /improve)
  ├── CodeRabbit (AI review)
  ├── Devin (AI review)
  └── Sourcery (AI review)
  ↓ wopr-await-reviews.sh blocks until all post
Agent reviewer reads all comments + diff
  ↓ CLEAN
Merge queue (wopr, wopr-platform):
  └── Re-runs CI on integrated code
  ↓ pass
Squash merge to main
  ↓
GitHub Actions builds Docker image → GHCR
  ↓
Watchtower pulls new image → restarts container
  ↓
Health check confirms service is up
```

## Agent Rules About Hooks

Standing orders in MEMORY.md:

- **Never `--no-verify`**: Agents must never skip hooks. If a hook fails, fix the issue.
- **Never `pnpm test` in worktrees**: OOMs. Use `npx vitest run <file>`.
- **Always `pnpm install --frozen-lockfile`**: Never modify the lockfile.
- **Push real commit for CI**: Empty pushes don't trigger GitHub Actions.

## Biome Configuration

Each repo has a `biome.json`:

```json
{
  "linter": {
    "rules": {
      "suspicious": {
        "noTsIgnore": "error"
      }
    }
  },
  "formatter": {
    "indentStyle": "tab",
    "lineWidth": 120
  }
}
```

Key rule: `noTsIgnore` is `"error"` — agents must use `declare module` ambient declarations instead of `@ts-ignore`. This was a Level 1 feedback loop: agents kept using `@ts-ignore`, it was caught in review 3+ times, and was promoted to a biome gate.
