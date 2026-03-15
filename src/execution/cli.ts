#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { startHonoServer, HonoSseAdapter as UiSseAdapter } from "../api/hono-server.js";
import { DATABASE_URL } from "../config/db-url.js";
import { exportSeed } from "../config/exporter.js";
import { loadSeed } from "../config/seed-loader.js";

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

function tokensMatch(a: string, b: string): boolean {
  return a === b;
}

import { DomainEventPersistAdapter } from "../engine/domain-event-adapter.js";
import { Engine } from "../engine/engine.js";
import { EventEmitter } from "../engine/event-emitter.js";
import { bootstrap, type Db } from "../main.js";
import { DrizzleEntitySnapshotRepository } from "../repositories/drizzle/entity-snapshot.repo.js";
import {
  entities,
  entityHistory,
  flowDefinitions,
  flowVersions,
  gateDefinitions,
  gateResults,
  invocations,
  stateDefinitions,
  transitionRules,
} from "../repositories/drizzle/schema.js";
import { EventSourcedEntityRepository } from "../repositories/event-sourced/entity.repo.js";
import { EventSourcedInvocationRepository } from "../repositories/event-sourced/invocation.repo.js";
import type { IEntityRepository, IInvocationRepository } from "../repositories/interfaces.js";
import { createScopedRepos } from "../repositories/scoped-repos.js";
import type { McpServerDeps, McpServerOpts } from "./mcp-server.js";
import { createMcpServer, startStdioServer } from "./mcp-server.js";

const DB_URL_DEFAULT = DATABASE_URL;

/**
 * Validates that HOLYSHIP_ADMIN_TOKEN is set when network transports are active.
 * Throws if a network transport (HTTP or SSE) is started without a token.
 * Stdio-only mode is exempt (local, single-user).
 */
export function validateAdminToken(opts: {
  adminToken: string | undefined;
  startHttp: boolean;
  transport: string;
}): void {
  const transport = opts.transport.toLowerCase().trim();
  const token = opts.adminToken?.trim();
  const networkActive = opts.startHttp || transport === "sse";
  if (networkActive && !token) {
    throw new Error(
      "HOLYSHIP_ADMIN_TOKEN must be set when using HTTP or SSE transport. " +
        "Admin tools are accessible over the network and require authentication. " +
        "Set HOLYSHIP_ADMIN_TOKEN in your environment or use stdio transport for local-only access.",
    );
  }
}

/**
 * Validates that HOLYSHIP_WORKER_TOKEN is set when network transports are active.
 * Throws if a network transport (HTTP or SSE) is started without a token.
 * Stdio-only mode is exempt (local, single-user).
 */
export function validateWorkerToken(opts: {
  workerToken: string | undefined;
  startHttp: boolean;
  transport: string;
}): void {
  const transport = opts.transport.toLowerCase().trim();
  const token = opts.workerToken?.trim();
  const networkActive = opts.startHttp || transport === "sse";
  if (networkActive && !token) {
    throw new Error(
      "HOLYSHIP_WORKER_TOKEN must be set when using HTTP or SSE transport. " +
        "Worker tools (flow.*) are accessible over the network and require authentication. " +
        "Set HOLYSHIP_WORKER_TOKEN in your environment or use stdio transport for local-only access.",
    );
  }
}

const REAPER_INTERVAL_DEFAULT = "30000"; // 30s
const CLAIM_TTL_DEFAULT = "300000"; // 5min

function getTenantId(): string {
  return process.env.HOLYSHIP_TENANT_ID ?? "default";
}

async function openDb(url: string): Promise<{ db: Db; client: postgres.Sql }> {
  const { db, client } = await bootstrap(url);
  return { db, client };
}

const program = new Command();
program.name("holyship").version("0.1.0");

