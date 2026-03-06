# Adoption Checklist

A concrete, tickable list of everything you need to adopt agentic engineering. Work through it in order.

---

## Tier 1: Foundation (Start Here)

These are non-negotiable. Without them, you don't have agentic engineering — you have vibe coding with extra steps.

### Gates

- [ ] **Linter configured** — ESLint, Biome, Ruff, Clippy, or equivalent for your language
- [ ] **Type checker configured** — TypeScript, mypy, Pyright, or equivalent (skip if untyped language)
- [ ] **CI pipeline running** — GitHub Actions, GitLab CI, or equivalent
- [ ] **CI runs on every PR** — lint, type check, build
- [ ] **Branch protection enabled** — PRs can't merge without CI passing

### Tests

- [ ] **Test runner configured** — Vitest, Jest, Pytest, Go test, or equivalent
- [ ] **Critical path tests written** — auth, core API, data layer (at minimum)
- [ ] **Tests run in CI** — full suite runs on every PR
- [ ] **Tests gate merge** — PRs can't merge with failing tests

### Agent Rules

- [ ] **Rule file exists** — `CLAUDE.md`, `.cursorrules`, or equivalent at repo root
- [ ] **Conventions documented** — naming, patterns, imports, directory structure
- [ ] **Gotchas documented** — things that break if done wrong
- [ ] **Build commands documented** — how to build, test, lint

## Tier 2: Structure (Next)

These add structure to your agent workflow. Each one reduces a class of errors.

### Separation of Concerns

- [ ] **Spec before code** — agent reads/writes a spec before implementing
- [ ] **Review after code** — agent or human reviews every PR
- [ ] **Fix after review** — findings are addressed before merge, not ignored
- [ ] **Agents are ephemeral** — one task per agent, then shutdown

### Code Quality Gates

- [ ] **Secret scanning enabled** — no API keys, passwords, or tokens in code
- [ ] **Build verification in CI** — code compiles and builds successfully
- [ ] **Formatted code** — auto-formatter runs in CI (Prettier, Black, gofmt)

### Issue Tracking

- [ ] **Issues have descriptions** — not just titles
- [ ] **Issues have acceptance criteria** — how to know it's done
- [ ] **Issues identify the repo** — which codebase the work belongs to
- [ ] **Blocking relationships wired** — dependencies between issues are explicit

## Tier 3: Automation (When Ready)

These automate parts of the pipeline that were previously manual.

### Automated Review

- [ ] **At least one review bot** — Qodo, CodeRabbit, Sourcery, or equivalent
- [ ] **Review bot findings are blocking** — not just suggestions
- [ ] **Agent reviewer reads bot comments** — doesn't skip them
- [ ] **Synchronization gate** — reviewer waits for bots before reviewing

### Merge Safety

- [ ] **Merge queue enabled** — for repos with concurrent PRs
- [ ] **Squash merge** — clean history, one commit per PR
- [ ] **Auto-delete branches** — feature branches cleaned up after merge

### Operational Memory

- [ ] **Deployment log exists** — append-only record of every deploy
- [ ] **Decision log exists** — architectural decisions with rationale
- [ ] **Incident log exists** — production incidents with root cause and prevention
- [ ] **Logbook is consulted** — agents read the logbook before operational actions

## Tier 4: Full System (Advanced)

These complete the methodology. Most teams take months to reach this tier.

### Adversarial Grooming

- [ ] **Multiple advocates** — at least 2 perspectives arguing for work
- [ ] **Skeptic challenges** — every proposal is questioned before becoming an issue
- [ ] **Evidence-based proposals** — file:line references, metrics, CVEs — not vibes

### Post-Deploy Verification

- [ ] **Health checks after deploy** — automated, not manual
- [ ] **Smoke tests against production** — critical paths verified after deploy
- [ ] **Automatic rollback** — if health checks fail, revert automatically
- [ ] **Metric comparison** — before/after deploy performance comparison

### Feedback Loop

- [ ] **Findings become rules** — review catches → documented in rule file
- [ ] **Rules become gates** — repeated rule violations → automated check
- [ ] **Cross-repo propagation** — lessons learned in one repo applied to all
- [ ] **Config self-tuning** — thresholds adjusted based on data

### Multi-Agent Pipeline

- [ ] **Architect agent** (reasoning model) — specs the work
- [ ] **Coder agent** (execution model) — implements the spec
- [ ] **Reviewer agent** (execution model) — reviews the PR
- [ ] **Fixer agent** (execution model) — fixes review findings
- [ ] **Stuck detection** — circuit breaker for infinite fix loops
- [ ] **Concurrency management** — bounded pipeline slots with backpressure

## Progress Tracker

| Tier | Items | Completed | Status |
|------|-------|-----------|--------|
| 1: Foundation | 9 | _ / 9 | |
| 2: Structure | 8 | _ / 8 | |
| 3: Automation | 7 | _ / 7 | |
| 4: Full System | 14 | _ / 14 | |
| **Total** | **38** | **_ / 38** | |

## How to Use This Checklist

1. Work through Tier 1 completely before starting Tier 2
2. Each item should be verifiable — you can prove it's done
3. Don't check an item until it's actually working (not just "we have a plan to do this")
4. Revisit the checklist monthly to ensure nothing has regressed
5. When all of Tier 4 is checked, you're running a mature agentic engineering system
