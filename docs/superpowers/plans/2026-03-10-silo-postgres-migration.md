# Silo Engine Postgres Migration + Multi-Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the silo engine from SQLite (`better-sqlite3`) to Postgres (`pg` + Drizzle), add `tenant_id` to all tables, and implement the scoped-repository-factory pattern for tenant isolation.

**Architecture:** Rewrite schema from `sqliteTable` to `pgTable`, convert all 8 repository implementations from synchronous to async, replace SQLite-specific patterns (`.run()`, `.all()`, `.get()`, `result.changes`, `rowid`, sync transactions) with Postgres equivalents. Add `tenant_id` column to every table, create scoped repo factory that pre-binds repos to a tenant. Engine receives pre-scoped repos — no engine code changes needed.

**Tech Stack:** TypeScript 5.9, Drizzle ORM (Postgres), pg, PGlite (tests), Vitest

**Spec:** `docs/specs/2026-03-10-silo-saas-platform-design.md` — see "Technical Decisions" sections 1-4

**Depends on:** Plan 1 (platform-core extraction) does NOT need to be complete first. This plan is independent.

---

## SQLite → Postgres Pattern Reference

Every repo implementer needs this reference:

| SQLite Pattern | Postgres Replacement |
|---|---|
| `import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"` | `import { PostgresJsDatabase } from "drizzle-orm/postgres-js"` |
| `type Db = BetterSQLite3Database<typeof schema>` | `type Db = PostgresJsDatabase<typeof schema>` |
| `sqliteTable(...)` | `pgTable(...)` |
| `integer("col")` for timestamps | `bigint("col", { mode: "number" })` |
| `integer("col")` for booleans | `boolean("col")` |
| `text("col", { mode: "json" })` | `jsonb("col")` |
| `.run()` (sync execute) | `await db.insert/update/delete(...)` |
| `.all()` (sync multi-row) | `await db.select(...)` |
| `.get()` (sync single-row) | `const [row] = await db.select(...).limit(1)` |
| `db.transaction((tx) => { sync })` | `await db.transaction(async (tx) => { await ... })` |
| `result.changes === 0` | `.returning()` with `.length === 0` check |
| `sql\`rowid\`` | Add explicit `serial("seq")` column or use `id` for ordering |
| `"SQLITE_CONSTRAINT_UNIQUE"` error | `err.code === "23505"` only |
| `sqlite.pragma("journal_mode = WAL")` | Remove (Postgres has MVCC) |
| `sqlite.pragma("foreign_keys = ON")` | Remove (Postgres enforces FK by default) |
| `bootstrap(":memory:")` in tests | PGlite in-process Postgres |

---

## Chunk 1: Schema Migration + DB Bootstrap

### Task 1: Rewrite schema from SQLite to Postgres

**Files:**
- Rewrite: `~/silo/src/repositories/drizzle/schema.ts`
- Rewrite: `~/silo/src/main.ts`
- Rewrite: `~/silo/src/config/db-path.ts`
- Update: `~/silo/drizzle.config.ts`
- Update: `~/silo/package.json` (swap deps)

- [ ] **Step 1: Swap dependencies**

```bash
cd ~/silo
pnpm remove better-sqlite3 @types/better-sqlite3
pnpm add pg postgres
pnpm add -D @types/pg @electric-sql/pglite
```

- [ ] **Step 2: Rewrite schema.ts — table definitions**

Replace all `sqliteTable` with `pgTable`. For each of the 16 tables:

- `integer("col")` for timestamps → `bigint("col", { mode: "number" })`
- `integer("col")` for booleans (`paused`, `passed`, `enabled`) → `boolean("col")`
- `text("col", { mode: "json" })` → `jsonb("col")`
- `integer("id").primaryKey({ autoIncrement: true })` → `serial("id").primaryKey()`
- `text("id")` (UUID PKs) → keep as `text("id")` or `uuid("id")` depending on preference
- Add `tenantId: text("tenant_id").notNull()` to every table

All imports change from `drizzle-orm/sqlite-core` to `drizzle-orm/pg-core`.

- [ ] **Step 3: Fix unique constraints for multi-tenancy**

Global unique constraints that must become composite:

```typescript
// Before (SQLite):
name: text("name").notNull().unique()

// After (Postgres + multi-tenant):
name: text("name").notNull()
// + add uniqueIndex:
(table) => ({ uniqueName: uniqueIndex("uq_flow_tenant_name").on(table.tenantId, table.name) })
```

