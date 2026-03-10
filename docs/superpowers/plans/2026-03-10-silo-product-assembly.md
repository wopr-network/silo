# Silo Product Assembly — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the cheyenne-mountain repo into the silo SaaS product — wrapping the silo engine with platform-core (auth, billing, tenancy) and adding OAuth integrations (Linear, GitHub, Jira), customer onboarding, worker registration (managed + self-hosted), and metered inference billing.

**Architecture:** cheyenne-mountain (renamed to silo product) imports `@wopr-network/platform-core` for auth/billing/tenancy and `@wopr-network/silo` for the flow engine. The product API is a Hono + tRPC server that resolves tenant from auth, creates scoped engine repos, and proxies to the engine. WOPR is loaded as tenant #1 with its existing flows.

**Tech Stack:** TypeScript 5.9, Hono, tRPC v11, platform-core (better-auth, Stripe, Drizzle Postgres), silo engine (Postgres, scoped repos), Vitest

**Spec:** `docs/specs/2026-03-10-silo-saas-platform-design.md`

**Depends on:** Plan 1 (platform-core published) and Plan 2 (silo engine on Postgres with multi-tenancy).

---

## Current State of cheyenne-mountain

cheyenne-mountain is pure config today — no application code:
- Seed data: `seed/flows.json` (flows, states, gates, transitions)
- Gate scripts: `seed/gates/*.sh`
- Agent roles: `agents/*.md`
- onEnter scripts: `seed/scripts/*.js`
- Docker: `Dockerfile.silo`, `docker-compose.yml`, entrypoint script
- Documentation: `docs/`

The product API layer is entirely new code.

---

## Chunk 1: Repo Setup + Product API Scaffold

### Task 1: Rename repo and initialize product package

