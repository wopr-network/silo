# Platform-Core Extraction — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared platform infrastructure (auth, billing, tenancy, metering, credential vault, email, rate limiting) from wopr-platform into a reusable `@wopr-network/platform-core` npm package, without breaking any of wopr-platform's 6000+ tests.

**Architecture:** Module-by-module extraction in topological dependency order. Each module is copied to platform-core, its tests verified, then wopr-platform's local copy is replaced with a re-export shim. wopr-platform's full test suite must pass after every module extraction.

**Tech Stack:** TypeScript 5.9, Drizzle ORM (Postgres), Hono, tRPC v11, better-auth, Stripe SDK, Resend, Vitest

**Spec:** `docs/specs/2026-03-10-silo-saas-platform-design.md`

**Extraction order rationale:** The spec lists modules alphabetically. This plan reorders them topologically — schema first (no deps), then config, encryption, credits, metering, email, auth, tenancy, billing, rate limiting, credential vault, middleware, tRPC. Each module depends only on previously extracted modules.

**Dependency graph:**
```
db/schema (no deps)
  └→ config/logger
  └→ security/encryption
  └→ credits/credit (depends on: config)
  └→ metering (depends on: credits, db, config)
  └→ credits/ledger + auto-topup (depends on: credits, db) — NOTE: auto-topup-charge depends on Stripe interface, uses ITenantCustomerRepository stub until Chunk 5
  └→ email (depends on: config, db)
  └→ admin/audit-log + admin/role-store (depends on: db)
  └→ auth (depends on: db, email, config, admin, tenancy/IOrgMemberRepository)
  └→ tenancy/org (depends on: db, auth)
  └→ billing/stripe + payram (depends on: credits, db) — completes auto-topup-charge wiring
  └→ middleware/rate-limit + csrf (depends on: db, auth)
  └→ security/credential-vault (depends on: encryption, db, admin/audit-log)
  └→ trpc/init (depends on: auth, tenancy)
```

---

## Important: DrizzleDb Type Strategy

wopr-platform's `DrizzleDb` type is `PgDatabase<PgQueryResultHKT, typeof fullSchema>` where `fullSchema` includes all 70 tables. platform-core only has ~30 platform tables.

**Strategy:** platform-core defines `PlatformDb = PgDatabase<PgQueryResultHKT, typeof platformSchema>`. All platform-core repositories use `PlatformDb` and direct table references (`db.select().from(creditTransactions)`) instead of Drizzle relational queries (`db.query.creditTransactions`). This avoids schema type coupling.

wopr-platform's `DrizzleDb` (full schema) is a superset of `PlatformDb`, so passing wopr-platform's db instance to platform-core repositories is type-safe — a wider type satisfies a narrower constraint.

If a repository currently uses relational queries, convert to direct table references during extraction.

---

## Chunk 1: Package Scaffolding + DB Schema + Config + Encryption

### Task 1: Scaffold platform-core package

**Files:**
- Create: `~/platform-core/package.json`
- Create: `~/platform-core/tsconfig.json`
- Create: `~/platform-core/vitest.config.ts`
- Create: `~/platform-core/src/index.ts`

- [ ] **Step 1: Initialize the package**

```bash
mkdir -p ~/platform-core/src
cd ~/platform-core
pnpm init
```

- [ ] **Step 2: Configure package.json**

```json
{
  "name": "@wopr-network/platform-core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./auth": "./dist/auth/index.js",
    "./billing": "./dist/billing/index.js",
    "./credits": "./dist/credits/index.js",
    "./metering": "./dist/metering/index.js",
    "./email": "./dist/email/index.js",
    "./security": "./dist/security/index.js",
    "./tenancy": "./dist/tenancy/index.js",
    "./db": "./dist/db/index.js",
    "./middleware": "./dist/middleware/index.js",
    "./trpc": "./dist/trpc/index.js",
    "./config": "./dist/config/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "biome check src/",
    "format": "biome format src/ --write"
  },
  "peerDependencies": {
    "drizzle-orm": ">=0.45",
    "hono": ">=4",
    "@trpc/server": ">=11",
    "better-auth": ">=1.5",
    "stripe": ">=17",
    "resend": ">=4",
    "pg": ">=8",
    "zod": ">=3"
  }
}
```

- [ ] **Step 3: Install dev dependencies**

```bash
cd ~/platform-core
pnpm add -D typescript vitest @biomejs/biome
pnpm add -D drizzle-orm hono @trpc/server better-auth stripe resend pg zod
pnpm add -D @types/pg
```

