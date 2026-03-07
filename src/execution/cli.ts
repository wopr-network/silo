#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { Command } from "commander";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createHttpServer } from "../api/server.js";
import { exportSeed } from "../config/exporter.js";
import { loadSeed } from "../config/seed-loader.js";
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

const DB_DEFAULT = process.env.AGENTIC_DB_PATH ?? "./agentic-flow.db";
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
    const result = await loadSeed(
      resolve(seedPath),
      flowRepo,
      gateRepo,
      sqlite,
      seedRoot ? { allowedRoot: seedRoot } : undefined,
    );
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
      sqlite.close();
      process.exit(1);
    }

    const adminToken = process.env.DEFCON_ADMIN_TOKEN || undefined;

    const startHttp = !opts.mcpOnly;
    const startMcp = !opts.httpOnly;

    let restHttpServer: ReturnType<typeof createHttpServer> | undefined;
    if (startHttp) {
      const httpPort = parseInt(opts.httpPort as string, 10);
      const httpHost = opts.httpHost as string;
      restHttpServer = createHttpServer({ engine, mcpDeps: deps, adminToken });
      restHttpServer.listen(httpPort, httpHost, () => {
        const addr = restHttpServer?.address();
        const boundPort = addr && typeof addr === "object" ? addr.port : httpPort;
        console.error(`HTTP REST API listening on ${httpHost}:${boundPort}`);
      });
      if (!adminToken) {
        console.warn("WARNING: DEFCON_ADMIN_TOKEN not set — admin routes are unauthenticated");
      }
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
      const isLoopback = host === "127.0.0.1" || host === "localhost";
      let allowedOriginPattern: RegExp | null = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
      if (!isLoopback) {
        console.warn(`WARNING: --host ${host} is not a loopback address — allowing all CORS origins`);
        allowedOriginPattern = null;
      }

      const httpServer = http.createServer(async (req, res) => {
        // CORS: restrict to localhost origins when bound to loopback; allow all when bound to non-loopback
        const origin = req.headers.origin;
        if (origin) {
          if (allowedOriginPattern === null || allowedOriginPattern.test(origin)) {
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
      if (!adminToken) {
        console.warn("WARNING: DEFCON_ADMIN_TOKEN not set — admin tools are unauthenticated");
      }

      const shutdown = () => {
        restHttpServer?.close();
        stopReaper().then(() => {
          httpServer.close();
          sqlite.close();
          process.exit(0);
        });
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else if (startMcp) {
      // stdio (default)
      console.error("Starting MCP server on stdio...");
      const cleanup = () => {
        stopReaper().then(() => {
          sqlite.close();
          process.exit(0);
        });
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      const mcpOpts: McpServerOpts = { adminToken, stdioTrusted: true };
      await startStdioServer(deps, mcpOpts);
    } else {
      // HTTP-only mode — keep process alive
      const cleanup = () => {
        restHttpServer?.close();
        stopReaper().then(() => {
          sqlite.close();
          process.exit(0);
        });
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
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

function extractBearerToken(header: string | undefined): string | undefined {
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
