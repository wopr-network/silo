# Operations

The operational actions agents can take against production — deploy, rollback, migrate, and health check.

---

## Purpose

Operations are the interface between the pipeline and production. Every operational action is dangerous — it affects real users, real data, and real availability. Operations must be:

1. **Scripted** — no ad-hoc shell commands against production
2. **Logged** — every action is recorded in the logbook
3. **Reversible** — every action has an undo
4. **Gated** — pre-conditions must be verified before execution

## The Operations

### Deploy

Push a new version to production.

```
Pre-conditions:
  - Artifact exists and is verified (hash matches commit)
  - Runbook state is PRODUCTION or PRE-PRODUCTION (not DEGRADED or DOWN)
  - No pending destructive migrations
  - Secrets validated in target environment

Action:
  1. Record deploy start in logbook
  2. Pull artifact from registry
  3. Stop current version gracefully
  4. Start new version
  5. Run post-deploy gate (health check → smoke tests → integration check)

Post-conditions:
  - If gate passes → update runbook to current version
  - If gate fails → trigger automatic rollback

Output:
  - "Deployed: <version> — healthy" or "Deploy failed: <reason> — rolled back"
```

### Rollback

Revert to the last known-good version.

```
Pre-conditions:
  - Previous version is known (from deployment log)
  - Previous artifact still exists in registry

Action:
  1. Record rollback start in logbook
  2. Identify previous version from deployment log
  3. Deploy the previous version (same steps as deploy)
  4. Run post-deploy gate on the rolled-back version
  5. Create incident for investigation

Post-conditions:
  - If gate passes → update runbook to previous version, record success
  - If gate fails → CRITICAL: alert human, do not attempt further automated action

Output:
  - "Rolled back: <new-version> → <previous-version> — healthy"
  - "Rollback failed: CRITICAL — human intervention required"
```

### Migrate

Apply database schema changes.

```
Pre-conditions:
  - Migration files exist and are validated
  - Migration safety gate passed (no destructive operations without human approval)
  - Database backup exists (for reversible recovery)
  - Application can tolerate the migration (backwards-compatible schema)

Action:
  1. Record migration start in logbook
  2. Take database snapshot (if not already done)
  3. Apply migration
  4. Verify migration applied correctly (check schema state)
  5. Run targeted tests against the migrated schema

Post-conditions:
  - If successful → record in migration log
  - If failed → restore from snapshot, record failure, alert human

Output:
  - "Migrated: <migration-name> — success"
  - "Migration failed: <reason> — restored from snapshot"
```

### Health Check

Verify current production state without changing anything.

```
Pre-conditions: none (health checks are read-only)

Action:
  1. Check each service's health endpoint
  2. Check database connectivity
  3. Check external dependency reachability
  4. Check resource utilization (CPU, memory, disk)
  5. Check queue depth and drain rate
  6. Check certificate expiry dates

Post-conditions:
  - Update runbook with current state

Output:
  - "Health: all services healthy" or
  - "Health: <service> degraded — <details>"
```

## Operational Constraints

### 1. No Ad-Hoc Commands

Every production action must be a script or runbook procedure. No `ssh production && rm -rf /`. No manual SQL against the production database. If it's not scripted, it's not reproducible, and it's not auditable.

### 2. Blast Radius Awareness

Before any operation, ask: "If this goes wrong, what's the blast radius?"

| Operation | Blast Radius | Mitigation |
|-----------|-------------|-----------|
| Deploy | Service downtime during restart | Health check + auto-rollback |
| Rollback | Data written by new version may be incompatible | Schema backwards-compatibility |
| Migrate (additive) | Low — adding columns/tables | None needed |
| Migrate (destructive) | Data loss — dropping columns/tables | Human approval + backup |
| Scale up | Low — more capacity | Cost monitoring |
| Scale down | Potential capacity shortage | Traffic monitoring |

### 3. The Two-Person Rule (for Destructive Operations)

Destructive operations (DROP TABLE, DELETE FROM without WHERE, infrastructure teardown) require human approval. The agent proposes, the human approves.

This is not a lack of trust in agents — it's defense in depth. Even a correct agent following correct instructions can cause damage if the instructions are wrong.

### 4. Dry Run First

Operations that support it should run in dry-run mode first:

```
1. Dry run: show what would happen
2. Human reviews the dry run output
3. Actual run: execute the operation
```

This adds a review step without adding a full human-in-the-loop gate.

## Operations Agent Design

The operations agent (or "DevOps agent") is different from pipeline agents:

| Aspect | Pipeline Agent | Operations Agent |
|--------|---------------|-----------------|
| Scope | One issue, one PR | Entire production environment |
| Risk | Low (feature branch isolation) | High (production impact) |
| Reversibility | Easy (discard worktree) | Hard (rollback + data implications) |
| Lifecycle | Ephemeral (one task) | Ephemeral (one operation) |
| Pre-consultation | Read the spec | Read the logbook |

The operations agent reads the logbook before every action, operates scripted procedures, records everything, and shuts down after one operation.

## Anti-Patterns

- **Ad-hoc production access** — running manual commands against production. If it's not scripted, it's not reproducible.
- **Deploy without rollback plan** — "we'll figure it out if it breaks" is not a plan.
- **Migrate without backup** — destructive migrations without a database snapshot are irrecoverable.
- **Ignoring the logbook** — deploying without checking what's currently running. The logbook exists to be read.
- **Chaining operations without verification** — migrate then deploy then scale without checking each step. Verify after every operation.
