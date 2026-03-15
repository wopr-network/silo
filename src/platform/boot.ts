import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DomainEventPersistAdapter } from "../engine/domain-event-adapter.js";
import { Engine } from "../engine/engine.js";
import { EventEmitter } from "../engine/event-emitter.js";
import { createScopedRepos } from "../repositories/scoped-repos.js";
import { loadPlatformEnv } from "./config.js";
import { createDb, runMigrations, shutdown as shutdownDb } from "./db.js";
import { log } from "./log.js";

export async function boot(): Promise<void> {
  const env = loadPlatformEnv();

  // 1. Database
  const { db } = createDb(env.DATABASE_URL);

  // 2. Migrations
  await runMigrations(db);

  // 3. Repos
  const tenantId = "default";
  const repos = createScopedRepos(db, tenantId);

  // 4. Event emitter
  const eventEmitter = new EventEmitter();
  eventEmitter.register(new DomainEventPersistAdapter(repos.domainEvents));

  // 5. Engine
  const engine = new Engine({
    entityRepo: repos.entities,
    flowRepo: repos.flows,
    invocationRepo: repos.invocations,
    gateRepo: repos.gates,
    transitionLogRepo: repos.transitionLog,
    adapters: new Map(),
    eventEmitter,
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    withTransaction: (fn) => (db as any).transaction(async (tx: any) => fn(tx)),
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

  // 6. Start reaper
  const stopReaper = engine.startReaper(30_000);

  // 7. Platform-core integration (dynamic imports — optional deps)
  // biome-ignore lint/suspicious/noExplicitAny: platform-core DB type varies
  let platformDb: any = null;
  try {
    const platformCore = await import("@wopr-network/platform-core");
    if (platformCore && env.DATABASE_URL) {
      log.info("platform-core available, initializing auth + billing...");
      platformDb = platformCore;
    }
  } catch {
    log.info("platform-core not installed, skipping auth + billing");
  }

  // 8. Hono app
  const app = new Hono();

  // CORS
  const uiOrigin = env.UI_ORIGIN;
  if (uiOrigin) {
    app.use(
      "/api/*",
      cors({
        origin: uiOrigin,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    );
  }

  // Health endpoint
  app.get("/health", (c) => c.json({ status: "ok" }));

  // 9. Serve
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }) as import("node:http").Server;
  log.info(`holyship platform listening on ${env.HOST}:${env.PORT}`);

  // Graceful shutdown
  const onShutdown = async () => {
    log.info("Shutting down...");
    await stopReaper();
    server.close();
    await shutdownDb();
    // Keep platformDb reference to avoid unused warning
    if (platformDb) log.info("platform-core shutdown complete");
    process.exit(0);
  };
  process.once("SIGINT", () => void onShutdown());
  process.once("SIGTERM", () => void onShutdown());
}
