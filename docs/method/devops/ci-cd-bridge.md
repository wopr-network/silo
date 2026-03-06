# CI/CD Bridge

How code on a branch becomes a running service — the bridge between the build pipeline and production.

---

## The Two Pipelines

An agentic engineering system has two distinct pipelines:

1. **Build pipeline**: issue → spec → code → review → merge (produces code on main)
2. **Deploy pipeline**: main → build → gate → deploy → verify (produces running software)

The CI/CD bridge connects them. Without it, code merges to main and sits there — tested but not deployed, reviewed but not running.

## Continuous Integration (CI)

CI answers: "Does this code work when combined with all other code?"

```
PR created or updated
  ↓
CI pipeline triggers:
  1. Checkout the PR branch
  2. Install dependencies
  3. Run lint / format / type check
  4. Run build
  5. Run test suite
  6. Run security audit
  7. Report results back to the PR
  ↓
Results: all checks pass ✓ or some checks fail ✗
```

CI runs on EVERY PR, EVERY push. It's the automated equivalent of "does this even compile?" — but much more thorough.

### CI as Gate

CI results gate the review stage:

- **CI passing**: reviewer proceeds with code review
- **CI failing**: reviewer reports "ISSUES: CI failing" immediately, no code review
- **CI pending**: reviewer waits briefly, then proceeds with a note

CI is the first gate in the review process. There's no point reviewing code that doesn't compile, doesn't pass tests, or has lint errors.

## Continuous Delivery vs Continuous Deployment

### Continuous Delivery

Every merge to main produces a deployable artifact. Deployment is a manual trigger.

```
merge to main → build artifact → store in registry → [MANUAL TRIGGER] → deploy
```

**Use when**: You need a human approval before each deploy, or deploys must be coordinated with external systems.

### Continuous Deployment

Every merge to main automatically deploys to production.

```
merge to main → build artifact → store in registry → deploy → verify
```

**Use when**: Your gate system is strong enough that everything on main is production-ready, AND rollback is fast and reliable.

### The Progression

Most systems evolve through stages:

```
1. Manual deploys (early stage)
   → deploy when someone remembers to

2. Continuous integration (foundation)
   → every PR gets tested, but deploy is manual

3. Continuous delivery (intermediate)
   → every merge produces an artifact, deploy is a button press

4. Continuous deployment (mature)
   → every merge automatically deploys, verified by post-deploy gates
```

Move to the next stage only when the previous stage is reliable.

## The Build Artifact

The output of CI is a build artifact — a deployable package:

| Artifact Type | Use Case |
|--------------|----------|
| Container image | Microservices, any language |
| Binary | Compiled languages (Go, Rust) |
| Bundle | Frontend applications (JS/TS) |
| Package | Libraries, plugins |

### Artifact Properties

- **Immutable**: once built, never modified. If you need changes, build a new artifact.
- **Versioned**: tagged with the commit hash or semantic version.
- **Reproducible**: the same commit always produces the same artifact.
- **Stored**: pushed to a registry (container registry, package registry, artifact store).

## CI/CD in the Agentic Pipeline

The CI/CD bridge integrates with the agent pipeline at specific points:

```
Agent creates PR
  ↓
CI runs automatically (triggered by PR creation)
  ↓
Reviewer checks CI status before reviewing code
  ↓
PR approved → enters merge queue
  ↓
Merge queue re-runs CI on integrated code
  ↓
PR merges to main
  ↓
CD triggers:
  - Build artifact
  - Push to registry
  - Deploy to production (CD) or signal readiness (continuous delivery)
  ↓
Post-deploy gate runs
  ↓
QA team verifies
```

### What the Agent Pipeline Needs from CI/CD

1. **Status visibility**: agents must be able to query CI status (`passing`, `failing`, `pending`)
2. **Artifact access**: the deploy agent must be able to pull the built artifact
3. **Event triggers**: merge events must trigger the deploy pipeline
4. **Rollback support**: the deploy pipeline must support reverting to a previous artifact

## Anti-Patterns

- **No CI** — merging code without automated checks. Every PR must run CI, no exceptions.
- **CI without CD** — testing everything but deploying manually. The deploy step is where operational errors happen.
- **CD without gates** — automatically deploying without post-deploy verification. Auto-deploy is only safe with auto-verify.
- **Slow CI** — a CI pipeline that takes 30+ minutes discourages frequent PRs and slows the pipeline. Optimize CI for speed.
- **Flaky CI** — tests that sometimes pass and sometimes fail. Flaky tests erode trust in the gate system. Fix or remove them.
- **CI as the only gate** — CI catches code-level issues. It doesn't catch environment issues, integration issues, or production data issues. CI is necessary but not sufficient.
