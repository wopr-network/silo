# The Agentic Engineering Lifecycle

How all phases connect into a continuous, self-improving cycle.

---

## The Full Cycle

```
                         ┌──────────────────────────────────────────┐
                         │           CONTINUOUS CYCLE                │
                         │                                          │
    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────┐     │
    │  GROOM  │───→│  BUILD  │───→│  DEPLOY  │───→│ VERIFY  │     │
    │         │    │         │    │          │    │         │     │
    │Backlog  │    │Architect│    │CI → GHCR │    │Smoke    │     │
    │generation│   │Code     │    │Pull →    │    │E2E      │     │
    │Adversarial│  │Review   │    │Start     │    │Regression│    │
    │triage   │    │Fix      │    │Health    │    │System   │     │
    │         │    │Merge    │    │check     │    │health   │     │
    └────▲────┘    └─────────┘    └──────────┘    └────┬────┘     │
         │                                              │          │
         │         ┌──────────┐    ┌──────────┐        │          │
         │         │  AUDIT   │←──│ FEEDBACK  │←───────┘          │
         │         │          │    │          │                    │
         │         │5-dimension│   │Findings  │                    │
         │         │quality   │    │→ rules   │                    │
         │         │scan      │    │→ gates   │                    │
         │         │          │    │→ prompts  │                    │
         └─────────┤          │    │→ config   │                    │
                   └──────────┘    └──────────┘                    │
                         │                                          │
                         └──────────────────────────────────────────┘
```

---

## Phase Breakdown

### 1. GROOM — Backlog Generation

**Input:** Current codebase state, ecosystem signals, security landscape, operational metrics.
**Output:** Prioritized, well-scoped issues in the issue tracker.
**Gate:** Adversarial triage — proposals must survive challenge before becoming issues.

The grooming phase generates work. It's adversarial by design: multiple advocates argue FOR work from different angles (codebase health, ecosystem trends, security risks), while a skeptic challenges every proposal. Only what survives becomes an issue.

This prevents backlog bloat. Without the skeptic, every TODO comment, every "nice to have," every "a competitor has this" becomes a story. With the skeptic, only evidence-backed, well-scoped, non-duplicate work enters the pipeline.

See: [00-groom.md](stages/00-groom.md)

### 2. BUILD — Implementation Pipeline

**Input:** Prioritized issue from the backlog.
**Output:** Merged PR on main branch.
**Gate:** Every sub-stage has its own gate.

The build phase is itself a pipeline with sub-stages:

```
Issue ──→ Architect ──→ Implement ──→ Review ──→ Fix? ──→ Merge
            │              │            │          │         │
          spec           code        findings    fixes    merge
          posted         pushed      reported    pushed   queue
         (gate:         (gate:      (gate:      (gate:   (gate:
          spec on        CI green)   all bots    CI       required
          tracker)                   posted)     green)   checks)
```

Each sub-stage has an agent type, a gate, and a message protocol:

| Sub-stage | Agent Role | Gate | Output Message |
|-----------|-----------|------|----------------|
| Architect | High-reasoning, read-only | Spec posted to issue tracker | "Spec ready: ISSUE-KEY" |
| Implement | Fast execution, follows spec | CI green, build passes | "PR created: URL" |
| Review | Reads diffs, triages feedback | All review bots posted, CI green | "CLEAN: URL" or "ISSUES: URL — findings" |
| Fix | Targeted fixes, TDD | CI green, tests pass | "Fixes pushed: URL" or "Can't resolve: URL — reason" |
| Merge | Automated | Required checks pass, approvals met | Merge queue resolves |

The review-fix loop can cycle multiple times. A circuit breaker (stuck detection) escalates to humans if the same finding is flagged 3+ times.

See: [01-architect.md](stages/01-architect.md) through [05-merge.md](stages/05-merge.md)

### 3. DEPLOY — Code Becomes Running Software

**Input:** Merged PR on main.
**Output:** New version running in production.
**Gate:** CI pipeline builds and pushes. Pre-deploy checks pass. Health check confirms.

The deploy phase bridges the coding pipeline and the operational layer. It's typically automated via CI/CD:

```
Merge to main
  → CI: lint, test, build, push image to registry
  → CD: pull image on production host, restart services
  → Health check: verify the service responds correctly
```

