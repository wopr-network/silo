# Gate Taxonomy — The WOPR Implementation

> Implements: [method/gates/gate-taxonomy.md](../../method/gates/gate-taxonomy.md)

---

## WOPR's 11 Gate Categories

### 1. Static Analysis: Biome

```bash
npx biome check src/
```

- **Config**: `biome.json` at repo root
- **Key rules**: `noTsIgnore` (banned — use `declare module` instead), unused imports, consistent formatting
- **Runs**: Pre-commit hook + CI (GitHub Actions)

### 2. Type Checking: TypeScript

```bash
npx tsc --noEmit
```

- **Config**: `tsconfig.json` at repo root
- **Mode**: Strict mode enabled
- **Runs**: Pre-commit hook + CI

### 3. Test Suite: Vitest

```bash
# CI (full suite)
pnpm test

# Development (targeted — NEVER full suite in worktrees)
npx vitest run src/auth/session.test.ts
```

- **Config**: `vitest.config.ts`
- **Count**: 4000+ tests across wopr-platform
- **Critical**: Never `pnpm test` in worktrees — OOMs. Always `npx vitest run <file>`.

### 4. Build Verification

```bash
pnpm build
```

- **Includes**: TypeScript compilation + metadata generation
- **Runs**: CI

### 5. Secret Scanning

- **Tool**: GitHub's native secret scanning (enabled on all wopr-network repos)
- **Additional**: `.env.example` files in repos (never `.env` committed)
- **Agent rule**: "Never commit secrets" in org-level instructions

### 6. SQL Safety

- **Pattern**: Drizzle ORM with repository pattern
- **Rule**: No raw SQL outside repository modules
- **Enforcement**: Code review (agent reviewer checks for raw SQL)
- **Future**: Custom ESLint/Biome rule

### 7. Import Boundaries

- **Rule**: Plugins import only from `@wopr-network/plugin-types`, never relative imports into wopr core
- **Check**: `grep -rn "from.*wopr/src\|from.*wopr-platform" <repo>/src`
- **Enforcement**: Practices auditor (in `/wopr:audit`) + code review
- **Future**: `eslint-plugin-boundaries` or custom Biome rule

### 8. Migration Safety

- **Tool**: Drizzle migrations in wopr-platform
- **Check**: Migration log in wopr-ops `MIGRATIONS.md` flags destructive operations
- **Rule**: DROP TABLE/COLUMN requires human approval
- **Enforcement**: DevOps agent reads migration log before deploy

### 9. Security Audit

```bash
npm audit
```

- **Also**: Dependabot alerts on all wopr-network repos
- **Enforcement**: Security advocate scans during `/wopr:groom`

### 10. Review Bot Synchronization

```bash
~/wopr-await-reviews.sh <PR_NUMBER> wopr-network/<repo>
```

- **Bots**: Qodo, CodeRabbit, Devin, Sourcery
- **Timeout**: 10 minutes
- **Behavior**: Blocks until all 4 have posted, then prints all comments
- **On timeout**: Prints `TIMEOUT: <missing bots>`, proceeds anyway

### 11. Merge Queue

- **wopr** + **wopr-platform**: GitHub native merge queue
  ```bash
  gh api graphql -f query='mutation{enqueuePullRequest(input:{pullRequestId:"<ID>"})...}'
  ```
- **wopr-plugin-***: `gh pr merge --squash --auto` (no merge queue)
- **Required checks**: repo-specific (Lint and Type Check, Build, Test for wopr)

## Gate Placement in WOPR

```
Pre-commit hook:
  biome check (lint + format)
  tsc --noEmit (type check)

CI (GitHub Actions):
  biome check
  tsc --noEmit
  pnpm build
  vitest run (full suite)

Review:
  wopr-await-reviews.sh (sync gate for 4 bots)
  Agent reviewer (reads all comments + diff)

Merge:
  Merge queue (re-runs CI on integrated code)

Deploy:
  Read logbook (RUNBOOK.md, MIGRATIONS.md)
  Migration safety check
  Health check after restart

Production:
  Health endpoint monitoring
  Smoke tests (e2e)
```

## Cost Per Layer

| Layer | Cost of Catching a Bug |
|-------|----------------------|
| Pre-commit | ~$0 (instant, local) |
| CI | ~$0.01 (pipeline run, 3 minutes) |
| Review bots | ~$0.05 (bot processing, 5-10 minutes) |
| Agent review | ~$0.10 (Claude API call) |
| Merge queue | ~$0.01 (re-run CI) |
| Production | $$$$ (incident, customer impact, rollback) |
