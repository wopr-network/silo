# Gate Taxonomy

The categories of deterministic gates every agentic engineering project needs.

---

## What Makes a Gate

A gate is a check that:

1. **Has a ternary outcome** — pass, fail, or timeout (not yet resolved)
2. **Is deterministic** — same input always produces the same result
3. **Is automated** — no human judgment required
4. **Blocks progress on failure** — work cannot advance past a failing gate

Gates are not suggestions, warnings, or "consider this" comments. They are hard blocks.

### The Three Outcomes

| Outcome | Meaning | Worker action |
|---|---|---|
| **Pass** | Gate resolved affirmatively | Continue — receive next stage prompt |
| **Fail** | Gate resolved negatively | Stop — entity is gated, wait for reclaim |
| **Timeout** | Gate did not resolve within `timeout_ms` | Do timeout work, call report again |

Timeout is not failure. A gate that hasn't resolved yet has not said no. The worker calls report again after a delay. The gate may pass on the next attempt.

Each outcome has a different prompt source — see the [worker protocol](../pipeline/worker-protocol.md) for the full prompt resolution model.

---

## The 11 Gate Categories

### 1. Static Analysis

**What it catches:** Dead code, unused imports, unreachable branches, style violations, code smells.

**Tools:** Biome, ESLint, Ruff, Clippy, golangci-lint.

**When it runs:** Pre-commit hook, CI pipeline.

**Why it matters for agents:** AI-generated code frequently includes unused imports, leftover debug statements, and inconsistent formatting. Static analysis catches these mechanically, freeing review for logic issues.

### 2. Type Checking

**What it catches:** Type errors, null safety violations, interface mismatches, incorrect function signatures.

**Tools:** tsc (TypeScript), mypy (Python), Pyright, Flow, rustc.

**When it runs:** Pre-commit hook, CI pipeline.

**Why it matters for agents:** Agents generate code that type-checks in isolation but breaks at integration boundaries. The type checker catches mismatches between what a function produces and what its callers expect.

### 3. Test Suite

**What it catches:** Regressions, incorrect behavior, violated invariants, edge case failures.

**Tools:** Vitest, Jest, Pytest, Go test, Cargo test.

**When it runs:** CI pipeline (full suite), development (targeted files only).

**Why it matters for agents:** Tests are the strongest gate because they verify behavior, not just syntax. An agent's code might parse, type-check, and lint cleanly while producing completely wrong output. Tests catch that.

### 4. Build Verification

**What it catches:** Compilation errors, missing dependencies, broken imports, asset pipeline failures.

**Tools:** tsc, webpack, vite, docker build, cargo build.

**When it runs:** CI pipeline.

**Why it matters for agents:** A codebase that passes type checking and linting might still fail to build if there are circular dependencies, missing environment variables, or platform-specific issues.

### 5. Secret Scanning

**What it catches:** Hardcoded API keys, passwords, tokens, private keys, connection strings.

**Tools:** Custom scripts, git-secrets, trufflehog, detect-secrets.

**When it runs:** Pre-commit hook, CI pipeline.

**Why it matters for agents:** Agents have no concept of secret sensitivity. They will happily include API keys, webhook secrets, or database passwords in committed code if not gated.

### 6. SQL Safety

**What it catches:** Raw SQL outside approved modules, SQL injection vectors, unparameterized queries.

**Tools:** Custom scripts that grep for raw SQL patterns outside repository/DAO layers.

**When it runs:** CI pipeline.

**Why it matters for agents:** Agents bypass abstraction layers. If the codebase uses a repository pattern, an agent might write raw SQL in a handler because it's "simpler." The SQL safety gate enforces the architectural boundary.

### 7. Import Boundaries

**What it catches:** Cross-layer imports, dependency violations, circular dependencies.

**Tools:** Custom scripts, eslint-plugin-boundaries, dependency-cruiser.

**When it runs:** CI pipeline.

**Why it matters for agents:** Agents don't understand architectural boundaries unless told. They'll import database internals from an API handler, reach into a framework's private modules, or create circular dependency chains.

### 8. Migration Safety

**What it catches:** Destructive migrations (DROP TABLE, DROP COLUMN), migrations that haven't been generated, stale migration state.

