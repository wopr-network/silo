/**
 * Holyship boot sequence.
 *
 * Follows the paperclip-platform pattern:
 * DB → migrations → auth → credits → gateway → tRPC → engine → GitHub → serve()
 *
 * All route-adding work MUST happen before serve().
 * Hono builds its route matcher lazily on first fetch() — adding routes
 * after serve() throws: "Can not add a route since the matcher is already built."
 */

import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AuthUser } from "@wopr-network/platform-core/auth";
import type { TRPCContext } from "@wopr-network/platform-core/trpc";
import { createShipItRoutes } from "./api/ship-it.js";
import { app } from "./app.js";
import { getConfig } from "./config.js";
import { DomainEventPersistAdapter } from "./engine/domain-event-adapter.js";
import { Engine } from "./engine/engine.js";
import { EventEmitter } from "./engine/event-emitter.js";
import type { PrimitiveOpHandler } from "./engine/gate-evaluator.js";
import type { FlowEditService } from "./flows/flow-edit-service.js";
import { provisionEngineeringFlow } from "./flows/provision.js";
import { DrizzleGitHubInstallationRepository } from "./github/installation-repo.js";
import { checkCiStatus, checkCommentExists, checkPrStatus } from "./github/primitive-ops.js";
import { getInstallationAccessToken } from "./github/token-generator.js";
import { createGitHubWebhookRoutes } from "./github/webhook.js";
import { logger } from "./logger.js";
import type { Entity } from "./repositories/interfaces.js";
import { createScopedRepos } from "./repositories/scoped-repos.js";
import { createEngineRoutes } from "./routes/engine.js";
import { createFlowEditorRoutes } from "./routes/flow-editor.js";
import { createInterrogationRoutes } from "./routes/interrogation.js";

// ---------------------------------------------------------------------------
// Notification worker handle (for graceful shutdown)
// ---------------------------------------------------------------------------
let notificationWorkerTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// GitHub token resolution
// ---------------------------------------------------------------------------

async function getTokenForEntity(
  _entity: Entity,
  installationRepo: InstanceType<typeof DrizzleGitHubInstallationRepository>,
  appId: string,
  privateKey: string,
): Promise<string> {
  const installations = await installationRepo.listByTenant("default");
  if (installations.length === 0) {
    throw new Error("No GitHub App installations found");
  }
  const installation = installations[0];
  if (!installation.accessToken || !installation.tokenExpiresAt || installation.tokenExpiresAt < new Date()) {
    const { token, expiresAt } = await getInstallationAccessToken(appId, privateKey, installation.installationId);
    await installationRepo.updateToken(installation.installationId, token, expiresAt);
    return token;
  }
  return installation.accessToken;
}

