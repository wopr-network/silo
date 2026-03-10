#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { Command } from "commander";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { startHonoServer, HonoSseAdapter as UiSseAdapter } from "../api/hono-server.js";
import { DB_PATH } from "../config/db-path.js";
import { exportSeed } from "../config/exporter.js";
import { loadSeed } from "../config/seed-loader.js";
import { resolveCorsOrigin } from "../cors.js";
import { DomainEventPersistAdapter } from "../engine/domain-event-adapter.js";
import { Engine } from "../engine/engine.js";
import { EventEmitter } from "../engine/event-emitter.js";
import { buildConfigFromEnv, isLitestreamEnabled, LitestreamManager } from "../litestream/manager.js";
import { withTransaction } from "../main.js";
import { DrizzleDomainEventRepository } from "../repositories/drizzle/domain-event.repo.js";
import { DrizzleEntityRepository } from "../repositories/drizzle/entity.repo.js";
import { DrizzleEntitySnapshotRepository } from "../repositories/drizzle/entity-snapshot.repo.js";
import { DrizzleEventRepository } from "../repositories/drizzle/event.repo.js";
import { DrizzleFlowRepository } from "../repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../repositories/drizzle/invocation.repo.js";
import * as schema from "../repositories/drizzle/schema.js";
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
import { DrizzleTransitionLogRepository } from "../repositories/drizzle/transition-log.repo.js";
import { EventSourcedEntityRepository } from "../repositories/event-sourced/entity.repo.js";
import { EventSourcedInvocationRepository } from "../repositories/event-sourced/invocation.repo.js";
import type { IEntityRepository, IInvocationRepository } from "../repositories/interfaces.js";
import { WebSocketBroadcaster } from "../ws/broadcast.js";
import type { McpServerDeps, McpServerOpts } from "./mcp-server.js";
import { createMcpServer, startStdioServer } from "./mcp-server.js";

const DB_DEFAULT = DB_PATH;

