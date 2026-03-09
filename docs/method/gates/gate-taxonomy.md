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

### Gates as Prompt Qualification

A gate does more than verify completed work. A gate is **prompt qualification** — a deterministic check that the next state's context can be assembled completely and that the next agent invocation will be productive.

When `review-bots-ready` waits for CI and bot comments before the reviewer fires, it's not patience. It's ensuring the reviewer's prompt will contain: green CI, all bot findings, full diff. Without the gate, the reviewer either polls (burning tokens on tool calls) or reviews without full information (wrong answer, another loop).

The cost of a gate is milliseconds of shell execution. The cost of a skipped gate is a full review/fix cycle — potentially minutes and dollars.

### Gate Failure Output as Specification

A gate's `failure_prompt` is not a consolation message. It is a **targeted correction specification** for the next agent invocation. The gate knows exactly what went wrong. The failure prompt should tell the agent exactly what to fix.

"The spec was not found" is vague. "You signalled spec_ready but no comment containing '## Implementation Spec' exists on WOP-1234. Post the spec comment to the Linear issue, then signal again." is actionable. Good failure prompts reduce the review/fix loop count by making each correction attempt more likely to succeed.

### The Three Outcomes

| Outcome | Meaning | Worker action |
|---|---|---|
| **Pass** | Gate resolved affirmatively | Continue — receive next stage prompt |
| **Fail** | Gate resolved negatively | Stop — entity is gated, wait for reclaim |
| **Timeout** | Gate did not resolve within `timeout_ms` | Do timeout work, call report again |

Timeout is not failure. A gate that hasn't resolved yet has not said no. The worker calls report again after a delay. The gate may pass on the next attempt.

Each outcome has a different prompt source:

| Outcome | Prompt source |
|---------|--------------|
| Pass | Next state's `promptTemplate` — the flow defines what comes next |
| Fail | Gate's `failure_prompt` — the flow author defines what the worker should know |
| Timeout | Gate's `timeout_prompt` — the flow author defines what the worker should do while waiting |

Gates and flows can define `failure_prompt` and `timeout_prompt` as Handlebars templates with access to `entity`, `gate.output`, and `flow` context. Gate-level overrides flow-level. Without a configured prompt, fail returns raw gate output and timeout returns a generic "not an error, call again" message.

See [worker-protocol.md](../pipeline/worker-protocol.md) for how workers respond to each outcome.

### Gates as Routing Decisions

The three-outcome model describes the simplest case: a gate that answers a yes/no question with a timeout fallback. But gates can do more than verify. Gates can **route**.

A routing gate evaluates evidence and directs the entity to one of N possible states based on what it finds. The gate doesn't just say "pass" or "fail" — it says "here's what happened, and here's where the entity should go next."

Consider a CI gate on the `coding → reviewing` transition. The simple model: CI green = pass (go to reviewing), CI red = fail (block). But this wastes an invocation. If CI is red, there's nothing to review — sending the entity to `reviewing` so the reviewer can say "ISSUES: CI failed" burns an agent invocation to produce information the gate already had. The routing model: CI green + bots posted = `ready` (go to reviewing), CI red = `ci_failed` (go to fixing directly, skip the reviewer entirely).

```
Simple gate:
  pass  → reviewing
  fail  → (blocked, entity stays in coding)

Routing gate:
  ready     → reviewing  (CI green, bots posted, context complete)
  ci_failed → fixing     (skip reviewer — gate routes directly to fixer)
  (timeout) → check_back (bots haven't posted yet, not an error)
```

The routing gate is strictly more powerful. It has the evidence (shell output with CI status, bot counts, merge state) AND the authority (outcome map) to decide where the entity goes. The agent never decides. The gate decides.

#### The Outcome Map

A routing gate defines an `outcomes` map: named outcomes mapped to routing decisions.

```json
{
  "outcomes": {
    "ready":     { "proceed": true },
    "ci_failed": { "toState": "fixing" },
    "blocked":   { "toState": "stuck" }
  }
}
```

- `proceed: true` — the entity continues to the transition's original `toState`
- `toState: "X"` — the entity is **redirected** to state X instead

The gate script emits a named outcome as the last line of stdout:

```json
{"outcome": "ci_failed", "message": "checks lint, test failed on PR #456"}
```

If no named outcome is recognized, the gate falls back to the three-outcome model: exit 0 = pass, exit 1 = fail, timeout = check_back. This means every existing gate continues to work unchanged. Outcome routing is opt-in.

#### Why This Matters for Flow Engineering

Routing gates eliminate **unnecessary agent invocations**. Every state transition that could be decided by evidence — rather than by an agent reading that evidence and drawing the obvious conclusion — should be decided by a gate.

The reviewer that says "ISSUES: CI failed" is a $0.03 invocation that produces a decision a $0.00 gate script could have made. The merge watcher that says "Merged: url" is a $0.03 invocation that produces a fact a gate script could have observed. Every time an agent's output is deterministic given its input, that agent should be replaced by a gate.

This is the deeper form of prompt qualification: the gate doesn't just verify that the next agent's context is complete — it decides whether the next agent should fire at all.

See [gate-routing.md](gate-routing.md) for the full routing contract and implementation pattern.

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

---

## Related: State onEnter Hooks

Gates block *transitions* between states. A related primitive — `onEnter` — runs *before the first claim* on a state. When an entity enters a state with an `onEnter` configured, the engine runs a setup command, merges the output into entity artifacts, and only then makes the entity claimable.

Use `onEnter` for environment provisioning: creating a git worktree, spinning up a container, reserving a resource. The setup outlives the worker — if a worker idles and the entity is reclaimed, the next worker gets the same artifacts and can continue.

`onEnter` is not a gate. It does not block a transition. It prepares the environment for work to begin.

Together, gates and onEnter hooks form a **context assembly pipeline**: gates ensure the prior work is verified, onEnter hooks assemble the context for the next invocation. The agent receives a prompt with everything it needs — no tool calls for discovery, all tokens spent on reasoning and action. See [onenter-hooks.md](../pipeline/onenter-hooks.md) for the context assembly contract.
