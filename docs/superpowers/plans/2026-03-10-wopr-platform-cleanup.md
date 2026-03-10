# wopr-platform Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove re-export shims from wopr-platform, replace with direct imports from `@wopr-network/platform-core`, slim down `services.ts`, and verify 6000+ tests stay green.

**Architecture:** Phase 1 left re-export shims in wopr-platform so tests kept passing during extraction. This plan removes those shims and updates all internal imports to go directly through platform-core. `services.ts` (the 300-line DI container) gets split — platform factory calls replace inline initialization.

**Tech Stack:** TypeScript 5.9, same stack as wopr-platform

**Spec:** `docs/specs/2026-03-10-silo-saas-platform-design.md` — Phase 4

**Depends on:** Plan 1 (platform-core published to npm).

---

## Critical Rule

**6000+ tests must pass after every task.** Run the full CI gate after each task:

```bash
cd ~/wopr-platform && pnpm lint && pnpm format && pnpm build && swiftformat apps/macos apps/ios && pnpm protocol:gen && pnpm test
```

---

## Chunk 1: Direct Imports — Module by Module

### Task 1: Replace DB schema shims

**Files:**
- Update: `~/wopr-platform/src/db/schema/index.ts`
- Update: all files that import platform schema tables

- [ ] **Step 1: Update schema barrel**

The current `src/db/schema/index.ts` re-exports platform tables from platform-core via shims. Replace with direct re-exports:

```typescript
// Platform tables — from platform-core
export {
  tenants, orgMemberships, organizationMembers, userRoles,
  creditTransactions, creditBalances, creditAutoTopup, creditAutoTopupSettings,
  meterEvents, sessionUsage, rateLimitEntries,
  tenantCustomers, payramCharges,
  providerCredentials, secretAuditLog, tenantApiKeys, tenantCapabilitySettings,
  emailNotifications, notificationQueue, notificationPreferences,
  adminAuditLog, adminUsers,
  couponCodes, promotions, promotionRedemptions,
  affiliates, affiliateFraud, dividendDistributions,
  accountDeletionRequests, accountExportRequests,
  webhookSeenEvents, spendingLimits, tenantAddons,
  platformApiKeys,
} from "@wopr-network/platform-core/db";

// Fleet tables — local (WOPR-specific)
export * from "./nodes.js";
export * from "./bot-instances.js";
export * from "./bot-profiles.js";
// ... all fleet/WOPR-specific tables
```

- [ ] **Step 2: Delete local copies of platform schema files**

Remove all platform schema `.ts` files from `src/db/schema/` that are now imported from platform-core. Keep fleet/WOPR-specific schema files.

- [ ] **Step 3: Run CI gate**

```bash
pnpm lint && pnpm format && pnpm build && swiftformat apps/macos apps/ios && pnpm protocol:gen && pnpm test
```

Expected: 6000+ tests PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: direct platform-core imports for DB schema"
```

---

### Task 2: Replace auth shims

**Files:**
- Delete: local auth files that are now shims
- Update: all files that import from `src/auth/`

- [ ] **Step 1: Update imports across the codebase**

Find all files importing from `./auth/` or `../auth/` and update to import from `@wopr-network/platform-core/auth`.

Where wopr-platform supplies callbacks (e.g., `onUserCreated` wiring fleet/services.js), keep a thin local file that configures the platform-core factory:

```typescript
// src/auth/index.ts (WOPR-specific wiring)
import { createBetterAuth } from "@wopr-network/platform-core/auth";
import { getOrgRepo, getDb, getPool } from "../fleet/services.js";

export const auth = createBetterAuth({
  db: getDb(),
  pool: getPool(),
  onUserCreated: async (userId) => {
    await getOrgRepo().ensurePersonalTenant(userId);
  },
});
```

- [ ] **Step 2: Delete shim files**

Remove all auth files that are pure re-exports. Keep only the WOPR-specific wiring file above.

- [ ] **Step 3: Run CI gate**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: direct platform-core imports for auth"
```

---

### Task 3: Replace credits + metering shims

