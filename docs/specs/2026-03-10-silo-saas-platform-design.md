# Silo SaaS Platform Design

**Date:** 2026-03-10
**Status:** Approved

## Overview

Silo is an AI engineering SaaS product. Customers connect their issue tracker on the left and their revision control system on the right. Silo's AI agents pick up issues, write code, open PRs, and ship product — for a fixed subscription cost plus pay-as-you-go inference.

WOPR is tenant #1, dog-fooding its own product.

## Package Architecture

```
@wopr-network/platform-core    (new — extracted from wopr-platform)
         ↑                ↑
         |                |
   wopr-platform      silo (product)
   (WOPR fleet)      (AI engineering SaaS)
```

Four packages:

### @wopr-network/platform-core (new)

Shared platform layer extracted from wopr-platform. Published to npm. Contains:

- **Auth**: better-auth integration, bearer token scopes, session middleware, OAuth helpers, 2FA
- **Multi-tenancy**: tenant model (personal + org), org memberships, IDOR validation
- **Billing**: `IPaymentProcessor` interface, Stripe (checkout, portal, webhooks, SetupIntent), PayRam (crypto)
- **Credits**: `Credit` value object (nanodollar precision), `CreditLedger` (immutable transaction log + denormalized balance), auto-topup
- **Metering**: `MeterEmitter` (WAL/DLQ durability), usage aggregation
- **Rate limiting**: DB-backed fixed-window
- **Credential vault**: AES-256-GCM encrypted storage, audit log, BYOK tenant key resolution
- **Email**: Resend client, notification service, verification
- **Middleware**: CORS, CSRF, secure headers (Hono middleware factories)
- **tRPC factories**: `isAuthed`, `isAdmin`, `isAuthedWithTenant`, `isOrgMember`
- **Drizzle schema**: platform tables (tenants, credit_transactions, credit_balances, rate_limit_entries, webhook_seen_events, user_roles, org_memberships)
- **Config**: Zod-validated env config for auth/billing/email

Exports factory functions, not singletons. Each consumer configures their own instances.

### @wopr-network/silo (engine)

Flow engine. Modified from current state:

- **Postgres migration**: swap `better-sqlite3` for `pg` + Drizzle Postgres dialect
- **Multi-tenancy**: `tenant_id` column on all core tables, enforced at repository layer
- One engine instance serves all tenants
- Customers can customize their flow definitions, states, gates, and transitions per-tenant
- No dependency on platform-core (engine stays generic)

Core unchanged: state machine, gate evaluator, dispatchers, run-loop, claim/dispatch/report lifecycle.

### wopr-platform (existing)

WOPR fleet management product. Modified to import platform-core instead of owning auth/billing/tenancy code. Keeps:

- Fleet management (Docker orchestration, node provisioning, command bus, heartbeat)
- Gateway `/v1/*` proxy (service keys, AI provider arbitrage, spending caps)
- Provider routing, addon catalog, affiliate system
- P2P/container networking (DHT, discovery, network policies)
- Chat backends, node agent, backup/snapshots

### silo (product, formerly cheyenne-mountain)

The deployed AI engineering SaaS. Imports platform-core + silo engine. Contains:

- OAuth integration layer (Linear, GitHub, Jira)
- Customer onboarding and flow template provisioning
- Worker registration (managed + self-hosted)
- Metering wired into dispatcher for managed workers
- Dashboard
- WOPR as tenant #1 with existing flow definitions (wopr-changeset, wopr-hotfix)

## Business Model

Two revenue streams:

### The Car (subscription)

Fixed monthly price for the product:
- Flow engine and orchestration
- Source integrations (Linear, GitHub, Jira)
- Dashboard and configuration
- Flow customization

### The Gas (inference)

Pay-as-you-go credits for Claude API usage:
- Managed workers consume credits metered at the token level
- Uses platform-core's credit system (nanodollar precision, immutable ledger, auto-topup)
- Self-hosted workers bring their own API keys (BYOK) — no inference cost from us

### Tiers

| Tier | Product | Inference |
|------|---------|-----------|
| Self-hosted | $X/mo subscription | BYOK, $0 from us |
| Managed | $X/mo subscription | Pay-as-you-go credits (metered) |
| Enterprise | Custom pricing | Volume pricing or BYOK |

Exact pricing TBD.

## Worker Model (GitHub Actions Runner Pattern)

### Managed Workers

- Run in silo's infrastructure
- Claim work from the shared pool for their assigned tenant
- Use silo's API keys for Claude inference
- Token usage metered via `MeterEmitter`, debited from tenant's credit balance
- Allocated per-tenant based on plan tier (dedicated capacity, no noisy-neighbor)