// ─── init ───
program
  .command("init")
  .option("--seed <path>", "Path to seed JSON file")
  .option("--force", "Drop existing data before loading")
  .option("--db-url <url>", "Database URL", DB_URL_DEFAULT)
  .action(async (opts) => {
    const seedPath = opts.seed;
    if (typeof seedPath !== "string") {
      console.log("Usage: holyship init --seed <path> [--force]");
      return;
    }

    const { db, client } = await openDb(opts.dbUrl);
    const tenantId = getTenantId();
    const repos = createScopedRepos(db, tenantId);

    if (opts.force) {
      await db.delete(gateResults).where(eq(gateResults.tenantId, tenantId));
      await db.delete(entityHistory).where(eq(entityHistory.tenantId, tenantId));
      await db.delete(invocations).where(eq(invocations.tenantId, tenantId));
      await db.delete(entities).where(eq(entities.tenantId, tenantId));
      await db.delete(transitionRules).where(eq(transitionRules.tenantId, tenantId));
      await db.delete(stateDefinitions).where(eq(stateDefinitions.tenantId, tenantId));
      await db.delete(flowVersions).where(eq(flowVersions.tenantId, tenantId));
      await db.delete(gateDefinitions).where(eq(gateDefinitions.tenantId, tenantId));
      await db.delete(flowDefinitions).where(eq(flowDefinitions.tenantId, tenantId));
    }

    const seedRoot = process.env.HOLYSHIP_SEED_ROOT;
    const result = await loadSeed(resolve(seedPath), repos.flows, repos.gates, {
      allowedRoot: seedRoot ?? process.cwd(),
      db,
    });
    console.log(`Loaded seed: flows: ${result.flows}, gates: ${result.gates}`);
    await client.end();
  });

// ─── export ───
program
  .command("export")
  .option("--out <path>", "Output file path (defaults to stdout)")
  .option("--db-url <url>", "Database URL", DB_URL_DEFAULT)
  .action(async (opts) => {
    const { db, client } = await openDb(opts.dbUrl);
    const tenantId = getTenantId();
    const repos = createScopedRepos(db, tenantId);
    const seed = await exportSeed(repos.flows, repos.gates);
    const json = JSON.stringify(seed, null, 2);

    if (opts.out) {
      writeFileSync(resolve(opts.out), json);
      console.log(`Exported to ${opts.out}`);
    } else {
      console.log(json);
    }
    await client.end();
  });