The operational logbook records every deployment — what changed, which image SHAs, the result, whether rollback was needed. This creates an operational history that informs future deploys and incident response.

See: [06-deploy.md](stages/06-deploy.md)

### 4. VERIFY — System-Level Confirmation

**Input:** Newly deployed version.
**Output:** Verified production state.
**Gate:** Post-deploy smoke tests, E2E tests, integration checks.

This is the gate that vibe coding skips entirely. Passing CI doesn't mean the deployed system works. Verification tests the running system end-to-end:

- Can users complete critical journeys? (signup, payment, core features)
- Do services communicate correctly? (API ↔ database, API ↔ external services)
- Are there regressions vs the previous version? (latency, error rates, resource usage)

If verification fails, the system auto-rolls back to the previous known-good state and creates an issue for the regression. The issue enters the next build cycle automatically.

See: [07-verify.md](stages/07-verify.md)

### 5. AUDIT — Periodic Quality Scan

**Input:** A repo or set of repos.
**Output:** Consolidated gap report across multiple quality dimensions.
**Gate:** Findings above severity threshold become issues.

The audit phase runs periodically (post-sprint, scheduled, or on-demand) and checks dimensions that per-PR review might miss:

- **Correctness** — type safety, error handling, logic bugs
- **Completeness** — unfinished code, missing features, stub implementations
- **Best practices** — architectural patterns, naming conventions, dependency hygiene
- **Testing** — coverage gaps, weak assertions, missing edge cases
- **Security** — injection vectors, credential exposure, authorization gaps

Each dimension gets a specialist agent. They run in parallel and report independently. The lead consolidates into a severity-grouped report.

Audit findings can feed directly into the GROOM phase or be filed as issues immediately.

### 6. FEEDBACK — Self-Improvement

**Input:** Findings from review, fix, verify, and audit phases.
**Output:** Stronger gates, better agent prompts, tuned configuration.
**Gate:** Findings must be evaluated for generalizability before promotion.

The feedback phase is what makes the system compound. Without it, every sprint fights the same bugs. With it, each sprint is easier than the last.

Feedback operates at multiple levels:

1. **Immediate** — fix cycle findings → project-level rules
2. **Per-sprint** — review patterns → lint rules, agent prompt improvements
3. **Per-quarter** — operational metrics → system configuration tuning
4. **Cross-project** — findings propagate through config inheritance layers

See: [../feedback/learning-loop.md](../feedback/learning-loop.md) and [../feedback/self-improvement.md](../feedback/self-improvement.md)

---

## Phase Transitions

Phases transition on events, not on manual triggers. The [event bus pattern](triggers/event-bus.md) enables automatic phase transitions:

| Event | Triggers |
|-------|----------|
| Backlog drops below threshold | GROOM phase |
| Issue enters pipeline | BUILD phase (architect sub-stage) |
| PR merges | DEPLOY phase (CI/CD) |
| Deploy completes | VERIFY phase (smoke tests) |
| Verification fails | DEPLOY phase (auto-rollback) + BUILD phase (fix issue) |
| Sprint completes | AUDIT phase |
| Audit findings filed | GROOM phase (new issues) |
| Fix cycle completes | FEEDBACK phase (evaluate findings) |

The cycle is continuous. There are no batch boundaries. When one issue merges, the next enters. When a deploy completes, verification starts. When verification fails, the fix cycle begins.

---

## Concurrency Model

Multiple issues can be in different phases simultaneously. The system manages concurrency through:

- **Slot-based limits** — a maximum number of issues in the build phase at once (prevents resource exhaustion)
- **Independent reviewers** — review and verification agents don't hold build slots (they're lightweight)
- **Per-repo backlog gates** — if too many PRs are open in one repo, new work for that repo pauses until the backlog clears
- **Blocking graph** — issues with dependencies don't enter the pipeline until their blockers are resolved (confirmed by merged PR, not just issue state)

---

## The Human's Role

In agentic engineering, the human is not writing code or reviewing diffs. The human is:

1. **Designing gates** — choosing what verification matters and configuring the tools
2. **Setting priorities** — deciding what work enters the pipeline and in what order
3. **Resolving escalations** — handling stuck issues that agents can't fix after multiple attempts
4. **Observing the system** — watching coordination channels for anomalies
5. **Evolving the methodology** — improving agent prompts, gate configurations, and pipeline design based on operational experience

The human is the architect of the system, not a participant in it.