### Self-hosted Workers

- Customer installs worker on their own infrastructure: `npx @wopr-network/silo worker --endpoint https://silo.dev/api --token <tenant-scoped-token>`
- Authenticates with tenant-scoped token — can only claim that tenant's work
- Git operations happen on customer's machine — code never leaves their network
- Claude API calls use customer's own Anthropic key (BYOK via credential vault)
- Lower price tier — customer provides compute and API keys

### Security Properties

| Concern | Managed | Self-hosted |
|---------|---------|-------------|
| Code access | Silo infrastructure | Never leaves customer network |
| API keys | Silo provides | Customer's own (BYOK) |
| Git credentials | OAuth tokens stored in vault | Customer's local git config |
| Compliance | Trust silo | Full customer control |

## Source Integrations

MVP: Linear + GitHub + Jira, all with OAuth connect.

- Customer clicks "Connect Linear" → OAuth flow → tokens stored in credential vault
- Webhook endpoints registered on customer's project
- Inbound webhooks validated via per-source HMAC (already built in silo)
- Tenant resolved from integration config
- Issue events ingested as entities into the tenant's configured flow

## Delivery Modes (Configurable Per Tenant)

Silo's flow definition system already supports this. Each mode is a different flow template:

- **PR only** — agent opens a PR, customer reviews and merges
- **PR + review cycle** — agent opens PR, responds to review comments, iterates until approved
- **PR + auto-merge** — agent opens PR, gets CI green, auto-merges
- **Custom** — tenant defines their own flow with custom states, gates, and transitions

## Database Architecture

Single Postgres database shared by platform-core tables and silo engine tables.

- Platform tables: tenants, credit_transactions, credit_balances, user_roles, org_memberships, rate_limit_entries, webhook_seen_events, etc.
- Engine tables: flow_definitions, state_definitions, gate_definitions, transition_rules, entities, invocations, gate_results, entity_history, events, domain_events, sources, watches, workers, entity_activity, etc.
- All engine tables include `tenant_id` column with composite indexes (tenant_id as leading column)
- `DirectFlowEngine` runs in-process — no HTTP hop between product API and engine

## System Architecture

```
Customer's issue tracker (Linear/GitHub/Jira)
         │ webhook
         ▼
   ┌─────────────────────────────────────┐
   │  Silo Product API                    │
   │  (Hono + tRPC + platform-core)       │
   │                                      │
   │  ┌──────────┐  ┌─────────────────┐  │
   │  │ Auth     │  │ Billing/Metering│  │
   │  │ Tenancy  │  │ Credits         │  │
   │  └──────────┘  └─────────────────┘  │
   │  ┌──────────────────────────────┐    │
   │  │ Integration Layer            │    │
   │  │ (Linear, GitHub, Jira OAuth) │    │
   │  └──────────────────────────────┘    │
   │  ┌──────────────────────────────┐    │
   │  │ Silo Engine (in-process)     │    │
   │  │ (multi-tenant, Postgres)     │    │
   │  └──────────────────────────────┘    │
   └──────────────────┬──────────────────┘
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
    Managed workers      Self-hosted workers
    (our infra,          (customer infra,
     our API keys,        their API keys,
     metered)             BYOK)
            │                   │
            ▼                   ▼
      Claude API           Claude API
      (we pay)             (they pay)
```

## Migration Strategy

Four phases. 6000+ wopr-platform tests stay green at every step.

### Phase 1: Extract platform-core

No behavior changes. Pure refactor.

For each module (auth → tenancy → billing → credits → metering → rate limiting → credential vault → email → middleware → tRPC factories → schema):

1. Copy module + its tests to platform-core
2. Verify tests pass in platform-core
3. Replace wopr-platform's local module with re-export from platform-core
4. Verify wopr-platform's 6000+ tests still pass
5. Once stable, remove re-export shim, update imports directly

Series of small, safe commits. wopr-platform never loses functionality.

### Phase 2: Silo engine Postgres migration

- Add Postgres Drizzle dialect alongside SQLite
- Migrate schema table by table with tests
- `tenant_id` column added to all core tables
- Repository layer gets tenant filtering on every method
- Existing silo tests adapted to run against Postgres (PGlite or test containers)

### Phase 3: Silo product assembly

- cheyenne-mountain repo renamed to silo (the product)
- Import platform-core + silo engine
- Wire: auth, tenancy, billing, integration layer (Linear/GitHub/Jira OAuth)
- Flow templates for customer onboarding
- Worker registration (managed + self-hosted)
- Metering wired into dispatcher for managed workers
- WOPR loaded as tenant #1