// ─── serve ───
program
  .command("serve")
  .description("Start MCP server")
  .option("--transport <type>", "Transport: stdio or sse", "stdio")
  .option("--port <number>", "Port for SSE transport", "3001")
  .option(
    "--host <address>",
    "Host address to bind to (default: 127.0.0.1, use 0.0.0.0 for network access)",
    "127.0.0.1",
  )
  .option("--db-url <url>", "Database URL", DB_URL_DEFAULT)
  .option("--reaper-interval <ms>", "Reaper poll interval in milliseconds", REAPER_INTERVAL_DEFAULT)
  .option("--claim-ttl <ms>", "Claim TTL in milliseconds", CLAIM_TTL_DEFAULT)
  .option("--http-only", "Start HTTP REST server only (no MCP stdio)")
  .option("--mcp-only", "Start MCP stdio only (no HTTP REST server)")
  .option("--http-port <number>", "Port for HTTP REST API", "3000")
  .option("--http-host <address>", "Host for HTTP REST API", "127.0.0.1")
  .option("--ui", "Enable built-in web UI at /ui")
  .action(async (opts) => {
    const { db, client } = await openDb(opts.dbUrl);
    const tenantId = getTenantId();
    const repos = createScopedRepos(db, tenantId);

    const mutableEntityRepo = repos.entities;
    const flowRepo = repos.flows;
    const mutableInvocationRepo = repos.invocations;
    const gateRepo = repos.gates;
    const transitionLogRepo = repos.transitionLog;

    const domainEventRepo = repos.domainEvents;

    const useEventSourced = process.env.HOLYSHIP_EVENT_SOURCED === "true";
    const snapshotInterval = parseInt(process.env.HOLYSHIP_SNAPSHOT_INTERVAL ?? "10", 10);

    let entityRepo: IEntityRepository;
    let invocationRepo: IInvocationRepository;

    if (useEventSourced) {
      const snapshotRepo = new DrizzleEntitySnapshotRepository(db, tenantId);
      entityRepo = new EventSourcedEntityRepository(mutableEntityRepo, domainEventRepo, snapshotRepo, snapshotInterval);
      invocationRepo = new EventSourcedInvocationRepository(mutableInvocationRepo, domainEventRepo);
      process.stderr.write("[holyship] Event-sourced repositories enabled\n");
    } else {
      entityRepo = mutableEntityRepo;
      invocationRepo = mutableInvocationRepo;
    }

    const eventEmitter = new EventEmitter();
    eventEmitter.register({
      emit: async (event) => {
        process.stderr.write(`[event] ${event.type} ${JSON.stringify(event)}\n`);
      },
    });
    eventEmitter.register(new DomainEventPersistAdapter(domainEventRepo));

    const engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo,
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
      domainEvents: domainEventRepo,
    });

    const deps: McpServerDeps = {
      entities: entityRepo,
      flows: flowRepo,
      invocations: invocationRepo,
      gates: gateRepo,
      transitions: transitionLogRepo,
      eventRepo: repos.events,
      domainEvents: domainEventRepo,
      engine,
      withTransaction: (fn) => db.transaction(async (tx) => fn(tx)),
      repoFactory: (tx) => {
        const r = createScopedRepos(tx, tenantId);
        return {
          entities: r.entities,
          flows: r.flows,
          invocations: r.invocations,
          gates: r.gates,
          transitions: r.transitionLog,
          eventRepo: r.events,
          domainEvents: r.domainEvents,
        };
      },
    };

    const reaperInterval = parseInt(opts.reaperInterval, 10);
    if (Number.isNaN(reaperInterval) || reaperInterval < 1000) {
      console.error("--reaper-interval must be a number >= 1000ms");
      await client.end();
      process.exit(1);
    }
    const claimTtl = parseInt(opts.claimTtl, 10);
    if (Number.isNaN(claimTtl) || claimTtl < 5000) {
      console.error("--claim-ttl must be a number >= 5000ms");
      await client.end();
      process.exit(1);
    }
    const stopReaper = engine.startReaper(reaperInterval, claimTtl);

    if (opts.httpOnly && opts.mcpOnly) {
      console.error("Cannot use --http-only and --mcp-only together");
      await stopReaper();
      await client.end();
      process.exit(1);
    }

    const adminToken = process.env.HOLYSHIP_ADMIN_TOKEN || undefined;
    const workerToken = process.env.HOLYSHIP_WORKER_TOKEN || undefined;

    const startHttp = !opts.mcpOnly;
    const startMcp = !opts.httpOnly;

    if (opts.mcpOnly && opts.ui) {
      console.warn("Warning: --ui is ignored when --mcp-only is set (HTTP server is disabled)");
    }

    try {
      validateAdminToken({ adminToken, startHttp, transport: opts.transport });
    } catch (err: unknown) {
      console.error((err as Error).message);
      await stopReaper();
      await client.end();
      process.exit(1);
    }

    try {
      validateWorkerToken({ workerToken, startHttp, transport: opts.transport });
    } catch (err: unknown) {
      console.error((err as Error).message);
      await stopReaper();
      await client.end();
      process.exit(1);
    }

    let restHttpServer: import("node:http").Server | undefined;
    if (startHttp) {
      const httpPort = parseInt(opts.httpPort as string, 10);
      const httpHost = opts.httpHost as string;
      const corsOrigins =
        process.env.HOLYSHIP_CORS_ORIGIN?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? [];
      const uiSseAdapter = opts.ui ? new UiSseAdapter() : undefined;
      const honoResult = startHonoServer(
        {
          engine,
          mcpDeps: deps,
          db,
          defaultTenantId: tenantId,
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
          adminToken,
          workerToken,
          corsOrigins: corsOrigins.length > 0 ? corsOrigins : undefined,
          enableUi: !!opts.ui,
          sseAdapter: uiSseAdapter,
        },
        httpPort,
        httpHost,
      );
      restHttpServer = honoResult.server;
      if (uiSseAdapter) {
        eventEmitter.register(uiSseAdapter);
      }
      console.error(`HTTP REST API listening on ${httpHost}:${httpPort}`);
    }

    if (opts.transport === "sse" && startMcp) {
      const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
      const http = await import("node:http");
      const port = parseInt(opts.port, 10);

      // Map session IDs to transports for POST routing
      const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();
      // Map session IDs to the SHA-256 hash of the bearer token used at SSE handshake
      const sessionTokens = new Map<string, string | undefined>();

      const host = opts.host as string;
      const sseCorsOrigins =
        process.env.HOLYSHIP_CORS_ORIGIN?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? [];
      const allowedOriginSet: Set<string> | null = sseCorsOrigins.length > 0 ? new Set(sseCorsOrigins) : null;
      const loopbackPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

      const httpServer = http.createServer(async (req, res) => {
        // CORS: restrict to localhost origins when bound to loopback; require HOLYSHIP_CORS_ORIGIN when bound to non-loopback
        const origin = req.headers.origin;
        if (origin) {
          const originAllowed = allowedOriginSet ? allowedOriginSet.has(origin) : loopbackPattern.test(origin);
          if (originAllowed) {
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Id, X-Tenant-Id");
          }
        }

        // Handle CORS preflight — scoped to SSE-related routes only
        if (req.method === "OPTIONS" && (req.url === "/sse" || req.url?.startsWith("/messages"))) {
          res.writeHead(204).end();
          return;
        }

        if (req.url === "/sse" && req.method === "GET") {
          const callerToken = extractBearerToken(req.headers.authorization);
          const transport = new SSEServerTransport("/messages", res);
          transports.set(transport.sessionId, transport);
          sessionTokens.set(
            transport.sessionId,
            callerToken != null ? createHash("sha256").update(callerToken).digest("hex") : undefined,
          );
          res.on("close", () => {
            transports.delete(transport.sessionId);
            sessionTokens.delete(transport.sessionId);
          });
          // Resolve tenant for this SSE session (header or default).
          // Validate format AND require admin auth to select a non-default tenant.
          const rawTenant =
            (Array.isArray(req.headers["x-tenant-id"]) ? req.headers["x-tenant-id"][0] : req.headers["x-tenant-id"]) ??
            tenantId;
          const isAdmin = adminToken != null && callerToken != null && tokensMatch(adminToken, callerToken);
          const validatedTenant = /^[a-zA-Z0-9_-]{1,64}$/.test(rawTenant) ? rawTenant : tenantId;
          const sessionTenantId = validatedTenant !== tenantId && !isAdmin ? tenantId : validatedTenant;
          let sessionDeps = deps;
          if (sessionTenantId !== tenantId) {
            const sessionRepos = createScopedRepos(db, sessionTenantId);
            // Each tenant session gets its own event emitter to prevent cross-tenant event leakage.
            const sessionEmitter = new EventEmitter();
            sessionEmitter.register(new DomainEventPersistAdapter(sessionRepos.domainEvents));
            const sessionEngine = new Engine({
              entityRepo: sessionRepos.entities,
              flowRepo: sessionRepos.flows,
              invocationRepo: sessionRepos.invocations,
              gateRepo: sessionRepos.gates,
              transitionLogRepo: sessionRepos.transitionLog,
              adapters: new Map(),
              eventEmitter: sessionEmitter,
              withTransaction: (fn) => db.transaction(async (tx) => fn(tx)),
              repoFactory: (tx) => {
                const r = createScopedRepos(tx, sessionTenantId);
                return {
                  entityRepo: r.entities,
                  flowRepo: r.flows,
                  invocationRepo: r.invocations,
                  gateRepo: r.gates,
                  transitionLogRepo: r.transitionLog,
                  domainEvents: r.domainEvents,
                };
              },
              domainEvents: sessionRepos.domainEvents,
            });
            // Start a reaper for this tenant so stale claims get cleaned up.
            sessionEngine.startReaper(reaperInterval, claimTtl);
            sessionDeps = {
              entities: sessionRepos.entities,
              flows: sessionRepos.flows,
              invocations: sessionRepos.invocations,
              gates: sessionRepos.gates,
              transitions: sessionRepos.transitionLog,
              eventRepo: sessionRepos.events,
              domainEvents: sessionRepos.domainEvents,
              engine: sessionEngine,
              withTransaction: (fn) => db.transaction(async (tx) => fn(tx)),
              repoFactory: (tx) => {
                const r = createScopedRepos(tx, sessionTenantId);
                return {
                  entities: r.entities,
                  flows: r.flows,
                  invocations: r.invocations,
                  gates: r.gates,
                  transitions: r.transitionLog,
                  eventRepo: r.events,
                  domainEvents: r.domainEvents,
                };
              },
            };
          }
          const mcpOpts: McpServerOpts = {
            adminToken,
            workerToken,
            callerToken,
          };
          const server = createMcpServer(sessionDeps, mcpOpts);
          await server.connect(transport);
        } else if (req.url?.startsWith("/messages") && req.method === "POST") {
          const url = new URL(req.url, `http://localhost:${port}`);
          const sessionId = resolveSessionId(req.headers, url.searchParams);
          const transport = transports.get(sessionId);
          if (!transport) {
            res.writeHead(404).end("Session not found");
          } else if (!verifySessionToken(sessionTokens.get(sessionId), extractBearerToken(req.headers.authorization))) {
            res.writeHead(401).end("Unauthorized");
          } else {
            await transport.handlePostMessage(req, res);
          }
        } else {
          res.writeHead(404).end();
        }
      });

      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        const boundPort = addr && typeof addr === "object" ? addr.port : port;
        console.log(`MCP SSE server listening on ${host}:${boundPort}`);
      });

      const shutdown = makeShutdownHandler({
        stopReaper,
        closeables: [{ close: () => restHttpServer?.close() }, httpServer, { close: () => void client.end() }],
      });
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } else if (startMcp) {
      // stdio (default)
      console.error("Starting MCP server on stdio...");
      const cleanup = makeShutdownHandler({
        stopReaper,
        closeables: [{ close: () => void client.end() }],
      });
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
      const mcpOpts: McpServerOpts = { adminToken, workerToken, stdioTrusted: true };
      await startStdioServer(deps, mcpOpts);
    } else {
      // HTTP-only mode — keep process alive
      const cleanup = makeShutdownHandler({
        stopReaper,
        closeables: [{ close: () => restHttpServer?.close() }, { close: () => void client.end() }],
      });
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
    }
  });