Tables requiring this change:
- `flowDefinitions`: `(tenant_id, name)`
- `gateDefinitions`: `(tenant_id, name)`
- `sources`: `(tenant_id, name)`

Transitively-scoped composite indexes (already have a parent FK, add `tenant_id`):
- `stateDefinitions`: `(tenant_id, flow_id, name)`
- `flowVersions`: `(tenant_id, flow_id, version)`

Indexes that are already entity-scoped (entity IDs are globally unique UUIDs — tenant_id is denormalized for query performance but not needed for uniqueness):
- `domainEvents`: keep `(entity_id, sequence)` unique
- `entitySnapshots`: keep `(entity_id, sequence)` unique
- `entityActivity`: keep `(entity_id, seq)` unique
- `entityMap`: `(tenant_id, source_id, external_id)` — sources are tenant-scoped

- [ ] **Step 4: Add `seq` column to replace `rowid`**

Tables that use `ORDER BY rowid` (`gate_results`, `entity_history`):

```typescript
seq: serial("seq") // auto-incrementing, replaces SQLite's implicit rowid
```

- [ ] **Step 5: Add indexes for common tenant-scoped queries**

```typescript
// On entities table:
tenantStateIdx: index("idx_entities_tenant_state").on(table.tenantId, table.state)
tenantFlowIdx: index("idx_entities_tenant_flow").on(table.tenantId, table.flowId)

// On invocations:
tenantFlowIdx: index("idx_invocations_tenant_flow").on(table.tenantId, table.flowId)
```

- [ ] **Step 6: Rewrite db-path.ts → db-url.ts**

Replace the SQLite file path resolution with Postgres connection URL:

```typescript
export function getDatabaseUrl(): string {
  return process.env.SILO_DB_URL
    ?? process.env.DATABASE_URL
    ?? "postgresql://localhost:5432/silo";
}
```

- [ ] **Step 7: Rewrite main.ts — createDatabase**

Replace `better-sqlite3` initialization with `postgres` + Drizzle:

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./repositories/drizzle/schema.js";

export function createDatabase(url: string) {
  const client = postgres(url);
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function bootstrap(url: string) {
  const { db, client } = createDatabase(url);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, client };
}
```

- [ ] **Step 8: Rewrite withTransaction**

Replace the SQLite sync transaction wrapper:

```typescript
export async function withTransaction<T>(
  db: Db,
  fn: (tx: Db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as Db));
}
```

- [ ] **Step 9: Update drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/repositories/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.SILO_DB_URL ?? "postgresql://localhost:5432/silo" },
});
```

- [ ] **Step 10: Generate initial Postgres migration**

```bash
cd ~/silo && npx drizzle-kit generate
```

Verify the generated SQL creates all 16 tables with correct types.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: rewrite schema from SQLite to Postgres with tenant_id"
```

---

### Task 2: Set up PGlite for tests

**Files:**
- Create: `~/silo/tests/helpers/pg-test-db.ts`
- Update: `~/silo/vitest.config.ts` (if needed)

- [ ] **Step 1: Create test database helper**

```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../src/repositories/drizzle/schema.js";

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, client, close: () => client.close() };
}
```

- [ ] **Step 2: Verify PGlite works with the generated migration**

Write a minimal test:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "./helpers/pg-test-db.js";
import { flowDefinitions } from "../src/repositories/drizzle/schema.js";

describe("PGlite bootstrap", () => {
  it("creates tables and accepts inserts", async () => {
    const { db, close } = await createTestDb();
    await db.insert(flowDefinitions).values({
      id: "test-id",
      tenantId: "tenant-1",
      name: "test-flow",
      initialState: "backlog",
    });
    const rows = await db.select().from(flowDefinitions);
    expect(rows).toHaveLength(1);
    await close();
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd ~/silo && npx vitest run tests/helpers/
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: PGlite test infrastructure"
```

---

## Chunk 2: Repository Rewrites (Core)

### Task 3: Rewrite DrizzleEntityRepository

The most complex repo — 16 methods, synchronous transactions, `.run()`, `.changes` patterns.

**Files:**
- Rewrite: `~/silo/src/repositories/drizzle/entity.repo.ts`
- Update: `~/silo/tests/repositories/drizzle/entity.repo.test.ts`