**Files:**
- Delete: `src/monetization/credit.ts` shim
- Delete: `src/monetization/metering/` shims
- Delete: `src/monetization/credits/` shims (clean ones only)
- Update: imports throughout

- [ ] **Step 1: Update credit imports**

All files importing `Credit` from `../monetization/credit.js` → `@wopr-network/platform-core/credits`.

- [ ] **Step 2: Update metering imports**

All files importing from `../monetization/metering/` → `@wopr-network/platform-core/metering`.

- [ ] **Step 3: Update credit ledger imports**

Clean credit files (ledger, auto-topup, etc.) → `@wopr-network/platform-core/credits`.

WOPR-contaminated files (`bot-billing.ts`, `runtime-cron.ts`, etc.) stay local — they import from platform-core for the `ICreditLedger` interface but contain fleet logic.

- [ ] **Step 4: Delete shim files**

- [ ] **Step 5: Run CI gate**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: direct platform-core imports for credits + metering"
```

---

### Task 4: Replace billing shims (Stripe + PayRam)

**Files:**
- Delete: `src/monetization/payment-processor.ts` shim
- Delete: `src/monetization/stripe/` shims
- Delete: `src/monetization/payram/` shims
- Update: imports
- Keep: WOPR-specific billing wiring that supplies callbacks

- [ ] **Step 1: Update billing imports**

All files importing `IPaymentProcessor`, `StripePaymentProcessor`, etc. → `@wopr-network/platform-core/billing`.

- [ ] **Step 2: Wire WOPR-specific callbacks**

Where wopr-platform needs `onCreditsPurchased` to trigger bot reactivation:

```typescript
import { StripePaymentProcessor } from "@wopr-network/platform-core/billing";
import { BotBilling } from "./credits/bot-billing.js";

const stripe = new StripePaymentProcessor({
  // ... config
  onCreditsPurchased: async (tenantId, amount) => {
    await botBilling.reactivateSuspendedBots(tenantId);
  },
});
```

- [ ] **Step 3: Delete shim files**

- [ ] **Step 4: Run CI gate**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: direct platform-core imports for billing"
```

---

### Task 5: Replace remaining shims (email, security, middleware, tRPC, config)

**Files:**
- Delete: `src/email/` shims (keep notification-service if it has WOPR-specific methods)
- Delete: `src/security/encryption.ts`, `src/security/types.ts` shims
- Delete: `src/security/credential-vault/` shims
- Delete: `src/security/tenant-keys/` shims
- Delete: `src/api/middleware/rate-limit.ts`, `csrf.ts` shims
- Delete: `src/trpc/init.ts` shim
- Delete: `src/config/` shims (keep WOPR-specific config extensions)
- Update: all imports throughout

- [ ] **Step 1: Email**

Update imports. Keep any WOPR-specific notification methods. Delete pure shims.

- [ ] **Step 2: Security**

Update imports. wopr-platform supplies `buildPooledKeysMap()` locally (WOPR env vars). Credential vault imports from platform-core.

- [ ] **Step 3: Middleware**

Rate limit: import factory from platform-core, supply `platformRateLimitRules` locally.
CSRF: import factory from platform-core, supply exempt paths locally.

- [ ] **Step 4: tRPC init**

Import middleware factories from platform-core. wopr-platform's `init.ts` becomes a thin file that calls platform-core factories and adds WOPR-specific context:

```typescript
import { createTrpcMiddleware } from "@wopr-network/platform-core/trpc";
import { DrizzleOrgMemberRepository } from "../fleet/org-member-repository.js";

const orgMemberRepo = new DrizzleOrgMemberRepository(db);
export const { router, publicProcedure, protectedProcedure, adminProcedure, tenantProcedure } =
  createTrpcMiddleware({ orgMemberRepo });
```

- [ ] **Step 5: Config**

Import platform config schema from platform-core. Extend locally with DHT, discovery, pagerduty:

```typescript
import { platformConfigSchema } from "@wopr-network/platform-core/config";
import { dhtSchema } from "../dht/types.js";
import { discoverySchema } from "../discovery/types.js";

export const config = platformConfigSchema.merge(z.object({
  dht: dhtSchema,
  discovery: discoverySchema,
  pagerduty: pagerdutySchema,
})).parse(process.env);
```