/**
 * Validates that SILO_ADMIN_TOKEN is set when network transports are active.
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
      "SILO_ADMIN_TOKEN must be set when using HTTP or SSE transport. " +
        "Admin tools are accessible over the network and require authentication. " +
        "Set SILO_ADMIN_TOKEN in your environment or use stdio transport for local-only access.",
    );
  }
}

/**
 * Validates that SILO_WORKER_TOKEN is set when network transports are active.
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
      "SILO_WORKER_TOKEN must be set when using HTTP or SSE transport. " +
        "Worker tools (flow.*) are accessible over the network and require authentication. " +
        "Set SILO_WORKER_TOKEN in your environment or use stdio transport for local-only access.",
    );
  }
}

// Resolve drizzle migrations folder. Works for both tsx (src/) and compiled (dist/src/) contexts.
const MIGRATIONS_FOLDER = (() => {
  const candidates = ["../../drizzle", "../../../drizzle"].map((rel) => new URL(rel, import.meta.url).pathname);
  const found = candidates.find((p) => {
    try {
      readdirSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error(`Cannot find drizzle migrations folder (tried: ${candidates.join(", ")})`);
  return found;
})();
const REAPER_INTERVAL_DEFAULT = "30000"; // 30s
const CLAIM_TTL_DEFAULT = "300000"; // 5min

function openDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, sqlite };
}

const program = new Command();
program.name("silo").version("0.1.0");

// ─── init ───
program
  .command("init")
  .option("--seed <path>", "Path to seed JSON file")
  .option("--force", "Drop existing data before loading")
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const seedPath = opts.seed;
    if (typeof seedPath !== "string") {
      console.log("Usage: silo init --seed <path> [--force]");
      return;
    }

    const { db, sqlite } = openDb(opts.db);
    const flowRepo = new DrizzleFlowRepository(db);
    const gateRepo = new DrizzleGateRepository(db);

    if (opts.force) {
      db.delete(gateResults).run();
      db.delete(entityHistory).run();
      db.delete(invocations).run();
      db.delete(entities).run();
      db.delete(transitionRules).run();
      db.delete(stateDefinitions).run();
      db.delete(flowVersions).run();
      db.delete(gateDefinitions).run();
      db.delete(flowDefinitions).run();
    }

    const seedRoot = process.env.SILO_SEED_ROOT;
    const result = await loadSeed(resolve(seedPath), flowRepo, gateRepo, {
      allowedRoot: seedRoot ?? process.cwd(),
      db,
    });
    console.log(`Loaded seed: flows: ${result.flows}, gates: ${result.gates}`);
    sqlite.close();
  });

// ─── export ───
program
  .command("export")
  .option("--out <path>", "Output file path (defaults to stdout)")
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const { db, sqlite } = openDb(opts.db);
    const flowRepo = new DrizzleFlowRepository(db);
    const gateRepo = new DrizzleGateRepository(db);
    const seed = await exportSeed(flowRepo, gateRepo);
    const json = JSON.stringify(seed, null, 2);

    if (opts.out) {
      writeFileSync(resolve(opts.out), json);
      console.log(`Exported to ${opts.out}`);
    } else {
      console.log(json);
    }
    sqlite.close();
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
  .option("--db <path>", "Database path", DB_DEFAULT)
  .option("--reaper-interval <ms>", "Reaper poll interval in milliseconds", REAPER_INTERVAL_DEFAULT)
  .option("--claim-ttl <ms>", "Claim TTL in milliseconds", CLAIM_TTL_DEFAULT)
  .option("--http-only", "Start HTTP REST server only (no MCP stdio)")
  .option("--mcp-only", "Start MCP stdio only (no HTTP REST server)")
  .option("--http-port <number>", "Port for HTTP REST API", "3000")
  .option("--http-host <address>", "Host for HTTP REST API", "127.0.0.1")
  .option("--ui", "Enable built-in web UI at /ui")
  .action(async (opts) => {
    // Litestream: restore from replica if DB missing and replication configured
    let litestreamMgr: LitestreamManager | undefined;
    if (isLitestreamEnabled()) {
      const lsConfig = buildConfigFromEnv(opts.db);
      litestreamMgr = new LitestreamManager(lsConfig);
      litestreamMgr.restore();
    }

    const { db, sqlite } = openDb(opts.db);

    // Litestream: start continuous replication
    if (litestreamMgr) {
      litestreamMgr.start();
    }
    const mutableEntityRepo = new DrizzleEntityRepository(db);
    const flowRepo = new DrizzleFlowRepository(db);
    const mutableInvocationRepo = new DrizzleInvocationRepository(db);
    const gateRepo = new DrizzleGateRepository(db);
    const transitionLogRepo = new DrizzleTransitionLogRepository(db);

    const domainEventRepo = new DrizzleDomainEventRepository(db);

    const useEventSourced = process.env.SILO_EVENT_SOURCED === "true";
    const snapshotInterval = parseInt(process.env.SILO_SNAPSHOT_INTERVAL ?? "10", 10);

    let entityRepo: IEntityRepository;
    let invocationRepo: IInvocationRepository;

    if (useEventSourced) {
      const snapshotRepo = new DrizzleEntitySnapshotRepository(db);
      entityRepo = new EventSourcedEntityRepository(mutableEntityRepo, domainEventRepo, snapshotRepo, snapshotInterval);
      invocationRepo = new EventSourcedInvocationRepository(mutableInvocationRepo, domainEventRepo);
      process.stderr.write("[silo] Event-sourced repositories enabled\n");
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
      withTransaction: (fn) => withTransaction(sqlite, fn),
      domainEvents: domainEventRepo,
    });

    const deps: McpServerDeps = {
      entities: entityRepo,
      flows: flowRepo,
      invocations: invocationRepo,
      gates: gateRepo,
      transitions: transitionLogRepo,
      eventRepo: new DrizzleEventRepository(db),
      domainEvents: domainEventRepo,
      engine,
      withTransaction: (fn) => withTransaction(sqlite, fn),
    };

    const reaperInterval = parseInt(opts.reaperInterval, 10);
    if (Number.isNaN(reaperInterval) || reaperInterval < 1000) {
      console.error("--reaper-interval must be a number >= 1000ms");
      sqlite.close();
      process.exit(1);
    }
    const claimTtl = parseInt(opts.claimTtl, 10);
    if (Number.isNaN(claimTtl) || claimTtl < 5000) {
      console.error("--claim-ttl must be a number >= 5000ms");
      sqlite.close();
      process.exit(1);
    }
    const stopReaper = engine.startReaper(reaperInterval, claimTtl);

    if (opts.httpOnly && opts.mcpOnly) {
      console.error("Cannot use --http-only and --mcp-only together");
      await stopReaper();
      sqlite.close();
      process.exit(1);
    }

    const adminToken = process.env.SILO_ADMIN_TOKEN || undefined;
    const workerToken = process.env.SILO_WORKER_TOKEN || undefined;

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
      sqlite.close();
      process.exit(1);
    }

    try {
      validateWorkerToken({ workerToken, startHttp, transport: opts.transport });
    } catch (err: unknown) {
      console.error((err as Error).message);
      await stopReaper();
      sqlite.close();
      process.exit(1);
    }

    let restHttpServer: import("node:http").Server | undefined;
    if (startHttp) {
      const httpPort = parseInt(opts.httpPort as string, 10);
      const httpHost = opts.httpHost as string;
      let restCorsResult: ReturnType<typeof resolveCorsOrigin>;
      try {
        restCorsResult = resolveCorsOrigin({ host: httpHost, corsEnv: process.env.SILO_CORS_ORIGIN });
      } catch (err: unknown) {
        console.error((err as Error).message);
        await stopReaper();
        sqlite.close();
        process.exit(1);
      }
      const uiSseAdapter = opts.ui ? new UiSseAdapter() : undefined;
      const honoResult = startHonoServer(
        {
          engine,
          mcpDeps: deps,
          adminToken,
          workerToken,
          corsOrigins: restCorsResult.origins ?? undefined,
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
      if (adminToken) {
        const wsBroadcaster = new WebSocketBroadcaster({
          server: restHttpServer,
          engine,
          adminToken,
        });
        eventEmitter.register(wsBroadcaster);
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
      let corsResult: ReturnType<typeof resolveCorsOrigin>;
      try {
        corsResult = resolveCorsOrigin({ host, corsEnv: process.env.SILO_CORS_ORIGIN });
      } catch (err: unknown) {
        console.error((err as Error).message);
        await stopReaper();
        sqlite.close();
        process.exit(1);
      }
      const allowedOriginSet: Set<string> | null = corsResult.origins ? new Set(corsResult.origins) : null;
      const loopbackPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

      const httpServer = http.createServer(async (req, res) => {
        // CORS: restrict to localhost origins when bound to loopback; require SILO_CORS_ORIGIN when bound to non-loopback
        const origin = req.headers.origin;
        if (origin) {
          const originAllowed = allowedOriginSet ? allowedOriginSet.has(origin) : loopbackPattern.test(origin);
          if (originAllowed) {
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Id");
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
          const mcpOpts: McpServerOpts = {
            adminToken,
            workerToken,
            callerToken,
          };
          const server = createMcpServer(deps, mcpOpts);
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
        closeables: [
          ...(litestreamMgr ? [litestreamMgr] : []),
          { close: () => restHttpServer?.close() },
          httpServer,
          sqlite,
        ],
      });
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } else if (startMcp) {
      // stdio (default)
      console.error("Starting MCP server on stdio...");
      const cleanup = makeShutdownHandler({
        stopReaper,
        closeables: [...(litestreamMgr ? [litestreamMgr] : []), sqlite],
      });
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
      const mcpOpts: McpServerOpts = { adminToken, workerToken, stdioTrusted: true };
      await startStdioServer(deps, mcpOpts);
    } else {
      // HTTP-only mode — keep process alive
      const cleanup = makeShutdownHandler({
        stopReaper,
        closeables: [...(litestreamMgr ? [litestreamMgr] : []), { close: () => restHttpServer?.close() }, sqlite],
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
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const { db, sqlite } = openDb(opts.db);
    const flowRepo = new DrizzleFlowRepository(db);
    const entityRepo = new DrizzleEntityRepository(db);
    const invocationRepo = new DrizzleInvocationRepository(db);

    const allFlows = await flowRepo.listAll();
    const targetFlows = opts.flow ? allFlows.filter((f) => f.name === opts.flow) : allFlows;

    if (targetFlows.length === 0 && opts.flow) {
      console.error(`Flow not found: ${opts.flow}`);
      sqlite.close();
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

    sqlite.close();
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

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const lower = header.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
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