### Phase 4: wopr-platform cleanup

- Remove re-export shims from Phase 1
- Direct imports from platform-core throughout
- `services.ts` slimmed — platform factories replace inline initialization

Each phase is independently shippable.

## Technical Decisions (Reviewer Findings)

### 1. Unique constraints become composite (tenant_id, name)

`flow_definitions.name`, `gate_definitions.name`, `sources.name`, and `nuke_definitions.discipline` currently have global unique constraints. These become composite `(tenant_id, name)`. Every `getByName()` call in `IFlowRepository`, `IGateRepository`, etc. gains a `tenantId` parameter.

### 2. Scoped repository factory pattern for tenant isolation

Tenant isolation uses scoped repository factories, not per-method parameters. The product layer resolves `tenantId` from the authenticated token, then creates scoped repositories:

```typescript
// Product layer (silo or wopr-platform)
const tenantId = resolveFromToken(request)
const repos = engine.scopedRepos(tenantId)
// repos.flows.getByName("changeset") -- automatically filtered
// repos.entities.list() -- automatically filtered
```

This prevents cross-tenant leaks by construction. Every query includes `WHERE tenant_id = ?` without the caller needing to remember. The engine exposes `scopedRepos(tenantId)` which returns all repository interfaces pre-bound to that tenant.

### 3. Claim path tenant resolution

The product API middleware extracts `tenantId` from the worker's tenant-scoped bearer token and injects it into the engine call:

```
Worker request → auth middleware (extract tenantId from token) → engine.claim({role, tenantId, workerId})
```

The engine itself has no auth dependency. It receives `tenantId` as a parameter from the product layer. `IFlowEngine.claim()` signature becomes `claim({role, tenantId, workerId, flow?})`. The engine uses `scopedRepos(tenantId)` internally so the claim algorithm only sees that tenant's entities.

### 4. SQLite dropped, Postgres only

The SQLite dialect is not maintained alongside Postgres. Silo engine migrates fully to Postgres (`pgTable` schema, `pg` driver). The SQLite schema is deleted. Existing single-tenant SQLite deployments (cheyenne-mountain) migrate via a one-time data export/import.

Tests use PGlite (in-process Postgres, no external dependency, fast). This matches wopr-platform's test infrastructure.

### 5. Migration coordination: engine owns its schema namespace

Platform-core and silo engine each own their own Drizzle migration directory. Both target the same Postgres database but use separate migration tracking tables (`platform_migrations` and `engine_migrations`). No cross-package schema dependencies — they share a database, not a schema namespace. The product layer runs both migration sets at startup in order: platform-core first (tenants table must exist), then engine.

### 6. Data migration for existing deployments

Phase 2 includes a data migration script that:
1. Creates a WOPR tenant in the platform-core tenants table
2. Backfills `tenant_id` on all existing engine rows (entities, flows, invocations, etc.) with WOPR's tenant ID
3. Converts unique constraints to composite `(tenant_id, name)`
4. Validates referential integrity post-migration

### 7. Metering integration point

Metering happens in the product layer's dispatcher wrapper, not in the engine. The silo product wraps the engine's dispatcher with a metering decorator:

```typescript
class MeteredDispatcher implements IDispatcher {
  constructor(private inner: IDispatcher, private meter: MeterEmitter, private tenantId: string) {}
  async dispatch(prompt, opts) {
    const result = await this.inner.dispatch(prompt, opts)
    this.meter.emit({ tenantId: this.tenantId, tokens: result.usage, model: opts.modelTier })
    return result
  }
}
```

For self-hosted workers (BYOK), the product layer does not wrap with metering — no cost to track. The engine stays metering-agnostic.

### 8. Platform-core versioning

Platform-core follows semver. Both wopr-platform and silo pin to the same major version. Minor/patch updates are non-breaking. Major version bumps require coordinated upgrades across both consumers. CI for platform-core runs both consumers' test suites before publishing.

## Key Design Decisions

1. **Separate npm package for platform-core** — not monorepo, not fork. Both products import independently.
2. **Single Postgres database** — engine tables and platform tables coexist. No HTTP hop between product API and engine.
3. **`tenant_id` on all engine tables** — one engine instance, logical isolation at repository layer. Tenants can customize their flows.
4. **GitHub Actions runner model for workers** — managed (we run, metered) or self-hosted (they run, BYOK).
5. **Two revenue streams** — subscription (the car) + inference credits (the gas). Self-hosted brings own gas.
6. **WOPR is tenant #1** — dog-fooding from day one.
7. **Factory functions, not singletons** — platform-core exports composable factories. Each consumer configures their own instances.