// ─── status ───
program
  .command("status")
  .description("Print pipeline status")
  .option("--flow <name>", "Filter by flow name")
  .option("--state <name>", "Filter by state")
  .option("--json", "Output as JSON")
  .option("--db-url <url>", "Database URL", DB_URL_DEFAULT)
  .action(async (opts) => {
    const { db, client } = await openDb(opts.dbUrl);
    const tenantId = getTenantId();
    const repos = createScopedRepos(db, tenantId);
    const flowRepo = repos.flows;
    const entityRepo = repos.entities;
    const invocationRepo = repos.invocations;

    const allFlows = await flowRepo.listAll();
    const targetFlows = opts.flow ? allFlows.filter((f) => f.name === opts.flow) : allFlows;

    if (targetFlows.length === 0 && opts.flow) {
      console.error(`Flow not found: ${opts.flow}`);
      await client.end();
      process.exit(1);
    }

    const statusData: Record<string, Record<string, number>> = {};
    let activeInvocations = 0;
    let pendingClaims = 0;

    for (const flow of targetFlows) {
      const flowStatus: Record<string, number> = {};
      for (const state of flow.states) {
        if (opts.state && state.name !== opts.state) continue;
        const entitiesInState = await entityRepo.findByFlowAndState(flow.id, state.name);
        flowStatus[state.name] = entitiesInState.length;
      }
      statusData[flow.name] = flowStatus;

      const flowInvocations = await invocationRepo.findByFlow(flow.id);
      activeInvocations += flowInvocations.filter((i) => i.claimedAt !== null && !i.completedAt && !i.failedAt).length;
      pendingClaims += flowInvocations.filter((i) => !i.claimedAt && !i.completedAt && !i.failedAt).length;
    }

    if (opts.json) {
      console.log(JSON.stringify({ flows: statusData, activeInvocations, pendingClaims }));
    } else {
      console.log("Pipeline Status");
      console.log("================");
      for (const [flowName, states] of Object.entries(statusData)) {
        console.log(`\nFlow: ${flowName}`);
        for (const [stateName, count] of Object.entries(states)) {
          console.log(`  ${stateName}: ${count} entities`);
        }
      }
      console.log(`\nActive invocations: ${activeInvocations}`);
      console.log(`Pending claims: ${pendingClaims}`);
    }

    await client.end();
  });

