# Silo

Unified flow engine + worker pool for agentic software engineering.

## Structure

- `src/` — TypeScript source code.
- `tests/` — Test files.
- `drizzle/` — Drizzle ORM migrations.
- `docs/method/` — Generic, tool-agnostic agentic engineering principles.
- `docs/adoption/` — How to adopt the methodology.

WOPR-specific deployment config (seeds, agents, Dockerfiles) lives in [cheyenne-mountain](https://github.com/wopr-network/cheyenne-mountain).

## Gotchas

- **Naming**: REST API and `FlowClaimSchema` use `worker_id` (snake_case), never `workerId` (camelCase) — all docs and code must match.
- **CORS**: `isLoopbackOrigin()` regex must use `https?://` prefix (not just `http://`) to cover both HTTP and SSE/HTTPS transports.
- **CAS atomicity**: `appendCas` must wrap `getLastSequence` + `insert` in a single `db.transaction()` — separate calls create a TOCTOU race.
- **CAS events**: `invocation.claim_attempted` fires on every CAS attempt; `entity.claimed` fires only after `claimById` confirms — never reverse this order.
- **DB error detection**: Check `err.code === "23505"` (Postgres unique violation), not `err.message` — messages vary across drivers and locales.
- **Event uniqueness**: `domain_events.(entityId, sequence)` must be a `uniqueIndex`, not a plain index — enforces append-only invariant at the DB level.
- **Snapshot replay**: Snapshot save failures must be non-fatal (try/catch) — replay from events is the fallback; never let a cache failure break the read path.
- **Event filtering**: `EventSourcedEntityRepository.get()` must filter events at DB level (e.g., `WHERE sequence >= minSequence`), not load all events and filter in memory.
- **Event-sourced mutations**: All state changes in `EventSourcedEntityRepository` (including artifact removal) must emit domain events — direct DB writes are invisible to event-sourced replay.
- **Engine merge-blocked escalation**: When `blocked` signal fires from `merging` state, engine increments `merge_blocked_count`; at ≥3 it overrides `toState` to `stuck` — flows without a `stuck` state silently skip the override.