- [ ] **Step 4: Create tsconfig.json**

Match wopr-platform's tsconfig. Key settings: `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"outDir": "dist"`, `"declaration": true`.

```bash
cp ~/wopr-platform/tsconfig.json ~/platform-core/tsconfig.json
```

Edit to set `"outDir": "dist"`, `"declaration": true`, `"rootDir": "src"`.

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Create .gitignore and biome.json**

```bash
echo -e "node_modules/\ndist/\n*.tsbuildinfo" > ~/platform-core/.gitignore
cp ~/wopr-platform/biome.json ~/platform-core/biome.json
```

- [ ] **Step 7: Create empty barrel export**

```typescript
// src/index.ts
export {};
```

- [ ] **Step 8: Verify build works**

```bash
cd ~/platform-core && pnpm build
```

Expected: compiles with no errors.

- [ ] **Step 9: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold @wopr-network/platform-core package"
```

---

### Task 2: Extract DB utilities and platform schema tables

**Files:**
- Copy from wopr-platform: `src/db/index.ts`, `src/db/credit-column.ts`, `src/db/auth-user-repository.ts`
- Copy platform schema files (see list below)
- Create: `~/platform-core/src/db/index.ts`
- Create: `~/platform-core/src/db/schema/index.ts`

Platform schema tables to extract (from `~/wopr-platform/src/db/schema/`):
- `tenants.ts`, `org-memberships.ts`, `organization-members.ts`, `user-roles.ts`
- `platform-api-keys.ts`, `credits.ts`, `credit-auto-topup.ts`, `credit-auto-topup-settings.ts`
- `meter-events.ts`, `session-usage.ts`, `rate-limit-entries.ts`
- `tenant-customers.ts`, `payram.ts`
- `provider-credentials.ts`, `secret-audit-log.ts`, `tenant-api-keys.ts`, `tenant-capability-settings.ts`
- `email-notifications.ts`, `notification-queue.ts`, `notification-preferences.ts`
- `admin-audit.ts`, `admin-users.ts`
- `coupon-codes.ts`, `promotions.ts`, `promotion-redemptions.ts`
- `affiliate.ts`, `affiliate-fraud.ts`, `dividend-distributions.ts`
- `account-deletion-requests.ts`, `account-export-requests.ts`
- `webhook-seen-events.ts`, `spending-limits.ts`, `tenant-addons.ts`

- [ ] **Step 1: Copy DB utilities**

```bash
mkdir -p ~/platform-core/src/db/schema
cp ~/wopr-platform/src/db/index.ts ~/platform-core/src/db/index.ts
cp ~/wopr-platform/src/db/credit-column.ts ~/platform-core/src/db/credit-column.ts
cp ~/wopr-platform/src/db/auth-user-repository.ts ~/platform-core/src/db/auth-user-repository.ts
```

- [ ] **Step 2: Copy all platform schema files**

Copy each schema file listed above from `~/wopr-platform/src/db/schema/` to `~/platform-core/src/db/schema/`.

- [ ] **Step 3: Create platform schema barrel export**

Create `~/platform-core/src/db/schema/index.ts` that re-exports only the platform tables (not fleet/bot tables).

- [ ] **Step 4: Fix internal imports**

Update all import paths within copied files to use platform-core-relative paths. Key: schema files import from each other (e.g., `credits.ts` references `tenants.ts` for FK). Ensure all cross-references resolve within platform-core.

- [ ] **Step 5: Verify build compiles**

```bash
cd ~/platform-core && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: extract platform DB schema tables"
```

---

### Task 3: Extract config module (platform portion only)

The full config in wopr-platform imports DHT/discovery types. We extract only the platform-relevant config (billing, logLevel, nodeEnv, port) and the logger.

**Files:**
- Copy: `~/wopr-platform/src/config/logger.ts` → `~/platform-core/src/config/logger.ts`
- Create: `~/platform-core/src/config/index.ts` (platform-only config schema)
- Copy test: `~/wopr-platform/src/config/billing-env.test.ts`

**Seam to sever:** `config/index.ts` imports from `../dht/types.js` and `../discovery/types.js`. We create a new platform config schema that includes only billing + base settings. wopr-platform will compose its full config by merging platform base with WOPR-specific extensions.

- [ ] **Step 1: Copy logger.ts**

```bash
mkdir -p ~/platform-core/src/config
cp ~/wopr-platform/src/config/logger.ts ~/platform-core/src/config/logger.ts
```

- [ ] **Step 2: Create platform config schema**

Read `~/wopr-platform/src/config/index.ts` and extract only the billing, port, logLevel, nodeEnv, database sections into a new `~/platform-core/src/config/index.ts`. Export as `platformConfigSchema`. Do NOT include dht, discovery, pagerduty, or any fleet-specific config.

- [ ] **Step 3: Fix logger imports**

Update logger.ts to import from `./index.js` (the new platform config).

- [ ] **Step 4: Copy and adapt billing-env test**

```bash
cp ~/wopr-platform/src/config/billing-env.test.ts ~/platform-core/src/config/billing-env.test.ts
```

Update imports to point to platform-core paths.

- [ ] **Step 5: Verify tests pass**

```bash
cd ~/platform-core && pnpm test -- src/config/
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: extract platform config and logger"
```

---

### Task 4: Extract encryption module

Zero dependencies. Cleanest extraction.

**Files:**
- Copy: `~/wopr-platform/src/security/encryption.ts` → `~/platform-core/src/security/encryption.ts`
- Copy: `~/wopr-platform/src/security/types.ts` → `~/platform-core/src/security/types.ts`
- Copy: `~/wopr-platform/src/security/encryption.test.ts` → `~/platform-core/src/security/encryption.test.ts`

**Seam to sever:** `security/types.ts` exports `providerSchema` with WOPR-specific provider IDs (`discord`, `deepgram`). Generalize `Provider` to `string` in platform-core. wopr-platform can extend with its own provider enum.

- [ ] **Step 1: Copy encryption files**

```bash
mkdir -p ~/platform-core/src/security
cp ~/wopr-platform/src/security/encryption.ts ~/platform-core/src/security/encryption.ts
cp ~/wopr-platform/src/security/types.ts ~/platform-core/src/security/types.ts
cp ~/wopr-platform/src/security/encryption.test.ts ~/platform-core/src/security/encryption.test.ts
```

- [ ] **Step 2: Generalize Provider type**

Edit `~/platform-core/src/security/types.ts`: change `providerSchema` from a fixed enum to accept any string, or export it as a base that consumers extend. Keep the `EncryptedPayload` type as-is.

- [ ] **Step 3: Fix imports and run test**

```bash
cd ~/platform-core && pnpm test -- src/security/encryption.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract encryption module"
```

---

## Chunk 2: Credit + Metering + Credit Ledger

### Task 5: Extract Credit value object

**Files:**
- Copy: `~/wopr-platform/src/monetization/credit.ts` → `~/platform-core/src/credits/credit.ts`
- Copy: `~/wopr-platform/src/monetization/credit.test.ts` → `~/platform-core/src/credits/credit.test.ts`

- [ ] **Step 1: Copy Credit files**

```bash
mkdir -p ~/platform-core/src/credits
cp ~/wopr-platform/src/monetization/credit.ts ~/platform-core/src/credits/credit.ts
cp ~/wopr-platform/src/monetization/credit.test.ts ~/platform-core/src/credits/credit.test.ts
```

- [ ] **Step 2: Fix imports**

Update `credit.ts` to import logger from `../config/logger.js`.

- [ ] **Step 3: Run test**

```bash
cd ~/platform-core && pnpm test -- src/credits/credit.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract Credit value object"
```

---

### Task 6: Extract metering module

**Files:**
- Copy entire `~/wopr-platform/src/monetization/metering/` → `~/platform-core/src/metering/`
- Copy schema: `meter-events.ts`, `session-usage.ts` (already done in Task 2)

All metering files are clean — zero WOPR deps.

- [ ] **Step 1: Copy metering directory**

```bash
cp -r ~/wopr-platform/src/monetization/metering/ ~/platform-core/src/metering/
```

- [ ] **Step 2: Fix imports**

Update all files to use platform-core-relative paths:
- `../credit.js` → `../credits/credit.js`
- `../../config/index.js` → `../config/index.js`
- `../../db/` → `../db/`

- [ ] **Step 3: Run metering tests**

```bash
cd ~/platform-core && pnpm test -- src/metering/
```

Expected: All metering tests PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract metering module (WAL/DLQ)"
```