/**
 * Verifies that the token on an incoming POST /messages request matches the
 * token that was presented at SSE handshake time.
 *
 * Rules:
 * - If no token was stored at handshake (unauthenticated connection), any
 *   incoming token (or lack thereof) is accepted — the session itself was
 *   already established without auth.
 * - If a token WAS stored at handshake, the incoming request must supply the
 *   same token (timing-safe comparison). Missing or mismatched → reject.
 *
 * Exported for unit testing.
 */
export function verifySessionToken(storedTokenHash: string | undefined, incomingToken: string | undefined): boolean {
  if (!storedTokenHash) {
    // Session was established without a token; no per-request check needed.
    return true;
  }
  if (!incomingToken) {
    return false;
  }
  const hashIncoming = createHash("sha256").update(incomingToken).digest("hex");
  const storedBuf = Buffer.from(storedTokenHash, "hex");
  const incomingBuf = Buffer.from(hashIncoming, "hex");
  if (storedBuf.length !== incomingBuf.length) return false;
  return timingSafeEqual(storedBuf, incomingBuf);
}

/**
 * Builds a shutdown handler that calls stopReaper() with a timeout guard,
 * then closes resources and exits. Exported for unit testing.
 */
export function makeShutdownHandler(opts: {
  stopReaper: () => Promise<void>;
  closeables: Array<{ close: () => void }>;
  stopReaperTimeoutMs?: number;
}): () => void {
  const { stopReaper, closeables, stopReaperTimeoutMs = 5000 } = opts;
  return () => {
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("stopReaper timed out")), stopReaperTimeoutMs),
    );
    let exitCode = 0;
    Promise.race([stopReaper(), timeoutPromise])
      .catch((err: unknown) => {
        console.error("[shutdown] stopReaper failed:", err);
        exitCode = 1;
      })
      .finally(() => {
        for (const c of closeables) c.close();
        process.exit(exitCode);
      });
  };
}

/**
 * Resolves the MCP session ID for POST /messages routing.
 *
 * Prefers the X-Session-Id request header over the ?sessionId= query parameter.
 * Using a header prevents the session ID from appearing in nginx/ALB/CloudTrail
 * access logs, which would enable session hijacking.
 *
 * Exported for unit testing.
 */
export function resolveSessionId(
  headers: Record<string, string | string[] | undefined>,
  searchParams: URLSearchParams,
): string {
  const header = headers["x-session-id"];
  if (header) {
    return Array.isArray(header) ? header[0] : header;
  }
  return searchParams.get("sessionId") ?? "";
}

// Only run when invoked as the main entry point, not when imported as a module
const isMain = process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
