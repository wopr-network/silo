# Logbook Protocol

Operational memory — how the system remembers what happened in production.

---

## The Problem

Production knowledge is hard-won. Every deploy, every incident, every migration teaches something. Without a record, the same lessons are learned repeatedly — by different agents, in different sessions, at the cost of real incidents.

## The Logbook

A logbook is a persistent, structured record of operational events. It lives outside any agent's memory (which is ephemeral) and outside any session's context (which expires). The logbook is the only operational memory that survives indefinitely.

### Properties

- **Append-only**: events are added, never modified or deleted. History is immutable.
- **Structured**: each entry follows a template. Machine-parseable, human-readable.
- **Versioned**: the logbook itself is version-controlled, so changes are tracked.
- **Pre-consulted**: agents read the logbook before taking action, not after things go wrong.

## Logbook Components

### 1. Runbook

The current state of production. Not what happened — what IS.

```
Current state: PRODUCTION / PRE-PRODUCTION / DEGRADED / DOWN
Last deploy: <version> at <timestamp>
Active services: <list>
Known issues: <list>
Go-live checklist: <status of each item>
```

The runbook is the ONE document that answers: "What's the current production state?" Every operational agent reads this first.

### 2. Deployment Log

Append-only record of every deployment.

```
Entry template:
  Date: <ISO timestamp>
  Version: <from> → <to>
  Commit: <hash>
  Triggered by: <who or what>
  Result: SUCCESS / FAILURE / ROLLED BACK
  Notes: <what happened, what was learned>
  Duration: <time from start to confirmed>
```

The deployment log answers: "What changed in production and when?"

### 3. Incident Log

Record of every production incident.

```
Entry template:
  Incident: <ID>
  Severity: SEV1 (full outage) / SEV2 (degraded) / SEV3 (minor)
  Started: <timestamp>
  Detected: <timestamp> (by what? alert, user report, QA team)
  Resolved: <timestamp>
  Root cause: <what went wrong>
  Resolution: <what fixed it>
  Prevention: <what gate/check would have caught this>
  Action items: <follow-up work>
```

The incident log answers: "What went wrong, how did we fix it, and how do we prevent it?"

### 4. Migration Log

Record of every database migration.

```
Entry template:
  Migration: <name/number>
  Date: <timestamp>
  Type: schema change / data migration / index
  Destructive: yes / no
  Reversible: yes / no
  Duration: <time>
  Result: SUCCESS / FAILURE
  Notes: <gotchas, data impact>
```

The migration log answers: "What schema changes have been applied, and were any destructive?"

### 5. Decision Log

Architectural and operational decisions with rationale.

```
Entry template:
  Decision: <what was decided>
  Context: <why this decision was needed>
  Alternatives considered: <what else was evaluated>
  Rationale: <why this option was chosen>
  Consequences: <what this means going forward>
  Date: <when decided>
```

The decision log answers: "Why did we do it this way?" — a question that comes up months after the original context is lost.

## The Pre-Consultation Rule

Agents MUST read relevant logbook entries BEFORE taking action:

| Action | Read First |
|--------|-----------|
| Deploy | Runbook (current state), Deployment log (recent deploys), Migration log (pending migrations) |
| Rollback | Deployment log (what to roll back to), Incident log (similar past incidents) |
| Migrate | Migration log (what's been applied), Decision log (schema design rationale) |
| Provision | Decision log (infrastructure decisions), Runbook (current topology) |

An agent that deploys without reading the runbook doesn't know the current state. An agent that migrates without reading the migration log might re-apply a migration.

## Logbook Format

The logbook can be:
- **A git repository** — version-controlled, diff-able, PR-reviewable
- **A wiki** — human-editable, linkable
- **A database** — queryable, structured
- **A shared document** — collaborative, accessible

The format matters less than the discipline. Pick a format that your agents can read and write programmatically.

## Anti-Patterns

- **No logbook** — "we'll remember." You won't. The next session won't. The next agent won't.
- **Unstructured entries** — free-text paragraphs instead of templates. Makes querying and cross-referencing impossible.
- **Logbook as afterthought** — writing entries after the incident is over, from memory, days later. Write entries as events happen.
- **Logbook nobody reads** — a logbook that exists but isn't consulted before actions is just a journal. It's only useful if agents and humans read it before acting.
- **Mutable history** — editing past entries to "clean up." The log is a record of what happened, not what you wish happened.