**Files:**
- Rename: repo from cheyenne-mountain to silo-product (or keep cheyenne-mountain as the repo name and just update package.json)
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/api/app.ts`

- [ ] **Step 1: Initialize Node.js project**

```bash
cd ~/cheyenne-mountain
pnpm init
```

- [ ] **Step 2: Configure package.json**

```json
{
  "name": "@wopr-network/silo-product",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "lint": "biome check src/",
    "format": "biome format src/ --write"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm add @wopr-network/platform-core @wopr-network/silo
pnpm add hono @hono/node-server @trpc/server drizzle-orm pg postgres zod better-auth stripe resend
pnpm add -D typescript vitest @biomejs/biome tsx @types/pg @electric-sql/pglite
```

- [ ] **Step 4: Create tsconfig.json**

Standard ESM TypeScript config matching wopr-platform's conventions.

- [ ] **Step 5: Create biome.json and .gitignore**

```bash
cp ~/wopr-platform/biome.json ./biome.json
echo -e "node_modules/\ndist/\n*.tsbuildinfo\n.env" >> .gitignore
```

- [ ] **Step 6: Create entry point**

```typescript
// src/index.ts
import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";

const port = Number(process.env.PORT ?? 3001);
const app = await createApp();
serve({ fetch: app.fetch, port });
console.log(`Silo product API listening on :${port}`);
```

- [ ] **Step 7: Scaffold empty Hono app**

```typescript
// src/api/app.ts
import { Hono } from "hono";

export async function createApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
```

- [ ] **Step 8: Verify it builds and starts**

```bash
pnpm build && node dist/index.js
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: scaffold silo product API"
```

---

### Task 2: Wire platform-core (auth + tenancy + billing)

**Files:**
- Create: `src/config/index.ts`
- Create: `src/db/index.ts`
- Modify: `src/api/app.ts`

- [ ] **Step 1: Create config**

```typescript
// src/config/index.ts
import { platformConfigSchema } from "@wopr-network/platform-core/config";

export const config = platformConfigSchema.parse(process.env);
```

Extend with silo-product-specific config (OAuth client IDs, etc.) as needed.

- [ ] **Step 2: Create database initialization**

```typescript
// src/db/index.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { platformSchema } from "@wopr-network/platform-core/db";
import { siloSchema } from "@wopr-network/silo";

// Merge platform + engine schemas
const schema = { ...platformSchema, ...siloSchema };

export function createDatabase(url: string) {
  const client = postgres(url);
  return { db: drizzle(client, { schema }), client };
}
```

- [ ] **Step 3: Wire auth into Hono app**

```typescript
import { createBetterAuth } from "@wopr-network/platform-core/auth";
import { csrfProtection } from "@wopr-network/platform-core/middleware";

export async function createApp() {
  const { db, client } = createDatabase(process.env.DATABASE_URL!);
  const auth = createBetterAuth({ db, pool: client });
  const app = new Hono();

  // Platform middleware
  app.use("*", csrfProtection({ exemptPaths: ["/api/webhooks/"] }));
  app.route("/api/auth", auth.handler);

  // Health
  app.get("/health", (c) => c.json({ ok: true }));

  return app;
}
```

- [ ] **Step 4: Run migrations at startup**

Both platform-core and silo engine migrations run in sequence:

```typescript
import { runPlatformMigrations } from "@wopr-network/platform-core/db";
import { runEngineMigrations } from "@wopr-network/silo";

await runPlatformMigrations(db);
await runEngineMigrations(db);
```

- [ ] **Step 5: Verify auth endpoints work**

```bash
pnpm dev &
curl -X POST http://localhost:3001/api/auth/sign-up -d '{"email":"test@test.com","password":"Test1234!"}' -H 'Content-Type: application/json'
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire platform-core auth and tenancy"
```

---

## Chunk 2: Engine Integration + Tenant Provisioning

### Task 3: Wire silo engine into the product API

**Files:**
- Create: `src/engine/index.ts`
- Modify: `src/api/app.ts`
- Create: `src/api/routes/engine.ts`

- [ ] **Step 1: Create engine factory**

```typescript
// src/engine/index.ts
import { createScopedRepos, Engine } from "@wopr-network/silo";
import type { Db } from "../db/index.js";

// Cache engines per tenant — Engine construction involves repo setup.
// Engines are stateless (no background timers/loops), safe to reuse.
const engineCache = new Map<string, Engine>();

export function getTenantEngine(db: Db, tenantId: string): Engine {
  let engine = engineCache.get(tenantId);
  if (!engine) {
    const repos = createScopedRepos(db, tenantId);
    engine = new Engine({
      entityRepo: repos.entities,
      flowRepo: repos.flows,
      invocationRepo: repos.invocations,
      gateRepo: repos.gates,
      transitionLogRepo: repos.transitionLog,
      eventRepo: repos.events,
      domainEventRepo: repos.domainEvents,
      snapshotRepo: repos.snapshots,
    });
    engineCache.set(tenantId, engine);
  }
  return engine;
}
```

- [ ] **Step 2: Create engine API routes**

Expose silo's REST API scoped by tenant. The auth middleware resolves tenantId, then routes proxy to a tenant-scoped engine:

```typescript
// src/api/routes/engine.ts
import { Hono } from "hono";
import { createTenantEngine } from "../../engine/index.js";

export function engineRoutes(db: Db) {
  const app = new Hono();

  // Resolve tenant from auth session/token
  app.use("*", async (c, next) => {
    const tenantId = c.get("tenantId"); // set by auth middleware
    c.set("engine", getTenantEngine(db, tenantId));
    await next();
  });

  app.get("/flows", async (c) => {
    const engine = c.get("engine");
    const flows = await engine.getFlows();
    return c.json(flows);
  });

  app.post("/entities", async (c) => {
    const engine = c.get("engine");
    const { flowName, refs, payload } = await c.req.json();
    const entity = await engine.createEntity(flowName, refs, payload);
    return c.json(entity, 201);
  });

  // ... remaining engine routes (claim, report, status, admin)

  return app;
}
```

- [ ] **Step 3: Mount engine routes in app**

```typescript
app.route("/api/engine", engineRoutes(db));
```

- [ ] **Step 4: Write integration test**

Test that two tenants with the same flow name are isolated.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tenant-scoped engine API routes"
```

---

### Task 4: Tenant provisioning and flow templates

When a new customer signs up, they need:
1. A tenant created (platform-core)
2. Default flow templates seeded into their tenant namespace

**Files:**
- Create: `src/tenancy/provisioner.ts`
- Create: `src/tenancy/flow-templates.ts`
- Create: `tests/tenancy/provisioner.test.ts`

- [ ] **Step 1: Define flow templates**

Generalize the WOPR flows into customer-facing templates:

```typescript
// src/tenancy/flow-templates.ts
export const FLOW_TEMPLATES = {
  "pr-only": { /* flow definition: backlog → coding → done */ },
  "pr-review": { /* backlog → coding → reviewing → fixing → done */ },
  "pr-auto-merge": { /* backlog → coding → reviewing → fixing → merging → done */ },
  "full-pipeline": { /* The full 8-state pipeline */ },
};
```

- [ ] **Step 2: Create tenant provisioner**

```typescript
// src/tenancy/provisioner.ts
export async function provisionTenant(db: Db, tenantId: string, template: string) {
  const repos = createScopedRepos(db, tenantId);
  const flowDef = FLOW_TEMPLATES[template];
  // Seed flow, states, gates, transitions into tenant's namespace
  await repos.flows.create(flowDef.flow);
  for (const state of flowDef.states) await repos.flows.addState(flowDef.flow.id, state);
  // ... gates, transitions
}
```

- [ ] **Step 3: Hook into signup flow**

Wire the provisioner as the `onUserCreated` callback in platform-core auth:

```typescript
const auth = createBetterAuth({
  db, pool: client,
  onUserCreated: async (userId) => {
    // platform-core creates personal tenant automatically
    await provisionTenant(db, userId, "pr-review"); // default template
  },
});
```

- [ ] **Step 4: Write test**

```typescript
it("provisions a new tenant with default flow template", async () => {
  // Create tenant, verify flows exist in their namespace
});
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tenant provisioning with flow templates"
```

---

### Task 5: Load WOPR as tenant #1

**Files:**
- Create: `src/tenancy/wopr-tenant.ts`
- Modify: `src/index.ts` (startup)

- [ ] **Step 1: Create WOPR tenant bootstrap**

```typescript
// src/tenancy/wopr-tenant.ts
import { readFile } from "fs/promises";

export async function bootstrapWoprTenant(db: Db, tenantId: string) {
  const repos = createScopedRepos(db, tenantId);

  // Check if WOPR tenant already has flows
  const existing = await repos.flows.list();
  if (existing.length > 0) return; // already seeded

  // Load WOPR seed data (the existing seed/flows.json)
  const seed = JSON.parse(await readFile("./seed/flows.json", "utf-8"));
  // Seed everything into the WOPR tenant namespace
  // ... (reuse silo's seed loader with tenant scoping)
}
```

- [ ] **Step 2: Call at startup**

```typescript
// In src/index.ts, after migrations:
await bootstrapWoprTenant(db, "wopr");
```

- [ ] **Step 3: Verify WOPR flows are queryable**

```bash
curl http://localhost:3001/api/engine/flows -H "x-tenant-id: wopr" -H "Authorization: Bearer ..."
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: bootstrap WOPR as tenant #1"
```

---

## Chunk 3: OAuth Integrations

### Task 6: GitHub OAuth integration

**Files:**
- Create: `src/integrations/github/oauth.ts`
- Create: `src/integrations/github/webhooks.ts`
- Create: `src/api/routes/integrations.ts`

- [ ] **Step 1: GitHub OAuth flow**

```typescript
// src/integrations/github/oauth.ts
export function githubOAuthRoutes(db: Db) {
  const app = new Hono();

  app.get("/connect", async (c) => {
    const tenantId = c.get("tenantId");
    const state = crypto.randomUUID();
    // Store state → tenantId mapping
    const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&state=${state}&scope=repo`;
    return c.redirect(url);
  });

  app.get("/callback", async (c) => {
    const { code, state } = c.req.query();
    // Exchange code for token, store in credential vault
    // Register webhooks on customer's repos
  });

  return app;
}
```

- [ ] **Step 2: GitHub webhook handler**

```typescript
// src/integrations/github/webhooks.ts
export async function handleGitHubWebhook(payload: any, tenantId: string, engine: Engine) {
  if (payload.action === "labeled" && payload.label.name === "silo") {
    // Create entity in tenant's flow
    await engine.createEntity("default-flow", {
      repo: payload.repository.full_name,
      issue: String(payload.issue.number),
    });
  }
}
```

- [ ] **Step 3: Mount routes**

```typescript
app.route("/api/integrations/github", githubOAuthRoutes(db));
app.post("/api/webhooks/github", handleGitHubWebhookRoute(db));
```

- [ ] **Step 4: Write test**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: GitHub OAuth integration"
```

