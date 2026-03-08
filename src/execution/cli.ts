#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { Command } from "commander";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHttpServer } from "../api/server.js";
import { exportSeed } from "../config/exporter.js";
import { loadSeed } from "../config/seed-loader.js";
import { resolveCorsOrigin } from "../cors.js";
import { Engine } from "../engine/engine.js";
import { EventEmitter } from "../engine/event-emitter.js";
import { DrizzleEntityRepository } from "../repositories/drizzle/entity.repo.js";
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
import type { McpServerDeps, McpServerOpts } from "./mcp-server.js";
import { createMcpServer, startStdioServer } from "./mcp-server.js";
import { provisionWorktree } from "./provision-worktree.js";

const DB_DEFAULT = process.env.AGENTIC_DB_PATH ?? "./agentic-flow.db";

/**
 * Validates that DEFCON_ADMIN_TOKEN is set when network transports are active.
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
      "DEFCON_ADMIN_TOKEN must be set when using HTTP or SSE transport. " +
        "Admin tools are accessible over the network and require authentication. " +
        "Set DEFCON_ADMIN_TOKEN in your environment or use stdio transport for local-only access.",
    );
  }
}

/**
 * Validates that DEFCON_WORKER_TOKEN is set when network transports are active.
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
      "DEFCON_WORKER_TOKEN must be set when using HTTP or SSE transport. " +
        "Worker tools (flow.*) are accessible over the network and require authentication. " +
        "Set DEFCON_WORKER_TOKEN in your environment or use stdio transport for local-only access.",
    );
  }
}

const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;
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
program.name("defcon").version("0.1.0");

// ─── init ───
program
  .command("init")
  .option("--seed <path>", "Path to seed JSON file")
  .option("--force", "Drop existing data before loading")
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const seedPath = opts.seed;
    if (typeof seedPath !== "string") {
      console.log("Usage: defcon init --seed <path> [--force]");
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

    const seedRoot = process.env.DEFCON_SEED_ROOT;
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
  .action(async (opts) => {
    const { db, sqlite } = openDb(opts.db);
    const entityRepo = new DrizzleEntityRepository(db);
    const flowRepo = new DrizzleFlowRepository(db);
    const invocationRepo = new DrizzleInvocationRepository(db);
    const gateRepo = new DrizzleGateRepository(db);
    const transitionLogRepo = new DrizzleTransitionLogRepository(db);

    const eventEmitter = new EventEmitter();
    eventEmitter.register({
      emit: async (event) => {
        process.stderr.write(`[event] ${event.type} ${JSON.stringify(event)}\n`);
      },
    });

    const engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo,
      adapters: new Map(),
      eventEmitter,
    });

    const deps: McpServerDeps = {
      entities: entityRepo,
      flows: flowRepo,
      invocations: invocationRepo,
      gates: gateRepo,
      transitions: transitionLogRepo,
      eventRepo: new DrizzleEventRepository(db),
      engine,
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

    const adminToken = process.env.DEFCON_ADMIN_TOKEN || undefined;
    const workerToken = process.env.DEFCON_WORKER_TOKEN || undefined;

    const startHttp = !opts.mcpOnly;
    const startMcp = !opts.httpOnly;

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

    let restHttpServer: ReturnType<typeof createHttpServer> | undefined;
    if (startHttp) {
      const httpPort = parseInt(opts.httpPort as string, 10);
      const httpHost = opts.httpHost as string;
      let restCorsResult: ReturnType<typeof resolveCorsOrigin>;
      try {
        restCorsResult = resolveCorsOrigin({ host: httpHost, corsEnv: process.env.DEFCON_CORS_ORIGIN });
      } catch (err: unknown) {
        console.error((err as Error).message);
        await stopReaper();
        sqlite.close();
        process.exit(1);
      }
      restHttpServer = createHttpServer({
        engine,
        mcpDeps: deps,
        adminToken,
        workerToken,
        corsOrigin: restCorsResult.origin ?? undefined,
      });
      restHttpServer.listen(httpPort, httpHost, () => {
        const addr = restHttpServer?.address();
        const boundPort = addr && typeof addr === "object" ? addr.port : httpPort;
        console.error(`HTTP REST API listening on ${httpHost}:${boundPort}`);
      });
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
        corsResult = resolveCorsOrigin({ host, corsEnv: process.env.DEFCON_CORS_ORIGIN });
      } catch (err: unknown) {
        console.error((err as Error).message);
        await stopReaper();
        sqlite.close();
        process.exit(1);
      }
      const allowedOriginPattern: RegExp | string | null = corsResult.origin
        ? corsResult.origin // exact string match
        : /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/; // loopback default

      const httpServer = http.createServer(async (req, res) => {
        // CORS: restrict to localhost origins when bound to loopback; require DEFCON_CORS_ORIGIN when bound to non-loopback
        const origin = req.headers.origin;
        if (origin) {
          const originAllowed =
            typeof allowedOriginPattern === "string"
              ? origin === allowedOriginPattern
              : allowedOriginPattern.test(origin);
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
        closeables: [{ close: () => restHttpServer?.close() }, httpServer, sqlite],
      });
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } else if (startMcp) {
      // stdio (default)
      console.error("Starting MCP server on stdio...");
      const cleanup = makeShutdownHandler({ stopReaper, closeables: [sqlite] });
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
      const mcpOpts: McpServerOpts = { adminToken, workerToken, stdioTrusted: true };
      await startStdioServer(deps, mcpOpts);
    } else {
      // HTTP-only mode — keep process alive
      const cleanup = makeShutdownHandler({
        stopReaper,
        closeables: [{ close: () => restHttpServer?.close() }, sqlite],
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

// ─── provision-worktree ───
program
  .command("provision-worktree")
  .description("Provision a git worktree and branch for an issue")
  .argument("<repo>", "GitHub repo (e.g. wopr-network/defcon)")
  .argument("<issue-key>", "Issue key (e.g. WOP-392)")
  .option("--base-path <path>", "Worktree base directory", join(homedir(), "worktrees"))
  .option("--clone-root <path>", "Directory where repos are cloned", homedir())
  .action((repo: string, issueKey: string, opts: { basePath: string; cloneRoot: string }) => {
    try {
      const result = provisionWorktree({
        repo,
        issueKey,
        basePath: opts.basePath,
        cloneRoot: opts.cloneRoot,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
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