- [ ] **Step 1: Update type imports**

Change `BetterSQLite3Database` → Postgres equivalent. Update `Db` type alias.

- [ ] **Step 2: Convert all `.run()` calls to awaited statements**

Every `this.db.insert(...).run()` becomes `await this.db.insert(...).values(...)`.
Every `this.db.update(...).run()` becomes `await this.db.update(...).set(...).where(...)`.

- [ ] **Step 3: Convert synchronous transactions to async**

```typescript
// Before:
this.db.transaction((tx) => { tx.update(...).run(); })
// After:
await this.db.transaction(async (tx) => { await tx.update(...).set(...).where(...); })
```

- [ ] **Step 4: Replace `result.changes === 0` with `.returning()`**

```typescript
// Before:
const result = this.db.update(entities).set({...}).where(...).run();
if (result.changes === 0) return null;
// After:
const result = await this.db.update(entities).set({...}).where(...).returning();
if (result.length === 0) return null;
```

- [ ] **Step 5: Add tenantId to all repository methods**

For the scoped-factory pattern, add `private tenantId: string` to the constructor. Every query gets `.where(eq(entities.tenantId, this.tenantId))` appended.

`create()` must set `tenantId` on insert.

- [ ] **Step 6: Update entity.repo.test.ts**

- Replace `bootstrap(":memory:")` with `createTestDb()`
- Make all test functions `async`
- Add `tenantId` to all test data
- Use `afterEach(() => close())` for cleanup

- [ ] **Step 7: Run entity repo tests**

```bash
cd ~/silo && npx vitest run tests/repositories/drizzle/entity.repo.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: rewrite DrizzleEntityRepository for Postgres + tenancy"
```

---

### Task 4: Rewrite DrizzleFlowRepository

**Files:**
- Rewrite: `~/silo/src/repositories/drizzle/flow.repo.ts`
- Update: `~/silo/tests/repositories/drizzle/flow.repo.test.ts`

- [ ] **Step 1: Same conversion pattern as Task 3**

- Update type imports
- Convert `.run()` → awaited
- Convert `.all()` → awaited
- Convert sync transactions → async
- Replace `hydrateFlow` internal sync calls with awaited equivalents

- [ ] **Step 2: Update getByName to use composite tenant+name lookup**

```typescript
async getByName(name: string): Promise<Flow | null> {
  const [row] = await this.db.select().from(flowDefinitions)
    .where(and(eq(flowDefinitions.tenantId, this.tenantId), eq(flowDefinitions.name, name)))
    .limit(1);
  if (!row) return null;
  return this.hydrateFlow(row);
}
```

- [ ] **Step 3: Update `list()` and `listAll()` to filter by tenant**

- [ ] **Step 4: Update flow.repo.test.ts**

Same pattern: PGlite, async, tenantId in test data.

- [ ] **Step 5: Run tests**

```bash
cd ~/silo && npx vitest run tests/repositories/drizzle/flow.repo.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: rewrite DrizzleFlowRepository for Postgres + tenancy"
```

---

### Task 5: Rewrite DrizzleInvocationRepository

**Files:**
- Rewrite: `~/silo/src/repositories/drizzle/invocation.repo.ts`
- Update: `~/silo/tests/repositories/drizzle/invocation.repo.test.ts`

- [ ] **Step 1: Same conversion pattern**

- Type imports, `.run()` → awaited, `.all()` → awaited
- `result.changes === 0` → `.returning().length === 0`
- TTL arithmetic `sql\`claimedAt + ttlMs < now\`` works on Postgres bigint — verify

- [ ] **Step 2: Add tenantId filtering to all flow-scoped queries**

`findByFlow`, `findUnclaimedByFlow`, `countActiveByFlow`, `countPendingByFlow` — all filter by `flowId` which is already tenant-scoped. Add `tenantId` to `reapExpired` for safety.

- [ ] **Step 3: Update tests, run, commit**

```bash
cd ~/silo && npx vitest run tests/repositories/drizzle/invocation.repo.test.ts
git add -A && git commit -m "feat: rewrite DrizzleInvocationRepository for Postgres + tenancy"
```

---

### Task 6: Rewrite DrizzleDomainEventRepository

**Files:**
- Rewrite: `~/silo/src/repositories/drizzle/domain-event.repo.ts`
- Update: `~/silo/tests/repositories/domain-event-cas.test.ts`