**Tools:** Custom scripts that compare migration files against the schema, migration linters.

**When it runs:** CI pipeline, pre-deploy check.

**Why it matters for agents:** Database migrations are irreversible in production. An agent might generate a migration that drops a table or column that still has data. The migration safety gate flags destructive operations for human review.

### 9. Security Audit

**What it catches:** Known CVEs in dependencies, OWASP top 10 violations, insecure configurations.

**Tools:** npm audit, pip-audit, Snyk, Dependabot, custom scripts.

**When it runs:** CI pipeline, periodic scheduled scan.

**Why it matters for agents:** Agents install whatever dependencies solve the immediate problem without considering their security posture. Dependency audit catches known vulnerabilities mechanically.

### 10. Review Bot Synchronization

**What it catches:** Race conditions between agent reviewer and automated review tools.

**Tools:** Custom synchronization scripts that poll for bot comments before allowing review to proceed.

**Why it matters:** Multiple review bots (code analysis, security scanners, style checkers) post findings asynchronously. If the agent reviewer declares "CLEAN" before all bots have posted, it misses findings. The synchronization gate blocks review until all configured bots have posted — or a timeout expires.

This is a gate ON gates — a meta-gate that ensures the review phase is complete before a verdict is rendered.

### 11. Merge Queue

**What it catches:** Integration conflicts between concurrent PRs, last-mile CI failures.

**Tools:** GitHub merge queue, GitLab merge trains, Bors.

**When it runs:** After approval, before merge to main.

**Why it matters:** Multiple PRs might pass CI independently but conflict when merged together. The merge queue serializes merges and re-runs CI on the integrated result, catching conflicts that per-PR CI misses.

---

## Gate Placement

Gates belong at specific points in the lifecycle:

```
┌─────────────────────────────────────────────────────────┐
│ Development                                              │
│   ├── Pre-commit hook: static analysis, type check,      │
│   │    secret scan                                       │
│   └── Local test: targeted test files only               │
│                                                          │
│ PR / CI                                                  │
│   ├── All of the above, plus:                            │
│   ├── Full test suite                                    │
│   ├── Build verification                                 │
│   ├── SQL safety                                         │
│   ├── Import boundaries                                  │
│   ├── Migration safety                                   │
│   ├── Security audit                                     │
│   ├── Review bot synchronization                         │
│   └── Agent reviewer verdict                             │
│                                                          │
│ Merge                                                    │
│   └── Merge queue (re-runs CI on integrated code)        │
│                                                          │
│ Deploy                                                   │
│   ├── Pre-deploy: migration safety re-check              │
│   ├── Deploy: health check after restart                 │
│   └── Post-deploy: smoke tests, E2E verification        │
│                                                          │
│ Production                                               │
│   ├── Health monitoring                                  │
│   ├── Performance baseline comparison                    │
│   └── Regression detection                               │
└─────────────────────────────────────────────────────────┘
```

**The rule:** Gates get cheaper the earlier they run. A lint error caught in a pre-commit hook costs nothing. The same error caught in CI costs a pipeline run. Caught in review, it costs a review cycle. Caught in production, it costs an incident. Push gates as early as possible.

---

## Adding New Gates

When a new category of error appears repeatedly:

1. **First occurrence** — caught in review, fixed manually
2. **Second occurrence** — added as a project-level rule (agents read rules before coding)
3. **Third occurrence** — promoted to an automated gate (script, lint rule, or CI check)

This is the [feedback loop](../feedback/learning-loop.md) in action. Gates evolve based on what the system actually encounters, not what someone imagined might go wrong.

---

## For Adopters

You don't need all 11 categories on day one. Start with what you have:

**Minimum viable gates (start here):**
- [ ] Static analysis (linter)
- [ ] Type checking (if your language supports it)
- [ ] Test suite
- [ ] Build verification
- [ ] CI pipeline that runs all of the above

**Next tier:**
- [ ] Secret scanning
- [ ] Security audit (dependency vulnerabilities)
- [ ] Merge queue

**Full system:**
- [ ] SQL safety / architectural boundary enforcement
- [ ] Import boundaries
- [ ] Migration safety
- [ ] Review bot synchronization
- [ ] Post-deploy verification

Each gate you add reduces the surface area of problems that can reach production.