- [ ] **Step 6: Delete all shim files**

- [ ] **Step 7: Run CI gate**

```bash
pnpm lint && pnpm format && pnpm build && swiftformat apps/macos apps/ios && pnpm protocol:gen && pnpm test
```

Expected: 6000+ tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "refactor: direct platform-core imports for email, security, middleware, tRPC, config"
```

---

## Chunk 2: services.ts Cleanup

### Task 6: Split services.ts

The 300-line `fleet/services.ts` lazy singleton container currently initializes both platform concerns (credit ledger, org repo, notification service) and WOPR concerns (fleet manager, command bus, node provisioner). Split into two:

**Files:**
- Slim: `~/wopr-platform/src/fleet/services.ts` (fleet-only singletons)
- Create: `~/wopr-platform/src/platform-services.ts` (platform-core factory calls)

- [ ] **Step 1: Identify platform singletons in services.ts**

Read `services.ts`. List every `getXxx()` that returns a platform-core entity:
- `getCreditLedger()`
- `getOrgRepo()`
- `getOrgMemberRepo()`
- `getNotificationService()`
- `getRateLimitRepo()`
- `getCredentialStore()`
- `getMeterEmitter()`
- etc.

- [ ] **Step 2: Create platform-services.ts**

```typescript
// src/platform-services.ts
import { CreditLedger } from "@wopr-network/platform-core/credits";
import { MeterEmitter } from "@wopr-network/platform-core/metering";
// ... other platform-core imports

let creditLedger: CreditLedger;
export function getCreditLedger(): CreditLedger {
  return creditLedger ??= new CreditLedger(getDb());
}
// ... repeat for each platform singleton
```

- [ ] **Step 3: Update services.ts**

Remove platform singletons from `fleet/services.ts`. It should only contain fleet/WOPR singletons:
- `getFleetManager()`
- `getCommandBus()`
- `getNodeProvisioner()`
- `getHeartbeatWatchdog()`
- `getRecoveryOrchestrator()`
- etc.

Import platform singletons from `../platform-services.js` where fleet code needs them.

- [ ] **Step 4: Update all imports**

Files that called `getXxx()` from `fleet/services.js` for platform singletons now import from `platform-services.js`.

- [ ] **Step 5: Run CI gate**

```bash
pnpm lint && pnpm format && pnpm build && swiftformat apps/macos apps/ios && pnpm protocol:gen && pnpm test
```

Expected: 6000+ tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: split services.ts into platform + fleet singletons"
```

---

### Task 7: Final verification

- [ ] **Step 1: Verify no shim files remain**

```bash
cd ~/wopr-platform
grep -r "re-export" src/ --include="*.ts" -l
```

Should return empty (no files contain "re-export" comments from the shim phase).

- [ ] **Step 2: Verify no duplicate code**

Platform-core code should not exist in both packages. Check:

```bash
# Credit class should only exist in platform-core
grep -r "class Credit" src/ --include="*.ts" -l
# Should return nothing — it's imported from platform-core
```

- [ ] **Step 3: Run full CI gate one final time**

```bash
pnpm lint && pnpm format && pnpm build && swiftformat apps/macos apps/ios && pnpm protocol:gen && pnpm test
```

Expected: 6000+ tests PASS. Zero warnings.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: wopr-platform cleanup complete — all platform code via @wopr-network/platform-core"
```

---

## Summary

| Chunk | Tasks | What it produces |
|-------|-------|------------------|
| 1 | 1-5 | All re-export shims replaced with direct platform-core imports |
| 2 | 6-7 | services.ts split, final verification |

**This is the simplest of the four plans.** Every task is mechanical: find imports, update paths, delete shims, run tests. The hard work (identifying seams, severing couplings, creating callback interfaces) was done in Plan 1. This plan is the follow-through.

**Key rule:** If any test breaks, do NOT push forward. Fix the import or wiring issue before proceeding. The re-export shims from Plan 1 guaranteed backward compatibility — removing them must not change behavior.