**Critical:** This repo has CAS (compare-and-swap) logic and SQLite error code detection.

- [ ] **Step 1: Convert sync transactions to async**

The `appendCas` method wraps `getLastSequence` + `insert` in a sync transaction. Convert to:

```typescript
async appendCas(entityId: string, type: string, payload: unknown): Promise<boolean> {
  try {
    await this.db.transaction(async (tx) => {
      const last = await tx.select({ seq: sql`coalesce(max(${domainEvents.sequence}), 0)` })
        .from(domainEvents)
        .where(eq(domainEvents.entityId, entityId));
      const nextSeq = Number(last[0]?.seq ?? 0) + 1;
      await tx.insert(domainEvents).values({
        entityId, tenantId: this.tenantId, sequence: nextSeq, type, payload
      });
    });
    return true;
  } catch (err: any) {
    if (err.code === "23505") return false; // unique constraint violation
    throw err;
  }
}
```

- [ ] **Step 2: Remove `SQLITE_CONSTRAINT_UNIQUE` error code check**

Keep only `err.code === "23505"`.

- [ ] **Step 3: Update CAS tests, run, commit**

The CAS test (`domain-event-cas.test.ts`) tests concurrent append — critical to verify this still works on Postgres.

```bash
cd ~/silo && npx vitest run tests/repositories/domain-event-cas.test.ts
git add -A && git commit -m "feat: rewrite DrizzleDomainEventRepository for Postgres"
```

---

### Task 7: Rewrite remaining repositories

Four simpler repos. Same pattern for each.

**Files:**
- Rewrite: `gate.repo.ts`, `transition-log.repo.ts`, `event.repo.ts`, `entity-snapshot.repo.ts`
- Update corresponding test files

- [ ] **Step 1: Rewrite gate.repo.ts**

- `.get()` → `await db.select(...).limit(1)` destructured
- `.run()` → awaited
- Replace `sql\`rowid\`` with `seq` column (added in Task 1)
- `getByName` → composite `(tenant_id, name)` lookup
- `listAll` → filter by `tenantId`

- [ ] **Step 2: Rewrite transition-log.repo.ts**

- `.run()` → awaited
- Replace `sql\`rowid\`` with `seq` column
- `historyFor` → add `tenantId` filter (defensive, entity ID is already scoped)

- [ ] **Step 3: Rewrite event.repo.ts**

- `.run()` → awaited
- `findRecent` → filter by `tenantId`

- [ ] **Step 4: Rewrite entity-snapshot.repo.ts**

- `.run()` → awaited
- `.all()` → awaited
- `onConflictDoNothing()` works on Drizzle Postgres — just await it

- [ ] **Step 5: Run all repo tests**

```bash
cd ~/silo && npx vitest run tests/repositories/
```