function parseRepoFullName(entity: Entity): { owner: string; repo: string } {
  const fullName = entity.artifacts?.repoFullName as string | undefined;
  if (!fullName || !fullName.includes("/")) {
    throw new Error(`Entity ${entity.id} missing repoFullName artifact`);
  }
  const [owner, repo] = fullName.split("/");
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const config = getConfig();

  // ─── 1. Database ────────────────────────────────────────────────────
  const { getPool, getPlatformDb, getEngineDb } = await import("./db/index.js");
  const pool = getPool();
  const platformDb = getPlatformDb();
  const engineDb = getEngineDb();

  // ─── 2. Migrations (platform-core + holyship) ──────────────────────
  const { runMigrations } = await import("./db/migrate.js");
  await runMigrations(pool);
  logger.info("Database migrations complete");

  // ─── 2b. Product config (DB-driven) ────────────────────────────────
  try {
    const productConfigMod = (await import("@wopr-network/platform-core/product-config" as string)) as {
      platformBoot: (opts: { slug: string; db: unknown; devOrigins?: string[] }) => Promise<{
        service: unknown;
        config: { product: { brandName: string; domain: string } };
        corsOrigins: string[];
        seeded: boolean;
      }>;
    };
    const { config: productConfig, seeded: productConfigSeeded } = await productConfigMod.platformBoot({
      slug: config.PRODUCT_SLUG,
      db: platformDb,
    });
    if (productConfigSeeded) logger.info(`Auto-seeded product config for "${config.PRODUCT_SLUG}"`);
    logger.info(`Product config loaded: ${productConfig.product.brandName} (${productConfig.product.domain})`);
  } catch (err) {
    logger.warn("Product config boot failed (non-fatal)", { error: (err as Error).message });
  }

  // ─── 3. Seed notification templates ────────────────────────────────
  try {
    const { DEFAULT_TEMPLATES, DrizzleNotificationTemplateRepository } = await import(
      "@wopr-network/platform-core/email"
    );
    // biome-ignore lint/suspicious/noExplicitAny: PgDatabase generic
    const templateRepo = new DrizzleNotificationTemplateRepository(platformDb as any);
    const seeded = await templateRepo.seed(DEFAULT_TEMPLATES);
    if (seeded > 0) logger.info(`Seeded ${seeded} notification templates`);
  } catch (err) {
    logger.warn("Notification template seeding failed (non-fatal)", (err as Error).message);
  }

  // ─── 4. Credits (double-entry ledger) ──────────────────────────────
  const { DrizzleLedger, grantSignupCredits } = await import("@wopr-network/platform-core/credits");
  const creditLedger = new DrizzleLedger(platformDb);
  logger.info("Credit ledger initialized");

  // ─── 5. Auth (BetterAuth) ──────────────────────────────────────────
  const { initBetterAuth, runAuthMigrations } = await import("@wopr-network/platform-core/auth/better-auth");
  initBetterAuth({
    pool,
    db: platformDb,
    onUserCreated: async (userId: string) => {
      try {
        const granted = await grantSignupCredits(creditLedger, userId);
        if (granted) logger.info(`Granted welcome credits to user ${userId}`);
      } catch (err) {
        logger.error("Failed to grant signup credits", (err as Error).message);
      }
    },
  });
  try {
    await runAuthMigrations();
  } catch {
    logger.warn("BetterAuth migration skipped (tables may already exist)");
  }
  logger.info("BetterAuth initialized");

  // ─── 6. Org/tenant support ─────────────────────────────────────────
  const { DrizzleOrgMemberRepository } = await import("@wopr-network/platform-core/tenancy");
  const { setTrpcOrgMemberRepo } = await import("@wopr-network/platform-core/trpc");
  const orgMemberRepo = new DrizzleOrgMemberRepository(platformDb);
  setTrpcOrgMemberRepo(orgMemberRepo);
  const { setAuthHelperOrgMemberRepo } = await import("./trpc/auth-helpers.js");
  setAuthHelperOrgMemberRepo(orgMemberRepo);
  logger.info("Org tenant support initialized");

  // ─── 7. Gateway (OpenRouter metered proxy) ─────────────────────────
  if (config.OPENROUTER_API_KEY) {
    const { mountGateway, DrizzleServiceKeyRepository } = await import("@wopr-network/platform-core/gateway");
    const { DrizzleMeterEventRepository, MeterEmitter } = await import("@wopr-network/platform-core/metering");
    const { DrizzleBudgetChecker } = await import("@wopr-network/platform-core/monetization");

    const meter = new MeterEmitter(new DrizzleMeterEventRepository(platformDb), {
      walPath: `${config.FLEET_DATA_DIR}/meter-wal`,
      dlqPath: `${config.FLEET_DATA_DIR}/meter-dlq`,
    });
    const budgetChecker = new DrizzleBudgetChecker(platformDb);
    const serviceKeyRepo = new DrizzleServiceKeyRepository(platformDb);

    mountGateway(app, {
      meter,
      budgetChecker,
      creditLedger,
      providers: { openrouter: { apiKey: config.OPENROUTER_API_KEY } },
      resolveServiceKey: async (key: string) => {
        const tenant = await serviceKeyRepo.resolve(key);
        if (tenant) tenant.type = "platform_service";
        return tenant;
      },
    });
    logger.info("Inference gateway mounted at /v1 (OpenRouter)");
  } else {
    logger.warn("OPENROUTER_API_KEY not set — inference gateway disabled");
  }

  // ─── 8. tRPC dependency wiring ──────────────────────────────────────
  {
    const { setBillingRouterDeps } = await import("./trpc/routers/billing.js");
    const { setSettingsRouterDeps } = await import("./trpc/routers/settings.js");
    const { setProfileRouterDeps } = await import("./trpc/routers/profile.js");
    const { setOrgRouterDeps } = await import("./trpc/routers/org.js");

    // Org router deps
    const { BetterAuthUserRepository } = await import("@wopr-network/platform-core/db");
    const { DrizzleOrgRepository, OrgService } = await import("@wopr-network/platform-core/tenancy");
    const authUserRepo = new BetterAuthUserRepository(pool);
    const orgRepo = new DrizzleOrgRepository(platformDb);
    const orgService = new OrgService(orgRepo, orgMemberRepo, platformDb, { userRepo: authUserRepo });
    setOrgRouterDeps({ orgService, authUserRepo, creditLedger });

    // Billing deps (Stripe)
    const stripeKey = config.STRIPE_SECRET_KEY;
    if (stripeKey) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey);

      const { DrizzleTenantCustomerRepository, loadCreditPriceMap, StripePaymentProcessor } = await import(
        "@wopr-network/platform-core/billing"
      );
      const { DrizzleMeterAggregator, DrizzleUsageSummaryRepository } = await import(
        "@wopr-network/platform-core/metering"
      );
      const { DrizzleAutoTopupSettingsRepository } = await import("@wopr-network/platform-core/credits");
      const { DrizzleSpendingLimitsRepository } = await import(
        "@wopr-network/platform-core/monetization/drizzle-spending-limits-repository"
      );
      const { DrizzleDividendRepository } = await import(
        "@wopr-network/platform-core/monetization/credits/dividend-repository"
      );
      const { DrizzleAffiliateRepository } = await import(
        "@wopr-network/platform-core/monetization/affiliate/drizzle-affiliate-repository"
      );

      const tenantRepo = new DrizzleTenantCustomerRepository(platformDb);
      const priceMap = loadCreditPriceMap();
      const processor = new StripePaymentProcessor({
        stripe,
        tenantRepo,
        webhookSecret: config.STRIPE_WEBHOOK_SECRET ?? "",
        priceMap,
        creditLedger,
      });

      const usageSummaryRepo = new DrizzleUsageSummaryRepository(platformDb);
      const meterAggregator = new DrizzleMeterAggregator(usageSummaryRepo);
      const autoTopupSettingsStore = new DrizzleAutoTopupSettingsRepository(platformDb);
      const spendingLimitsRepo = new DrizzleSpendingLimitsRepository(platformDb);
      const dividendRepo = new DrizzleDividendRepository(platformDb);
      const affiliateRepo = new DrizzleAffiliateRepository(platformDb);

      setBillingRouterDeps({
        processor,
        tenantRepo,
        creditLedger,
        meterAggregator,
        priceMap,
        autoTopupSettingsStore,
        dividendRepo,
        spendingLimitsRepo,
        affiliateRepo,
      });

      // Re-wire org with billing deps
      setOrgRouterDeps({ orgService, authUserRepo, creditLedger, meterAggregator, processor, priceMap });
      logger.info("Billing tRPC router wired (Stripe + all repositories)");
    } else {
      logger.warn("STRIPE_SECRET_KEY not set — billing tRPC procedures will fail until configured");
    }

    // Settings deps
    const { DrizzleNotificationPreferencesStore } = await import("@wopr-network/platform-core/email");
    const notificationPrefsStore = new DrizzleNotificationPreferencesStore(platformDb);
    setSettingsRouterDeps({
      getNotificationPrefsStore: () => notificationPrefsStore,
    });

    // Profile deps
    setProfileRouterDeps({
      getUser: (userId) => authUserRepo.getUser(userId),
      updateUser: (userId, data) => authUserRepo.updateUser(userId, data),
      changePassword: (userId, currentPassword, newPassword) =>
        authUserRepo.changePassword(userId, currentPassword, newPassword),
    });

    logger.info("tRPC router deps wired");
  }

  // ─── 8b. Mount tRPC ─────────────────────────────────────────────────
  async function createTRPCContext(req: Request): Promise<TRPCContext> {
    let user: AuthUser | undefined;
    let tenantId: string | undefined;
    try {
      const { getAuth } = await import("@wopr-network/platform-core/auth/better-auth");
      const auth = getAuth();
      const session = await auth.api.getSession({ headers: req.headers });
      if (session?.user) {
        const sessionUser = session.user as { id: string; role?: string };
        const roles: string[] = [];
        if (sessionUser.role) roles.push(sessionUser.role);
        user = { id: sessionUser.id, roles };
        tenantId = req.headers.get("x-tenant-id") || sessionUser.id;
      }
    } catch {
      // Session resolution failed — user stays undefined
    }
    return { user, tenantId };
  }

  const { appRouter } = await import("./trpc/index.js");
  app.all("/trpc/*", async (c) => {
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => createTRPCContext(c.req.raw),
    });
    return response;
  });
  logger.info("tRPC router mounted at /trpc/*");

  // ─── 9. Flow engine ────────────────────────────────────────────────
  const tenantId = "default";
  const repos = createScopedRepos(engineDb, tenantId);

  const eventEmitter = new EventEmitter(logger);
  eventEmitter.register(new DomainEventPersistAdapter(repos.domainEvents));

  // GitHub primitive op handler (for gate evaluation)
  const hasGitHubApp = !!(config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY);
  const installationRepo = new DrizzleGitHubInstallationRepository(engineDb, tenantId);

  const primitiveOpHandler: PrimitiveOpHandler | undefined = hasGitHubApp
    ? async (primitiveOp, params, entity) => {
        const token = await getTokenForEntity(
          entity,
          installationRepo,
          config.GITHUB_APP_ID as string,
          config.GITHUB_APP_PRIVATE_KEY as string,
        );
        const { owner, repo } = parseRepoFullName(entity);
        const ctx = { token, owner, repo };

        switch (primitiveOp) {
          case "vcs.ci_status":
            return checkCiStatus(ctx, { ref: params.ref as string });
          case "vcs.pr_status":
            return checkPrStatus(ctx, { pullNumber: Number(params.pullNumber) });
          case "issue_tracker.comment_exists":
            return checkCommentExists(ctx, {
              issueNumber: Number(params.issueNumber),
              pattern: params.pattern as string,
            });
          default:
            return { outcome: "error", message: `Unknown primitive op: ${primitiveOp}` };
        }
      }
    : undefined;

  // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
  const withTransaction = <T>(fn: (tx: any) => T | Promise<T>): Promise<T> =>
    // biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
    (engineDb as any).transaction(async (tx: any) => fn(tx));

  const repoFactory = (tx: unknown) => {
    const r = createScopedRepos(tx, tenantId);
    return {
      entityRepo: r.entities,
      flowRepo: r.flows,
      invocationRepo: r.invocations,
      gateRepo: r.gates,
      transitionLogRepo: r.transitionLog,
      domainEvents: r.domainEvents,
    };
  };

  const engine = new Engine({
    entityRepo: repos.entities,
    flowRepo: repos.flows,
    invocationRepo: repos.invocations,
    gateRepo: repos.gates,
    transitionLogRepo: repos.transitionLog,
    adapters: new Map(),
    eventEmitter,
    withTransaction,
    repoFactory,
    domainEvents: repos.domainEvents,
    primitiveOpHandler,
  });

  // Provision the baked-in engineering flow
  const { flowId } = await provisionEngineeringFlow(repos.flows, repos.gates);
  logger.info(`Engineering flow provisioned: ${flowId}`);

  // Start reaper
  const stopReaper = engine.startReaper(30_000);

  // ─── 9b. FlowEditService (direct gateway call — no runner needed) ───
  const { FlowEditService } = await import("./flows/flow-edit-service.js");
  const flowEditService: FlowEditService = new FlowEditService({
    gatewayUrl: config.APP_BASE_URL ? `${config.APP_BASE_URL}/v1` : "http://localhost:3001/v1",
    platformServiceKey: config.HOLYSHIP_PLATFORM_SERVICE_KEY ?? config.HOLYSHIP_GATEWAY_KEY ?? "",
  });

  // ─── 9c. Reactive worker pool (ephemeral holyshipper containers) ───
  let holyshipperFleetManager: import("./fleet/provision-holyshipper.js").IFleetManager | undefined;
  if (config.HOLYSHIP_WORKER_IMAGE && config.HOLYSHIP_GATEWAY_KEY) {
    try {
      const Docker = (await import("dockerode")).default;
      const docker = new Docker();
      const { ProfileStore } = await import("@wopr-network/platform-core/fleet/profile-store");
      const { FleetManager } = await import("@wopr-network/platform-core/fleet");

      const profileStore = new ProfileStore(`${config.FLEET_DATA_DIR}/profiles`);
      const coreFleetManager = new FleetManager(docker, profileStore);

      const { HolyshipperFleetManager } = await import("./fleet/holyshipper-fleet-manager.js");
      holyshipperFleetManager = new HolyshipperFleetManager({
        fleetManager: coreFleetManager,
        image: config.HOLYSHIP_WORKER_IMAGE,
        gatewayUrl: config.APP_BASE_URL ? `${config.APP_BASE_URL}/v1` : "http://localhost:3001/v1",
        gatewayKey: config.HOLYSHIP_GATEWAY_KEY,
        network: config.DOCKER_NETWORK,
      });

      const { WorkerPool } = await import("./fleet/worker-pool.js");
      const workerPool = new WorkerPool({
        engine,
        db: engineDb,
        tenantId,
        fleetManager: holyshipperFleetManager,
        invocationRepo: repos.invocations,
        getGithubToken: async () => {
          if (!hasGitHubApp) return null;
          const installations = await installationRepo.listByTenant(tenantId);
          if (installations.length === 0) return null;
          const { token } = await getInstallationAccessToken(
            config.GITHUB_APP_ID as string,
            config.GITHUB_APP_PRIVATE_KEY as string,
            installations[0].installationId,
          );
          return token;
        },
        poolSize: 4,
      });

      eventEmitter.register(workerPool);
      logger.info("Reactive worker pool registered (4 slots)");
    } catch (err) {
      logger.warn("Worker pool setup failed (non-fatal)", (err as Error).message);
    }
  } else {
    logger.info("Worker pool disabled (HOLYSHIP_WORKER_IMAGE or HOLYSHIP_GATEWAY_KEY not set)");
  }

  // ─── 10. Engine REST routes (claim/report for holyshippers) ────────
  app.route(
    "/api",
    createEngineRoutes({
      engine,
      entities: repos.entities,
      flows: repos.flows,
      workerToken: config.HOLYSHIP_WORKER_TOKEN,
    }),
  );

  // ─── 11. Ship It routes ────────────────────────────────────────────
  app.route(
    "/api/ship-it",
    createShipItRoutes({
      engine,
      fetchIssue: async (owner, repo, issueNumber) => {
        if (!hasGitHubApp) {
          throw new Error("GitHub App not configured (set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY)");
        }
        const installations = await installationRepo.listByTenant(tenantId);
        if (installations.length === 0) {
          throw new Error("No GitHub App installations found");
        }
        const { token } = await getInstallationAccessToken(
          config.GITHUB_APP_ID as string,
          config.GITHUB_APP_PRIVATE_KEY as string,
          installations[0].installationId,
        );
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!res.ok) {
          throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
        }
        const issue = (await res.json()) as { title: string; body: string; html_url: string };
        return { title: issue.title, body: issue.body ?? "", htmlUrl: issue.html_url };
      },
    }),
  );

  // ─── 12. GitHub webhook routes ─────────────────────────────────────
  if (config.GITHUB_WEBHOOK_SECRET) {
    app.route(
      "/api/github/webhook",
      createGitHubWebhookRoutes({
        installationRepo,
        webhookSecret: config.GITHUB_WEBHOOK_SECRET,
        tenantId,
        onIssueOpened: async (payload) => {
          logger.info(`Issue opened: ${payload.owner}/${payload.repo}#${payload.issueNumber}`);
          await engine.createEntity("engineering", undefined, {
            repoFullName: `${payload.owner}/${payload.repo}`,
            issueNumber: payload.issueNumber,
            issueTitle: payload.issueTitle,
            issueBody: payload.issueBody,
          });
        },
      }),
    );
    logger.info("GitHub webhook routes mounted");
  }

  // ─── 12b. GitHub repos endpoint (for dashboard + ship-it UI) ────────
  if (hasGitHubApp) {
    app.get("/api/github/repos", async (c) => {
      try {
        const installations = await installationRepo.listByTenant(tenantId);
        if (installations.length === 0) {
          return c.json({ repositories: [] });
        }
        const { token } = await getInstallationAccessToken(
          config.GITHUB_APP_ID as string,
          config.GITHUB_APP_PRIVATE_KEY as string,
          installations[0].installationId,
        );
        const res = await fetch("https://api.github.com/installation/repositories?per_page=100", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!res.ok) {
          return c.json({ repositories: [], error: `GitHub API ${res.status}` }, 502);
        }
        const data = (await res.json()) as {
          repositories: { id: number; full_name: string; name: string }[];
        };
        return c.json({ repositories: data.repositories });
      } catch (err) {
        logger.error("Failed to list repos", (err as Error).message);
        return c.json({ repositories: [], error: (err as Error).message }, 500);
      }
    });
    logger.info("GitHub repos endpoint mounted");

    // GitHub issues endpoint — proxy to GitHub API via installation token
    app.get("/api/github/repos/:owner/:repo/issues", async (c) => {
      try {
        const owner = c.req.param("owner");
        const repo = c.req.param("repo");
        const state = c.req.query("state") ?? "open";
        const perPage = c.req.query("per_page") ?? "50";
        const installations = await installationRepo.listByTenant(tenantId);
        if (installations.length === 0) {
          return c.json({ issues: [] });
        }
        const { token } = await getInstallationAccessToken(
          config.GITHUB_APP_ID as string,
          config.GITHUB_APP_PRIVATE_KEY as string,
          installations[0].installationId,
        );
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${encodeURIComponent(state)}&per_page=${encodeURIComponent(perPage)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );
        if (!res.ok) {
          return c.json({ issues: [], error: `GitHub API ${res.status}` }, 502);
        }
        const issues = (await res.json()) as {
          number: number;
          title: string;
          labels: { name: string; color: string }[];
          created_at: string;
          html_url: string;
          pull_request?: unknown;
        }[];
        // Filter out PRs (GitHub API returns PRs as issues)
        return c.json({ issues: issues.filter((i) => !i.pull_request) });
      } catch (err) {
        logger.error("Failed to list issues", err);
        return c.json({ issues: [], error: (err as Error).message }, 500);
      }
    });
    logger.info("GitHub issues endpoint mounted");
  }

  // ─── 12c+12d. Flow editor + interrogation routes ────────────────────
  {
    const { InterrogationService } = await import("./flows/interrogation-service.js");
    const { GapActualizationService } = await import("./flows/gap-actualization-service.js");
    const { FlowDesignService } = await import("./flows/flow-design-service.js");

    const getGithubToken = async (): Promise<string | null> => {
      if (!hasGitHubApp) return null;
      const installations = await installationRepo.listByTenant(tenantId);
      if (installations.length === 0) return null;
      const installation = installations[0];
      if (!installation.accessToken || !installation.tokenExpiresAt || installation.tokenExpiresAt < new Date()) {
        const { token, expiresAt } = await getInstallationAccessToken(
          config.GITHUB_APP_ID as string,
          config.GITHUB_APP_PRIVATE_KEY as string,
          installation.installationId,
        );
        await installationRepo.updateToken(installation.installationId, token, expiresAt);
        return token;
      }
      return installation.accessToken;
    };

    const interrogationService = new InterrogationService({
      db: engineDb,
      tenantId,
      fleetManager: holyshipperFleetManager ?? {
        provision: () =>
          Promise.reject(new Error("Fleet not configured — set HOLYSHIP_WORKER_IMAGE + HOLYSHIP_GATEWAY_KEY")),
        teardown: () => Promise.resolve(),
      },
      getGithubToken,
    });

    const gapActualizationService = new GapActualizationService({
      interrogationService,
      engine,
      getGithubToken,
    });

    const flowDesignService = new FlowDesignService({
      interrogationService,
      gatewayUrl: config.APP_BASE_URL ? `${config.APP_BASE_URL}/v1` : "http://localhost:3001/v1",
      platformServiceKey: config.HOLYSHIP_PLATFORM_SERVICE_KEY ?? config.HOLYSHIP_GATEWAY_KEY ?? "",
    });

    if (hasGitHubApp) {
      app.route(
        "/api",
        createFlowEditorRoutes({
          getGithubToken: async () => {
            const installations = await installationRepo.listByTenant(tenantId);
            if (installations.length === 0) return null;
            const { token } = await getInstallationAccessToken(
              config.GITHUB_APP_ID as string,
              config.GITHUB_APP_PRIVATE_KEY as string,
              installations[0].installationId,
            );
            return token;
          },
          flowEditService,
          flowDesignService,
        }),
      );
      logger.info("Flow editor routes mounted");
    }

    app.route(
      "/api",
      createInterrogationRoutes({
        interrogationService,
        gapActualizationService,
      }),
    );
    logger.info("Interrogation routes mounted");
  }

  // ─── 13. Crypto payments (key server + EVM watchers) ────────────────
  if (config.CRYPTO_SERVICE_URL && config.CRYPTO_WEBHOOK_SECRET) {
    try {
      const { DrizzleCryptoChargeRepository, DrizzleWebhookSeenRepository } = await import(
        "@wopr-network/platform-core/billing"
      );
      const { setCryptoWebhookDeps } = await import("./routes/crypto-webhook.js");

      const cryptoChargeRepo = new DrizzleCryptoChargeRepository(platformDb);
      const replayGuard = new DrizzleWebhookSeenRepository(platformDb);

      // Wire webhook route deps
      setCryptoWebhookDeps({ chargeStore: cryptoChargeRepo, creditLedger, replayGuard }, config.CRYPTO_WEBHOOK_SECRET);

      // Mount crypto webhook route
      const { cryptoWebhookRoutes } = await import("./routes/crypto-webhook.js");
      app.route("/api/webhooks/crypto", cryptoWebhookRoutes);
      logger.info("Crypto webhook mounted (key server)");
    } catch (err) {
      logger.warn("Crypto payment setup failed (non-fatal)", (err as Error).message);
    }
  }

  // ─── 14. Notification pipeline (best-effort) ──────────────────────
  if (config.RESEND_API_KEY) {
    try {
      const {
        EmailClient,
        NotificationWorker,
        DrizzleNotificationQueueStore,
        DrizzleNotificationPreferencesStore,
        DrizzleNotificationTemplateRepository,
        HandlebarsRenderer,
      } = await import("@wopr-network/platform-core/email");

      // biome-ignore lint/suspicious/noExplicitAny: PgDatabase generic
      const pgDb = platformDb as any;
      const emailClient = new EmailClient({ apiKey: config.RESEND_API_KEY, from: config.FROM_EMAIL });
      const queueStore = new DrizzleNotificationQueueStore(platformDb);
      const prefsStore = new DrizzleNotificationPreferencesStore(platformDb);
      const templateRepo = new DrizzleNotificationTemplateRepository(pgDb);
      const renderer = new HandlebarsRenderer(templateRepo);
      const worker = new NotificationWorker({
        queue: queueStore,
        emailClient,
        preferences: prefsStore,
        handlebarsRenderer: renderer,
      });

      // Drain queued notifications, then poll every 30s
      worker.processBatch().catch((err: unknown) => {
        logger.error("Notification worker error (initial)", (err as Error).message);
      });
      notificationWorkerTimer = setInterval(() => {
        worker.processBatch().catch((err: unknown) => {
          logger.error("Notification worker error", (err as Error).message);
        });
      }, 30_000);

      logger.info("Notification pipeline started");
    } catch (err) {
      logger.warn("Notification pipeline failed (non-fatal)", (err as Error).message);
    }
  }

  // ─── 14. Serve ─────────────────────────────────────────────────────
  const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, () => {
    logger.info(`holyship listening on ${config.HOST}:${config.PORT}`);
    if (hasGitHubApp) {
      logger.info("GitHub App configured — primitive gates and Ship It are live");
    } else {
      logger.warn("GitHub App not configured — primitive gates will fail");
    }
  }) as import("node:http").Server;

  // ─── Graceful shutdown ─────────────────────────────────────────────
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down`);
      void stopReaper();
      if (notificationWorkerTimer) clearInterval(notificationWorkerTimer);
      server.close();
      pool.end().catch(() => {});
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error("Fatal startup error", (err as Error).message);
  process.exit(1);
});