---

### Task 7: Linear OAuth integration

**Files:**
- Create: `src/integrations/linear/oauth.ts`
- Create: `src/integrations/linear/webhooks.ts`

Same pattern as GitHub but using Linear's OAuth API and webhook format. silo already has a Linear source adapter (`src/sources/linear.ts`) — reuse the webhook validation (HMAC) from there.

- [ ] **Step 1: Linear OAuth flow**
- [ ] **Step 2: Linear webhook handler** (reuse silo's `handleLinearWebhook` pattern)
- [ ] **Step 3: Mount routes and test**
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: Linear OAuth integration"
```

---

### Task 8: Jira OAuth integration

**Files:**
- Create: `src/integrations/jira/oauth.ts`
- Create: `src/integrations/jira/webhooks.ts`

Jira uses OAuth 2.0 (3LO) via Atlassian Connect. Different flow from GitHub/Linear but same pattern: OAuth connect → store token in vault → register webhook → ingest events.

- [ ] **Step 1: Jira OAuth flow (Atlassian Connect)**
- [ ] **Step 2: Jira webhook handler**
- [ ] **Step 3: Mount routes and test**
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: Jira OAuth integration"
```

---

## Chunk 4: Worker Registration + Metered Billing

### Task 9: Self-hosted worker registration

Customers install the silo worker CLI and register with a tenant-scoped token.

**Files:**
- Create: `src/workers/registration.ts`
- Create: `src/api/routes/workers.ts`
- Create: `src/workers/token.ts`

- [ ] **Step 1: Worker token storage (opaque DB-backed tokens)**

Worker tokens are opaque random strings stored in a `worker_tokens` table. No unsigned base64 — tokens cannot be forged.

```typescript
// src/workers/token.ts
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export function generateWorkerToken(): string {
  return `silo_wk_${randomBytes(32).toString("hex")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

Schema (add to product's Drizzle schema):

```typescript
export const workerTokens = pgTable("worker_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(), // e.g., "my-macbook", "ci-runner-1"
  createdAt: bigint("created_at", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  revokedAt: bigint("revoked_at", { mode: "number" }),
});
```

- [ ] **Step 2: Registration API**

```typescript
app.post("/api/workers/register", tenantAuth, async (c) => {
  const tenantId = c.get("tenantId");
  const { name } = await c.req.json();
  const token = generateWorkerToken();
  await db.insert(workerTokens).values({
    tenantId,
    tokenHash: hashToken(token),
    name,
  });
  // Token is shown once, never stored in plaintext
  return c.json({
    token,
    endpoint: `${BASE_URL}/api/engine`,
    command: `npx @wopr-network/silo worker --endpoint ${BASE_URL}/api/engine --token ${token}`,
  });
});
```

- [ ] **Step 3: Unified auth middleware for engine routes**

Engine routes accept EITHER session auth (dashboard users) OR worker tokens (self-hosted/managed workers). One middleware handles both, sets `tenantId` consistently:

```typescript
// src/api/middleware/engine-auth.ts
app.use("/api/engine/*", async (c, next) => {
  // Try session auth first (dashboard users)
  const sessionUser = c.get("user");
  if (sessionUser) {
    c.set("tenantId", c.req.header("x-tenant-id") ?? sessionUser.id);
    return next();
  }

  // Try worker token (self-hosted/managed workers)
  const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
  if (bearer?.startsWith("silo_wk_")) {
    const hash = hashToken(bearer);
    const [row] = await db.select().from(workerTokens)
      .where(and(eq(workerTokens.tokenHash, hash), isNull(workerTokens.revokedAt)))
      .limit(1);
    if (!row) return c.json({ error: "invalid or revoked worker token" }, 401);
    c.set("tenantId", row.tenantId);
    return next();
  }

  return c.json({ error: "unauthorized" }, 401);
});
```

This resolves the dual-auth path: dashboard users hit engine routes via session, workers hit via bearer token. Both set `tenantId` the same way.

- [ ] **Step 4: Write test**
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: self-hosted worker registration with tenant-scoped tokens"
```

---

### Task 10: Metered dispatcher for managed workers

When silo's managed workers dispatch to Claude, we meter the token usage and debit the tenant's credit balance.

**Files:**
- Create: `src/workers/metered-dispatcher.ts`
- Create: `tests/workers/metered-dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe("MeteredDispatcher", () => {
  it("meters token usage after successful dispatch", async () => {
    const mockInner = { dispatch: vi.fn().mockResolvedValue({ signal: "done", usage: { inputTokens: 100, outputTokens: 50 } }) };
    const mockMeter = { emit: vi.fn() };
    const dispatcher = new MeteredDispatcher(mockInner, mockMeter, "tenant-1");
    await dispatcher.dispatch("prompt", { modelTier: "sonnet" });
    expect(mockMeter.emit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", tokens: expect.any(Number) }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement MeteredDispatcher**

```typescript
// src/workers/metered-dispatcher.ts
import type { IDispatcher } from "@wopr-network/silo";
import type { MeterEmitter } from "@wopr-network/platform-core/metering";

export class MeteredDispatcher implements IDispatcher {
  constructor(
    private inner: IDispatcher,
    private meter: MeterEmitter,
    private tenantId: string,
  ) {}

  async dispatch(prompt: string, opts: DispatchOpts) {
    const result = await this.inner.dispatch(prompt, opts);
    if (result.usage) {
      this.meter.emit({
        tenantId: this.tenantId,
        capability: "inference",
        provider: "anthropic",
        model: opts.modelTier,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: metered dispatcher for managed workers"
```

---

### Task 11: Wire billing (Stripe checkout + credit purchase)

**Files:**
- Create: `src/api/routes/billing.ts`
- Create: `src/billing/index.ts`

- [ ] **Step 1: Create billing routes using platform-core**

```typescript
// src/api/routes/billing.ts
import { createCreditCheckoutSession } from "@wopr-network/platform-core/billing";
import { CreditLedger } from "@wopr-network/platform-core/credits";

export function billingRoutes(db: Db) {
  const app = new Hono();
  const ledger = new CreditLedger(db);

  app.get("/balance", tenantAuth, async (c) => {
    const tenantId = c.get("tenantId");
    const balance = await ledger.getBalance(tenantId);
    return c.json({ balance: balance.toJSON() });
  });

  app.post("/checkout", tenantAuth, async (c) => {
    const tenantId = c.get("tenantId");
    const { amount } = await c.req.json();
    const session = await createCreditCheckoutSession({ tenantId, amount, ... });
    return c.json({ url: session.url });
  });

  app.post("/webhooks/stripe", async (c) => {
    // Stripe webhook handler from platform-core
  });

  return app;
}
```

- [ ] **Step 2: Mount billing routes**

```typescript
app.route("/api/billing", billingRoutes(db));
```

- [ ] **Step 3: Write integration test**
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: billing routes (Stripe checkout + credit balance)"
```

---

## Chunk 5: Docker + Deployment Update

### Task 12: Update Docker setup for the product

**Files:**
- Update: `Dockerfile.silo` → serves product API instead of raw silo CLI
- Update: `docker-compose.yml`
- Update: `cheyenne-mountain-entrypoint.sh`

- [ ] **Step 1: Update Dockerfile**

The container now runs the product API (which embeds the silo engine) instead of the raw silo CLI:

```dockerfile
FROM node:24-alpine
RUN apk add --no-cache git bash github-cli docker-cli
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Update docker-compose.yml**

Add Postgres service:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: silo
      POSTGRES_USER: silo
      POSTGRES_PASSWORD: silo
    volumes:
      - pgdata:/var/lib/postgresql/data

  silo:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://silo:silo@postgres:5432/silo
      # ... auth, stripe, integration keys
    ports:
      - "3001:3001"

  norad:
    # ... existing norad config
```

- [ ] **Step 3: Update entrypoint**

The entrypoint runs migrations then starts the product API. WOPR tenant is bootstrapped automatically at startup.

- [ ] **Step 4: Test full Docker stack**

```bash
docker compose up --build
```

Verify:
- Postgres starts
- Migrations run
- WOPR tenant bootstrapped
- Auth endpoints respond
- Engine routes respond (scoped to WOPR tenant)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Docker setup with Postgres + product API"
```

---

### Task 13: Run full test suite and validate

- [ ] **Step 1: Run all product tests**

```bash
cd ~/cheyenne-mountain && pnpm test
```

- [ ] **Step 2: Run validate.sh**

```bash
./validate.sh
```

Verify WOPR gate scripts, agent files, and flow integrity still pass.

- [ ] **Step 3: E2E test**

1. Start Docker stack
2. Sign up as a new user
3. Connect a test GitHub repo via OAuth
4. Create an entity in the user's default flow
5. Verify entity appears in the engine
6. Verify tenant isolation (user cannot see WOPR's entities)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: silo product assembly complete"
```

---

## Summary

| Chunk | Tasks | What it produces |
|-------|-------|------------------|
| 1 | 1-2 | Product API scaffold + platform-core wired (auth, tenancy, billing) |
| 2 | 3-5 | Engine integrated with tenant scoping, WOPR as tenant #1 |
| 3 | 6-8 | OAuth integrations (GitHub, Linear, Jira) |
| 4 | 9-11 | Worker registration (self-hosted + managed), metered billing |
| 5 | 12-13 | Docker deployment, E2E validation |

**Key patterns:**
- Product API wraps silo engine with auth/billing from platform-core
- Tenant resolved from session/token → scoped repos → engine
- WOPR is tenant #1, bootstrapped from existing seed data
- Self-hosted workers authenticate with tenant-scoped tokens
- Managed workers wrapped with MeteredDispatcher for inference billing
- OAuth connect for all three integrations (GitHub, Linear, Jira)
- Single Postgres database for platform + engine tables