Expected: ALL repo tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: rewrite remaining repos for Postgres + tenancy"
```

---

## Chunk 3: Scoped Repository Factory + Engine Integration

### Task 8: Create scoped repository factory

**Files:**
- Create: `~/silo/src/repositories/scoped-repos.ts`
- Create: `~/silo/tests/repositories/scoped-repos.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("ScopedRepos", () => {
  it("creates entity with tenant_id pre-bound", async () => {
    const { db, close } = await createTestDb();
    const repos = createScopedRepos(db, "tenant-1");
    // ... create flow, create entity, verify entity.tenantId === "tenant-1"
    await close();
  });

  it("isolates queries between tenants", async () => {
    const { db, close } = await createTestDb();
    const t1 = createScopedRepos(db, "tenant-1");
    const t2 = createScopedRepos(db, "tenant-2");
    // ... create flows with same name in both tenants
    // ... verify t1.flows.getByName("my-flow") returns tenant-1's flow
    // ... verify t2.flows.getByName("my-flow") returns tenant-2's flow
    await close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/silo && npx vitest run tests/repositories/scoped-repos.test.ts
```

Expected: FAIL — `createScopedRepos` not defined.

- [ ] **Step 3: Implement createScopedRepos**

```typescript
export interface ScopedRepos {
  entities: IEntityRepository;
  flows: IFlowRepository;
  invocations: IInvocationRepository;
  gates: IGateRepository;
  transitionLog: ITransitionLogRepository;
  events: IEventRepository;
  domainEvents: IDomainEventRepository;
  snapshots: IEntitySnapshotRepository;
}

export function createScopedRepos(db: Db, tenantId: string): ScopedRepos {
  return {
    entities: new DrizzleEntityRepository(db, tenantId),
    flows: new DrizzleFlowRepository(db, tenantId),
    invocations: new DrizzleInvocationRepository(db, tenantId),
    gates: new DrizzleGateRepository(db, tenantId),
    transitionLog: new DrizzleTransitionLogRepository(db, tenantId),
    events: new DrizzleEventRepository(db, tenantId),
    domainEvents: new DrizzleDomainEventRepository(db, tenantId),
    snapshots: new DrizzleEntitySnapshotRepository(db, tenantId),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/silo && npx vitest run tests/repositories/scoped-repos.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scoped repository factory for tenant isolation"
```

---

### Task 9: Wire engine to accept scoped repos

The engine already takes repos via `EngineDeps`. The change is: instead of constructing repos internally, the caller passes pre-scoped repos.

**Files:**
- Modify: `~/silo/src/engine/engine.ts` (constructor signature)
- Update: `~/silo/tests/engine/engine.integration.test.ts`
- Update: `~/silo/src/execution/cli.ts` (wiring)

- [ ] **Step 1: Verify engine already uses injected repos**

Read `engine.ts` constructor. It takes `EngineDeps` which includes all repo interfaces. The engine does NOT construct repos internally — it receives them. This means **no engine code changes are needed** for tenancy. The caller just passes scoped repos.

If the engine does construct any repos internally, refactor those out.

- [ ] **Step 2: Update engine integration tests**

Replace `bootstrap(":memory:")` with `createTestDb()`. Create scoped repos with a test tenant ID. Pass them to the engine.

- [ ] **Step 3: Run engine integration tests**

```bash
cd ~/silo && npx vitest run tests/engine/engine.integration.test.ts
```

- [ ] **Step 4: Update CLI wiring in cli.ts**

The CLI creates repos and wires the engine. For now, use a default "system" tenant (single-tenant CLI mode). The product API will supply real tenant IDs.

```typescript
const repos = createScopedRepos(db, process.env.SILO_TENANT_ID ?? "default");
```

- [ ] **Step 5: Run full test suite**

```bash
cd ~/silo && npx vitest run
```

Expected: ALL tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire engine to scoped repos, update CLI"
```

---

## Chunk 4: API Layer + Remaining Updates

### Task 10: Update Hono API for tenant-scoped requests

**Files:**
- Modify: `~/silo/src/api/hono-server.ts`
- Update: `~/silo/tests/api/server.test.ts`
- Update: `~/silo/tests/api/worker-auth-rest.test.ts`

- [ ] **Step 1: Add tenant resolution to auth middleware**

The product layer will resolve tenantId from tokens. For the engine's own API, support a `x-tenant-id` header or embed tenantId in the bearer token. For backward compatibility, default to a configurable tenant when no tenant is specified.

```typescript
function resolveTenantId(c: Context): string {
  return c.req.header("x-tenant-id") ?? process.env.SILO_TENANT_ID ?? "default";
}
```

- [ ] **Step 2: Thread tenantId through route handlers**

Every handler that calls the engine or repos must pass tenantId. Since the engine takes pre-scoped repos, create scoped repos per-request:

```typescript
app.post("/api/entities", requireAdminAuth, async (c) => {
  const tenantId = resolveTenantId(c);
  const repos = createScopedRepos(deps.db, tenantId);
  const engine = createEngine({ ...deps.engineDeps, ...repos });
  // ... use engine
});
```

Or, if engine construction is expensive, cache per tenant.

- [ ] **Step 3: Update API tests**

Add `x-tenant-id` header to all test requests. Verify tenant isolation.

- [ ] **Step 4: Run API tests**

```bash
cd ~/silo && npx vitest run tests/api/
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tenant-scoped API requests"
```

---

### Task 11: Update remaining test files

**Files:** All remaining test files that use `bootstrap(":memory:")`:
- `tests/engine/entity-cancel.test.ts`
- `tests/flow-versioning.test.ts`
- `tests/on-enter.test.ts`
- `tests/on-exit.test.ts`
- `tests/admin-tools.test.ts`
- `tests/config/seed-loader.test.ts`
- `tests/config/exporter.test.ts`
- `tests/ws/broadcast.test.ts`
- `tests/ws/ws-integration.test.ts`

- [ ] **Step 1: Update each test file**

For each file:
1. Replace `bootstrap(":memory:")` with `createTestDb()`
2. Make setup/teardown async
3. Add tenantId to test data where needed
4. Use `afterEach(() => close())` or `afterAll(() => close())`

- [ ] **Step 2: Run full test suite**

```bash
cd ~/silo && npx vitest run
```

Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: migrate all tests to PGlite"
```

---

### Task 12: Update MCP server and handlers

**Files:**
- Update: `~/silo/src/execution/mcp-server.ts`
- Update: `~/silo/src/execution/handlers/flow.ts`
- Update: `~/silo/src/execution/handlers/admin.ts`
- Update: `~/silo/src/execution/handlers/query.ts`

- [ ] **Step 1: Thread tenantId through MCP handlers**

MCP tool calls need tenant context. In stdio mode (single tenant), use the configured default. In SSE mode, extract from the session token.

- [ ] **Step 2: Update claim handler**

`handleFlowClaim` in `flow.ts` calls `engine.claimWork()`. It must pass tenant-scoped repos.

- [ ] **Step 3: Update admin handlers**

All admin tool handlers (`entity.create`, `flow.create`, etc.) need tenant scoping.

- [ ] **Step 4: Run admin tools tests**

```bash
cd ~/silo && npx vitest run tests/admin-tools.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tenant-scoped MCP handlers"
```

---

### Task 13: Data migration script for existing deployments

**Files:**
- Create: `~/silo/scripts/migrate-to-postgres.ts`

- [ ] **Step 1: Write migration script**

The script:
1. Reads from an existing SQLite silo.db
2. Connects to the target Postgres database
3. Creates a tenant record (WOPR tenant for cheyenne-mountain)
4. Copies all data table-by-table, setting `tenant_id` on every row
5. Validates row counts match

```typescript
// Pseudo-structure:
import Database from "better-sqlite3";
import postgres from "postgres";

const sqlite = new Database(process.argv[2] ?? "silo.db");
const pg = postgres(process.env.SILO_DB_URL!);

const TENANT_ID = process.env.MIGRATE_TENANT_ID ?? "wopr";

for (const table of TABLE_LIST) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  for (const row of rows) {
    await pg`INSERT INTO ${table} ${pg({ ...row, tenant_id: TENANT_ID })}`;
  }
}
```

- [ ] **Step 2: Test with a real silo.db from cheyenne-mountain**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: SQLite-to-Postgres data migration script"
```

---

### Task 14: Update radar-db barrel exports

**Files:**
- Update: `~/silo/src/radar-db/schema.ts`
- Update any radar-db repository files that import from the schema

- [ ] **Step 1: Verify radar-db schema.ts is just a re-export barrel**

It should just re-export from the main schema. Confirm no SQLite-specific types.

- [ ] **Step 2: Update any radar-db repos**

Check `~/silo/src/radar-db/` for Drizzle repository files. Apply same Postgres conversion pattern.

- [ ] **Step 3: Run full test suite one final time**

```bash
cd ~/silo && npx vitest run
```

Expected: ALL tests PASS.

- [ ] **Step 4: Run biome check**

```bash
cd ~/silo && npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: complete Postgres migration"
```

---

## Summary

| Chunk | Tasks | What it produces |
|-------|-------|------------------|
| 1 | 1-2 | Postgres schema with tenant_id, PGlite test infra |
| 2 | 3-7 | All 8 repos rewritten for async Postgres + tenant filtering |
| 3 | 8-9 | Scoped repo factory, engine wired to accept it |
| 4 | 10-14 | API tenant threading, all tests green, data migration script |

**Key patterns applied:**
- Scoped repository factory: `createScopedRepos(db, tenantId)` returns pre-bound repos
- Engine unchanged: receives scoped repos, no tenant awareness in engine code
- All unique constraints: global `name` → composite `(tenant_id, name)`
- All timestamps: SQLite integer → Postgres bigint
- All booleans: SQLite integer → Postgres boolean
- All JSON: SQLite text+mode → Postgres jsonb
- All sync: `.run()`, `.all()`, `.get()` → awaited async
- CAS: keep unique constraint on `(entity_id, sequence)`, error code `23505` only
- `rowid` → explicit `serial("seq")` column
- Tests: PGlite in-process Postgres, drop-in replacement for `:memory:`