---

### Task 7: Extract credit ledger and auto-topup

**Files:**
- Copy clean files from `~/wopr-platform/src/monetization/credits/`:
  - `credit-ledger.ts`, `credit-transaction-repository.ts`, `signup-grant.ts`
  - `auto-topup-settings-repository.ts`, `auto-topup-event-log-repository.ts`
  - `auto-topup-charge.ts`, `auto-topup-usage.ts`, `auto-topup-schedule.ts`
  - `dividend-cron.ts`, `dividend-digest-cron.ts`, `dividend-repository.ts`
  - `credit-expiry-cron.ts`, `repository-types.ts`, `index.ts`
- Copy all corresponding test files
- Do NOT copy (WOPR-contaminated, stay in wopr-platform): `bot-billing.ts`, `runtime-cron.ts`, `runtime-scheduler.ts`, `phone-billing.ts`, `drizzle-phone-number-repository.ts`, `member-usage.ts`
- DEFERRED to Chunk 5: `auto-topup-charge.ts` (depends on Stripe's `ITenantCustomerRepository` — extract the interface as a stub now, wire the real implementation when Stripe is extracted in Task 12)

- [ ] **Step 1: Copy clean credit files**

Copy each clean file listed above to `~/platform-core/src/credits/`. Skip WOPR-contaminated files.

- [ ] **Step 2: Fix imports**

Update all DB/config/credit imports to platform-core-relative paths.

- [ ] **Step 3: Create ITenantCustomerRepository interface stub**

`auto-topup-charge.ts` depends on Stripe's `ITenantCustomerRepository`. Extract only the interface into `~/platform-core/src/credits/tenant-customer-repository.ts` so `auto-topup-charge.ts` can compile. The Drizzle implementation arrives with the Stripe module in Task 12.

- [ ] **Step 4: Update index.ts**

Remove re-exports of WOPR-contaminated files (`bot-billing`, `runtime-cron`, `phone-billing`, etc.) from the credits barrel export.

- [ ] **Step 5: Copy and adapt tests**

Copy all corresponding test files including `credit-ledger-extra.test.ts` and `credit-ledger.bench.ts`. Fix imports.

- [ ] **Step 6: Run credit tests**

```bash
cd ~/platform-core && pnpm test -- src/credits/
```

Expected: All clean credit tests PASS. Tests for WOPR-specific files (bot-billing etc.) are not present — they stay in wopr-platform.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: extract credit ledger and auto-topup"
```

---

## Chunk 3: Email

### Task 8: Extract email module

**Files:**
- Copy entire `~/wopr-platform/src/email/` → `~/platform-core/src/email/`
- Copy all test files

**Seam to sever:** `templates.ts` hardcodes WOPR branding (`https://app.wopr.bot`, "WOPR"). Parameterize with a `BrandConfig` object passed to template functions.

- [ ] **Step 1: Copy email directory**

```bash
cp -r ~/wopr-platform/src/email/ ~/platform-core/src/email/
```

- [ ] **Step 2: Parameterize branding in templates.ts**

Read `~/platform-core/src/email/templates.ts`. Create a `BrandConfig` type:

```typescript
export interface BrandConfig {
  appName: string;
  appUrl: string;
  supportEmail: string;
}
```

Replace all hardcoded WOPR references with `BrandConfig` fields passed to each template function.

- [ ] **Step 3: Fix imports**

Update `client.ts` → `../config/logger.js`, etc.

- [ ] **Step 4: Copy and adapt tests**

Update test imports. Update test assertions to use parameterized brand config.

- [ ] **Step 5: Run email tests**

```bash
cd ~/platform-core && pnpm test -- src/email/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: extract email module with parameterized branding"
```

---

## Chunk 4: Auth + Tenancy

### Task 9: Extract IOrgMemberRepository interface

Before extracting auth, we need the `IOrgMemberRepository` interface in platform-core. The Drizzle implementation stays in wopr-platform.

**Files:**
- Create: `~/platform-core/src/tenancy/org-member-repository.ts` (interface only)

- [ ] **Step 1: Read the interface from wopr-platform**

Read `~/wopr-platform/src/fleet/org-member-repository.ts`. Extract only the `IOrgMemberRepository` interface and its types — no Drizzle imports.

- [ ] **Step 2: Create interface file**

```bash
mkdir -p ~/platform-core/src/tenancy
```

Write `~/platform-core/src/tenancy/org-member-repository.ts` with just the interface.

- [ ] **Step 3: Verify build**

```bash
cd ~/platform-core && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract IOrgMemberRepository interface"
```

---

### Task 10: Extract auth module

**Files:**
- Copy from `~/wopr-platform/src/auth/`:
  - `index.ts`, `better-auth.ts`, `middleware.ts`
  - `api-key-repository.ts`, `login-history-repository.ts`
  - `user-creator.ts`, `user-role-repository.ts`
- Copy all auth test files
- Create: `~/platform-core/src/auth/index.ts`

**Seams to sever:**
1. `better-auth.ts` imports `getDb`/`getPool` from `fleet/services.js` → accept DB/Pool as constructor params
2. `better-auth.ts` dynamically imports `fleet/services.js` for `getOrgRepo().ensurePersonalTenant()` → accept callback
3. `index.ts` imports `IOrgMemberRepository` from `fleet/org-member-repository.js` → import from `../tenancy/org-member-repository.js`
4. `better-auth.ts` imports `admin/roles/role-store.js` → extract `AdminAuditLog` and `RoleStore` to platform-core first (they have zero fleet deps)

- [ ] **Step 1: Extract AdminAuditLog + its repository interface**

Copy `~/wopr-platform/src/admin/audit-log.ts` → `~/platform-core/src/admin/audit-log.ts`. Also copy `~/wopr-platform/src/admin/admin-audit-log-repository.ts` (the `IAdminAuditLogRepository` interface + Drizzle impl that `audit-log.ts` depends on). Copy their tests. Fix imports.

- [ ] **Step 2: Extract RoleStore**

Copy `~/wopr-platform/src/admin/roles/role-store.ts` → `~/platform-core/src/admin/role-store.ts`. Copy its test. Fix imports.

- [ ] **Step 3: Copy auth files**

```bash
mkdir -p ~/platform-core/src/auth
cp ~/wopr-platform/src/auth/*.ts ~/platform-core/src/auth/
```

- [ ] **Step 4: Sever fleet/services.js coupling in better-auth.ts**

Replace:
```typescript
import { getDb, getPool } from "../fleet/services.js"
```
With a factory function that accepts `db` and `pool` as parameters:
```typescript
export function createBetterAuth(config: { db: DrizzleDb; pool: Pool; onUserCreated?: (userId: string) => Promise<void> }) { ... }
```

Replace the dynamic `import("../fleet/services.js")` with the `onUserCreated` callback.

- [ ] **Step 5: Update auth/index.ts import**

Change `IOrgMemberRepository` import from `../fleet/org-member-repository.js` to `../tenancy/org-member-repository.js`.

- [ ] **Step 6: Fix all remaining imports**

Update all auth files to use platform-core-relative paths for db, config, email, admin modules.

- [ ] **Step 7: Copy and adapt auth tests**

Copy all auth test files. Update imports. Mock the `onUserCreated` callback instead of `fleet/services.js`.

- [ ] **Step 8: Run auth tests**

```bash
cd ~/platform-core && pnpm test -- src/auth/
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: extract auth module with factory pattern"
```

---

### Task 11: Extract tenancy/org module

**Files:**
- Copy: `~/wopr-platform/src/org/drizzle-org-repository.ts` → `~/platform-core/src/tenancy/drizzle-org-repository.ts`
- Copy: `~/wopr-platform/src/org/org-service.ts` → `~/platform-core/src/tenancy/org-service.ts`
- Copy tests

**Seams to sever:**
1. `org-service.ts` imports `botInstances` and `vpsSubscriptions` from DB schema for `deleteOrg()` → replace with `onBeforeDeleteOrg` hook
2. `org-service.ts` imports `TRPCError` from `@trpc/server` → replace with generic `PlatformError` class, or accept `@trpc/server` as peer dep (it already is)

- [ ] **Step 1: Copy org files**

```bash
cp ~/wopr-platform/src/org/drizzle-org-repository.ts ~/platform-core/src/tenancy/drizzle-org-repository.ts
cp ~/wopr-platform/src/org/org-service.ts ~/platform-core/src/tenancy/org-service.ts
```

- [ ] **Step 2: Sever deleteOrg fleet coupling**

In `org-service.ts`, replace the `botInstances`/`vpsSubscriptions` delete calls with an `onBeforeDeleteOrg?: (tenantId: string, db: DrizzleDb) => Promise<void>` callback injected at construction. wopr-platform will supply the callback that deletes fleet tables.

- [ ] **Step 3: Fix imports**

Update all DB/config imports to platform-core-relative paths.

- [ ] **Step 4: Copy and adapt tests**

```bash
cp ~/wopr-platform/src/org/org-repository.test.ts ~/platform-core/src/tenancy/org-repository.test.ts
cp ~/wopr-platform/src/org/org-service.test.ts ~/platform-core/src/tenancy/org-service.test.ts
```

Fix imports. Mock the `onBeforeDeleteOrg` callback.

- [ ] **Step 5: Run tenancy tests**

```bash
cd ~/platform-core && pnpm test -- src/tenancy/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: extract tenancy/org module with deleteOrg hook"
```

---

## Chunk 5: Billing (Stripe + PayRam)

### Task 12: Extract payment processor interface + Stripe + PayRam

**Files:**
- Copy: `~/wopr-platform/src/monetization/payment-processor.ts` → `~/platform-core/src/billing/payment-processor.ts`
- Copy: `~/wopr-platform/src/monetization/stripe/` → `~/platform-core/src/billing/stripe/`
- Copy: `~/wopr-platform/src/monetization/payram/` → `~/platform-core/src/billing/payram/`
- Copy all billing test files

**Seam to sever:** `stripe-payment-processor.ts` imports `BotBilling` for bot reactivation on credit purchase. Replace with an `onCreditsPurchased?: (tenantId: string, amount: Credit) => Promise<void>` callback.

- [ ] **Step 1: Copy payment processor interface**

```bash
mkdir -p ~/platform-core/src/billing/stripe ~/platform-core/src/billing/payram
cp ~/wopr-platform/src/monetization/payment-processor.ts ~/platform-core/src/billing/payment-processor.ts
cp ~/wopr-platform/src/monetization/payment-processor.test.ts ~/platform-core/src/billing/payment-processor.test.ts
```

- [ ] **Step 2: Copy Stripe module**

```bash
cp ~/wopr-platform/src/monetization/stripe/*.ts ~/platform-core/src/billing/stripe/
```

- [ ] **Step 3: Sever BotBilling coupling**

In `stripe-payment-processor.ts`, replace:
```typescript
import type { BotBilling } from "../credits/bot-billing.js"
```
With:
```typescript
onCreditsPurchased?: (tenantId: string, amount: Credit) => Promise<void>
```

Remove all `botBilling?.reactivateBot()` calls, replace with `this.onCreditsPurchased?.(tenantId, amount)`.

Do the same in `stripe/webhook.ts`.

- [ ] **Step 4: Copy PayRam module**

```bash
cp ~/wopr-platform/src/monetization/payram/*.ts ~/platform-core/src/billing/payram/
```

- [ ] **Step 5: Fix all imports**

Update credit, db, config imports throughout the billing module.

- [ ] **Step 6: Copy and adapt billing tests**

Copy all Stripe and PayRam test files. Update imports. Mock the `onCreditsPurchased` callback.

- [ ] **Step 7: Run billing tests**

```bash
cd ~/platform-core && pnpm test -- src/billing/
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: extract billing module (Stripe + PayRam)"
```

---

## Chunk 6: Rate Limiting + Credential Vault + Middleware + tRPC

### Task 13: Extract rate limiting

**Files:**
- Copy: `rate-limit.ts`, `get-client-ip.ts` → `~/platform-core/src/middleware/`
- Copy: `rate-limit-repository.ts`, `drizzle-rate-limit-repository.ts` → `~/platform-core/src/middleware/`
- Copy tests

**Seam to sever:** `platformRateLimitRules` contains WOPR-specific paths. Export only the generic `rateLimit()` and `rateLimitByRoute()` factories. The rules array stays in wopr-platform.

- [ ] **Step 1: Copy rate limiting files**

```bash
mkdir -p ~/platform-core/src/middleware
cp ~/wopr-platform/src/api/middleware/rate-limit.ts ~/platform-core/src/middleware/rate-limit.ts
cp ~/wopr-platform/src/api/middleware/get-client-ip.ts ~/platform-core/src/middleware/get-client-ip.ts
cp ~/wopr-platform/src/api/rate-limit-repository.ts ~/platform-core/src/middleware/rate-limit-repository.ts
cp ~/wopr-platform/src/api/drizzle-rate-limit-repository.ts ~/platform-core/src/middleware/drizzle-rate-limit-repository.ts
```

- [ ] **Step 2: Extract WOPR-specific rules**

Remove `platformRateLimitRules` from `rate-limit.ts`. Export only the generic factory functions. The rules become a config parameter:

```typescript
export function rateLimitByRoute(rules: RateLimitRule[], repo: IRateLimitRepository): MiddlewareHandler
```

- [ ] **Step 3: Copy and adapt tests**

```bash
cp ~/wopr-platform/src/api/middleware/rate-limit.test.ts ~/platform-core/src/middleware/rate-limit.test.ts
cp ~/wopr-platform/src/api/middleware/get-client-ip.test.ts ~/platform-core/src/middleware/get-client-ip.test.ts
```

- [ ] **Step 4: Run tests**

```bash
cd ~/platform-core && pnpm test -- src/middleware/
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: extract rate limiting factories"
```

---

### Task 14: Extract credential vault + tenant keys

**Files:**
- Copy: `~/wopr-platform/src/security/credential-vault/` → `~/platform-core/src/security/credential-vault/`
- Copy: `~/wopr-platform/src/security/tenant-keys/` → `~/platform-core/src/security/tenant-keys/`
- Copy: `~/wopr-platform/src/security/two-factor-repository.ts`
- Copy all security tests

**Seam to sever:** `key-resolution.ts` `buildPooledKeysMap()` hardcodes WOPR env vars. Extract the resolution algorithm, accept `pooledKeys: Map<string, string>` as a parameter.

- [ ] **Step 1: Copy credential vault**

```bash
cp -r ~/wopr-platform/src/security/credential-vault/ ~/platform-core/src/security/credential-vault/
cp -r ~/wopr-platform/src/security/tenant-keys/ ~/platform-core/src/security/tenant-keys/
cp ~/wopr-platform/src/security/two-factor-repository.ts ~/platform-core/src/security/two-factor-repository.ts
```

- [ ] **Step 2: Sever buildPooledKeysMap**

In `key-resolution.ts`, change `buildPooledKeysMap()` to accept the map as a parameter:

```typescript
export function resolveApiKey(opts: { tenantId: string; provider: string; pooledKeys: Map<string, string>; ... })
```

Move the env-var-reading `buildPooledKeysMap()` to wopr-platform.

- [ ] **Step 3: Fix imports**

Update `store.ts` AdminAuditLog import to `../../admin/audit-log.js` (already extracted in Task 10).

- [ ] **Step 4: Copy and adapt tests**

Copy all security test files. Fix imports.

- [ ] **Step 5: Run tests**

```bash
cd ~/platform-core && pnpm test -- src/security/
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: extract credential vault and tenant keys"
```

---

### Task 15: Extract CSRF middleware

**Files:**
- Copy: `~/wopr-platform/src/api/middleware/csrf.ts` → `~/platform-core/src/middleware/csrf.ts`
- Copy: `~/wopr-platform/src/api/middleware/csrf.test.ts`

**Seam to sever:** `isExempt()` hardcodes WOPR paths. Accept `exemptPaths: string[]` as parameter.

- [ ] **Step 1: Copy and parameterize**

Copy `csrf.ts`. Change `isExempt()` to accept an `exemptPaths` array instead of hardcoding paths.

- [ ] **Step 2: Copy and adapt test**

- [ ] **Step 3: Run test**

```bash
cd ~/platform-core && pnpm test -- src/middleware/csrf.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract CSRF middleware with configurable exempt paths"
```

---

### Task 16: Extract tRPC middleware factories

**Files:**
- Copy: `~/wopr-platform/src/trpc/init.ts` → `~/platform-core/src/trpc/init.ts`
- Copy: `~/wopr-platform/src/trpc/trpc.test.ts`

**Seam:** `IOrgMemberRepository` import already points to platform-core's tenancy module (done in Task 9).

- [ ] **Step 1: Copy tRPC init**

```bash
mkdir -p ~/platform-core/src/trpc
cp ~/wopr-platform/src/trpc/init.ts ~/platform-core/src/trpc/init.ts
cp ~/wopr-platform/src/trpc/trpc.test.ts ~/platform-core/src/trpc/trpc.test.ts
```

- [ ] **Step 2: Fix imports**

Update `IOrgMemberRepository` import to `../tenancy/org-member-repository.js`. Update auth imports to `../auth/index.js`.

- [ ] **Step 3: Run test**

```bash
cd ~/platform-core && pnpm test -- src/trpc/
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extract tRPC middleware factories"
```

---

## Chunk 7: Barrel Exports + wopr-platform Re-export Shims + Final Verification

### Task 17: Create barrel exports for platform-core

**Files:**
- Update: `~/platform-core/src/index.ts`
- Create subpath barrel exports for each module

- [ ] **Step 1: Create module barrel exports**

Ensure each module has an `index.ts` that exports its public API:
- `src/auth/index.ts`
- `src/billing/index.ts`
- `src/credits/index.ts`
- `src/metering/index.ts`
- `src/email/index.ts`
- `src/security/index.ts`
- `src/tenancy/index.ts`
- `src/db/index.ts`
- `src/middleware/index.ts`
- `src/trpc/index.ts`
- `src/config/index.ts`

- [ ] **Step 2: Create root barrel**

`src/index.ts` re-exports from all modules.

- [ ] **Step 3: Build and verify all exports resolve**

```bash
cd ~/platform-core && pnpm build
```

- [ ] **Step 4: Run full test suite**

```bash
cd ~/platform-core && pnpm test
```

Expected: ALL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: barrel exports for all platform-core modules"
```

---

### Task 18: Create re-export shims in wopr-platform

For each extracted module, replace wopr-platform's local code with a re-export from `@wopr-network/platform-core`. This is the critical step — wopr-platform's 6000+ tests must stay green.

**Strategy:** Use `file:` protocol to make platform-core available to wopr-platform without publishing. (`pnpm link` can break subpath exports — `file:` protocol is more reliable.)

**WARNING:** Do NOT run `pnpm test` in worktrees (OOMs). Run full test suite in the main checkout only. For worktree verification, use `npx vitest run src/path/to/specific-test.ts`.

- [ ] **Step 1: Add platform-core as file dependency in wopr-platform**

```bash
cd ~/wopr-platform && pnpm add @wopr-network/platform-core@file:../platform-core
```

- [ ] **Step 2: Create re-export shims, module by module**

For each extracted module, replace the local files with re-exports. Example for credit.ts:

```typescript
// src/monetization/credit.ts
export { Credit, type CreditLike } from "@wopr-network/platform-core/credits";
```

Do this for every extracted file, one module at a time. After each module:

```bash
cd ~/wopr-platform && pnpm test
```

If tests fail, fix the shim before moving to the next module. Order:
1. DB schema + utilities
2. Config + logger
3. Encryption
4. Credit value object
5. Metering
6. Credit ledger
7. Email
8. Auth (supply `onUserCreated` callback wiring fleet/services.js)
9. Tenancy (supply `onBeforeDeleteOrg` callback wiring fleet table deletes)
10. Billing (supply `onCreditsPurchased` callback wiring bot-billing)
11. Rate limiting (supply `platformRateLimitRules` from wopr-platform)
12. Credential vault (supply `buildPooledKeysMap()` from wopr-platform)
13. CSRF middleware (supply exempt paths from wopr-platform)
14. tRPC init

- [ ] **Step 3: Run full wopr-platform CI gate after ALL shims**

```bash
cd ~/wopr-platform && pnpm lint && pnpm format && pnpm build && pnpm test
```

Expected: 6000+ tests PASS. Zero lint errors. Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ~/wopr-platform && git add -A && git commit -m "refactor: consume @wopr-network/platform-core via re-export shims"
```

---

### Task 19: Publish platform-core v0.1.0

- [ ] **Step 1: Final full test run**

```bash
cd ~/platform-core && pnpm test
cd ~/wopr-platform && pnpm lint && pnpm format && pnpm build && pnpm test
```

Both must be green.

- [ ] **Step 2: Publish**

```bash
cd ~/platform-core && pnpm publish --access public
```

- [ ] **Step 3: Replace pnpm link with real dependency in wopr-platform**

```bash
cd ~/wopr-platform && pnpm unlink @wopr-network/platform-core
pnpm add @wopr-network/platform-core@0.1.0
```

- [ ] **Step 4: Run wopr-platform CI gate one more time**

```bash
cd ~/wopr-platform && pnpm lint && pnpm format && pnpm build && pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/wopr-platform && git add -A && git commit -m "chore: use published @wopr-network/platform-core@0.1.0"
```

---

## Summary

| Chunk | Tasks | What it produces |
|-------|-------|------------------|
| 1 | 1-4 | Package scaffold + DB schema + config + encryption |
| 2 | 5-7 | Credit value object + metering + credit ledger |
| 3 | 8 | Email module |
| 4 | 9-11 | Auth + tenancy (hardest seams) |
| 5 | 12 | Billing (Stripe + PayRam) |
| 6 | 13-16 | Rate limiting + credential vault + middleware + tRPC |
| 7 | 17-19 | Barrel exports + wopr-platform shims + publish |

**Key seams severed:**
- `fleet/services.js` singleton → factory injection
- `bot-billing.ts` fleet coupling → `onCreditsPurchased` callback
- `deleteOrg` fleet table refs → `onBeforeDeleteOrg` hook
- `IOrgMemberRepository` → interface extracted, impl stays in wopr-platform
- WOPR-specific config (DHT/discovery) → composable config schema
- WOPR-specific rate limit rules → configurable rules array
- WOPR-specific branding in emails → parameterized `BrandConfig`
- WOPR-specific provider IDs → generic `string` type
- WOPR-specific CSRF exempt paths → configurable array
- WOPR-specific pooled key env vars → caller-supplied map
