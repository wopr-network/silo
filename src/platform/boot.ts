/**
 * Holyship Platform boot sequence.
 *
 * Follows the paperclip-platform pattern:
 * DB → migrations → auth → billing → gateway → engine → serve()
 *
 * All route-adding MUST happen BEFORE serve() — Hono builds its matcher lazily.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DomainEventPersistAdapter } from "../engine/domain-event-adapter.js";
import { Engine } from "../engine/engine.js";
import { EventEmitter } from "../engine/event-emitter.js";
import { createScopedRepos } from "../repositories/scoped-repos.js";
import { getConfig } from "./config.js";
import { getDb, getPool, hasDatabase, runMigrations, shutdown } from "./db.js";
import { logger } from "./log.js";

// biome-ignore lint/suspicious/noExplicitAny: platform-core DrizzleDb has different schema type than holyship's Db
type AnyDb = any;

const app = new Hono();

async function main() {
  const config = getConfig();

  if (!hasDatabase()) {
    logger.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = getPool();
  const db = getDb();
  const coreDb = db as AnyDb;

  // 1. Run holyship migrations
  await runMigrations();
  logger.info("Holyship database migrations complete");

  // 2. Run platform-core migrations (uses pg Pool, not drizzle)
  try {
    const coreMigrationsPath = require.resolve("@wopr-network/platform-core/package.json");
    const { dirname, resolve } = await import("node:path");
    const coreDrizzleFolder = resolve(dirname(coreMigrationsPath), "dist", "drizzle");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const corePgClient = (await import("postgres")).default(process.env.DATABASE_URL ?? "");
    const coreDrizzleDb = drizzle(corePgClient);
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(coreDrizzleDb, { migrationsFolder: coreDrizzleFolder });
    await corePgClient.end();
    logger.info("Platform-core database migrations complete");
  } catch (err) {
    logger.warn(`Platform-core migrations failed: ${(err as Error).message}`);
  }

  // 3. Initialize credit ledger
  // biome-ignore lint/suspicious/noExplicitAny: ILedger type from platform-core
  let creditLedger: any = null;
  try {
    const { DrizzleLedger, grantSignupCredits } = await import("@wopr-network/platform-core/credits");
    creditLedger = new DrizzleLedger(coreDb);
    logger.info("Credit ledger initialized");

    // 4. Initialize BetterAuth
    const { initBetterAuth, runAuthMigrations } = await import("@wopr-network/platform-core/auth/better-auth");
    initBetterAuth({
      pool,
      db: coreDb,
      onUserCreated: async (userId: string) => {
        try {
          const granted = await grantSignupCredits(creditLedger, userId);
          if (granted) logger.info(`Granted welcome credits to user ${userId}`);
        } catch (grantErr) {
          logger.error(`Failed to grant signup credits: ${(grantErr as Error).message}`);
        }
      },
    });
    try {
      await runAuthMigrations();
    } catch (authMigErr) {
      logger.warn(`BetterAuth migration skipped: ${(authMigErr as Error).message}`);
    }
    logger.info("BetterAuth initialized");
  } catch (err) {
    logger.error(`Auth/billing initialization failed: ${(err as Error).message}`);
  }

  // 5. Mount metered inference gateway
  if (config.OPENROUTER_API_KEY && creditLedger) {
    try {
      const { mountGateway, DrizzleServiceKeyRepository } = await import("@wopr-network/platform-core/gateway");
      const { DrizzleMeterEventRepository, MeterEmitter } = await import("@wopr-network/platform-core/metering");
      const { DrizzleBudgetChecker } = await import("@wopr-network/platform-core/monetization");

      const meter = new MeterEmitter(new DrizzleMeterEventRepository(coreDb), {
        walPath: `${config.FLEET_DATA_DIR}/meter-wal`,
        dlqPath: `${config.FLEET_DATA_DIR}/meter-dlq`,
      });
      const budgetChecker = new DrizzleBudgetChecker(coreDb);
      const serviceKeyRepo = new DrizzleServiceKeyRepository(coreDb);

      mountGateway(app, {
        meter,
        budgetChecker,
        creditLedger,
        providers: {
          openrouter: { apiKey: config.OPENROUTER_API_KEY },
        },
        resolveServiceKey: (key: string) => serviceKeyRepo.resolve(key),
      });

      logger.info("Inference gateway mounted at /v1 (OpenRouter)");
    } catch (err) {
      logger.warn(`Gateway mount failed: ${(err as Error).message}`);
    }
  } else {
    logger.warn("Gateway disabled — OPENROUTER_API_KEY not set or no credit ledger");
  }

  // 6. Initialize holyship engine
  const tenantId = "default";
  const repos = createScopedRepos(db, tenantId);
  const eventEmitter = new EventEmitter();
  eventEmitter.register(new DomainEventPersistAdapter(repos.domainEvents));

  const engine = new Engine({
    entityRepo: repos.entities,
    flowRepo: repos.flows,
    invocationRepo: repos.invocations,
    gateRepo: repos.gates,
    transitionLogRepo: repos.transitionLog,
    adapters: new Map(),
    eventEmitter,
    withTransaction: (fn) => db.transaction(async (tx) => fn(tx)),
    repoFactory: (tx) => {
      const r = createScopedRepos(tx, tenantId);
      return {
        entityRepo: r.entities,
        flowRepo: r.flows,
        invocationRepo: r.invocations,
        gateRepo: r.gates,
        transitionLogRepo: r.transitionLog,
        domainEvents: r.domainEvents,
      };
    },
    domainEvents: repos.domainEvents,
  });

  engine.startReaper(30_000);
  logger.info("Holyship engine initialized");

  // 7. CORS
  app.use(
    "/api/*",
    cors({
      origin: config.UI_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // 8. TODO: Mount holyship API routes (claim/report/entity CRUD)
  // 9. TODO: Mount tRPC adapter
  // 10. TODO: Mount GitHub webhook receiver

  app.get("/api/health", (c) => c.json({ ok: true, engine: "holyship" }));

  // --- All routes mounted. Safe to serve. ---
  serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
    logger.info(`holyship-platform listening on ${info.address}:${info.port}`);
  });
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${(err as Error).message}`);
  process.exit(1);
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, shutting down`);
    await shutdown();
    process.exit(0);
  });
}
