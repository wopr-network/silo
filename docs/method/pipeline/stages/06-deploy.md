# Stage 6: Deploy

Release to production — how merged code becomes running software.

---

## Purpose

Deployment bridges the gap between "code on main" and "code serving users." It's the highest-stakes stage because mistakes affect real users and are harder to reverse than any previous stage.

## The Deploy Pipeline

```
main branch updated (merge event)
  ↓
Build artifact (container image, binary, bundle)
  ↓
Run pre-deploy gates:
  - Migration safety check
  - Secret validation
  - Artifact integrity
  ↓
Deploy to production:
  - Push artifact to registry
  - Pull and restart services
  - Run health checks
  ↓
Post-deploy verification:
  - Smoke tests
  - Health endpoint checks
  - Metric baseline comparison
  ↓
If healthy → deploy complete
If unhealthy → automatic rollback
```

## Deployment Models

### Continuous Deployment (CD)

Every merge to main automatically deploys to production. No human approval gate between merge and deploy.

**When it works:** Strong gate system, comprehensive tests, fast rollback, low blast radius per change.

**When it doesn't:** Regulated environments, destructive database changes, changes that need coordinated rollout.

### Staged Deployment

Merge to main deploys to staging. Promotion to production requires an explicit trigger (human approval or scheduled window).

**When it works:** When you need a final check before production, or when deploys must be coordinated with other systems.

### Manual Trigger

Deploy is a deliberate action, not an automatic consequence of merging.

**When it works:** Early-stage projects, infrequent deploys, when the blast radius of a bad deploy is very high.

For mature agentic engineering systems, **continuous deployment is the goal** — but only when the gate system is strong enough to catch problems before they reach main.

## Pre-Deploy Gates

Before any deployment, verify:

1. **Migration safety** — if the deploy includes database migrations, check for destructive operations (DROP TABLE, DROP COLUMN). Flag for human review.
2. **Secret validation** — all required environment variables and secrets exist in the target environment.
3. **Artifact integrity** — the built artifact matches the committed code (hash verification).
4. **Dependency check** — no known critical CVEs in the deployed dependency tree.

## The Rollback Contract

Every deploy must be reversible. Before deploying, answer:

- **How do I roll back?** — is it "deploy the previous version" or "restore a database backup"?
- **How fast is the rollback?** — seconds (container restart) or minutes (database restore)?
- **What data is lost on rollback?** — if the new version wrote data in a new format, can the old version read it?

If you can't answer these questions, you're not ready to deploy.

## Operational Memory

Every deployment produces operational knowledge. Record it:

- **What was deployed** — artifact version, commit hash, who triggered it
- **When** — timestamp
- **What happened** — success or failure, any incidents
- **What was learned** — gotchas, unexpected behavior, things to watch for next time

This record is the system's operational memory. Without it, the same mistakes repeat across deploys. The format doesn't matter (log file, wiki, git repo) — what matters is that it exists and is consulted before every deploy.

## Gate

The deploy stage is complete when:

- The artifact has been built and verified
- Pre-deploy gates have passed
- The deploy has been executed
- Post-deploy health checks confirm the service is healthy
- The deployment has been recorded in operational memory

## Anti-Patterns

- **Deploying without rollback** — if you can't undo it, you shouldn't do it automatically.
- **Deploying with pending migrations** — database migrations need special handling. Don't let them slip through with a regular deploy.
- **No health checks after deploy** — deploying and walking away. The service might be up but broken.
- **No deployment record** — "what version is running?" should never be a mystery.
- **Deploying on Friday** — not literally about Fridays, but about deploying when the team isn't available to respond to incidents.
