#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { Command } from "commander";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { AnthropicAdapter } from "../adapters/anthropic.js";
import { CompositeEventBusAdapter } from "../adapters/composite.js";
import { LinearAdapter } from "../adapters/linear.js";
import { StdoutAdapter } from "../adapters/stdout.js";
import { exportSeed } from "../config/exporter.js";
import { resolveConfigSecrets } from "../config/resolve-secrets.js";
import { loadSeed } from "../config/seed-loader.js";
import { Engine } from "../engine/engine.js";
import { DrizzleEntityRepository } from "../repositories/drizzle/entity.repo.js";
import { DrizzleEventRepository } from "../repositories/drizzle/event.repo.js";
import { DrizzleFlowRepository } from "../repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../repositories/drizzle/gate.repo.js";
import { DrizzleIntegrationRepository } from "../repositories/drizzle/integration.repo.js";
import { DrizzleIntegrationConfigRepository } from "../repositories/drizzle/integration-config.repo.js";
import { DrizzleInvocationRepository } from "../repositories/drizzle/invocation.repo.js";
import * as schema from "../repositories/drizzle/schema.js";
import {
  entities,
  entityHistory,
  flowDefinitions,
  flowVersions,
  gateDefinitions,
  gateResults,
  integrationConfig,
  invocations,
  stateDefinitions,
  transitionRules,
} from "../repositories/drizzle/schema.js";
import { DrizzleTransitionLogRepository } from "../repositories/drizzle/transition-log.repo.js";
import { ActiveRunner } from "./active-runner.js";
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
      db.delete(integrationConfig).run();
      db.delete(flowVersions).run();
      db.delete(gateDefinitions).run();
      db.delete(flowDefinitions).run();
    }

    const integrationRepo = new DrizzleIntegrationConfigRepository(db);
    const result = await loadSeed(resolve(seedPath), flowRepo, gateRepo, integrationRepo, sqlite);
    console.log(`Loaded seed: flows: ${result.flows}, gates: ${result.gates}, integrations: ${result.integrations}`);
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
    const integrationRepo = new DrizzleIntegrationConfigRepository(db);
    const seed = await exportSeed(flowRepo, gateRepo, integrationRepo);
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
  .option("--port <number>", "Port for SSE transport", "3000")
  .option(
    "--host <address>",
    "Host address to bind to (default: 127.0.0.1, use 0.0.0.0 for network access)",
    "127.0.0.1",
  )
  .option("--db <path>", "Database path", DB_DEFAULT)
  .option("--reaper-interval <ms>", "Reaper poll interval in milliseconds", REAPER_INTERVAL_DEFAULT)
  .option("--claim-ttl <ms>", "Claim TTL in milliseconds", CLAIM_TTL_DEFAULT)
  .action(async (opts) => {
    const { db, sqlite } = openDb(opts.db);
    const entityRepo = new DrizzleEntityRepository(db);
    const flowRepo = new DrizzleFlowRepository(db);
    const invocationRepo = new DrizzleInvocationRepository(db);
    const gateRepo = new DrizzleGateRepository(db);
    const transitionLogRepo = new DrizzleTransitionLogRepository(db);

    // Suppress stdout events in stdio mode — stdout carries the JSON-RPC stream
    // and any extra output corrupts it.
    const eventEmitter =
      opts.transport === "stdio"
        ? new CompositeEventBusAdapter([])
        : new CompositeEventBusAdapter([new StdoutAdapter()]);

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
      integrationRepo: new DrizzleIntegrationRepository(db),
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

    const adminToken = process.env.DEFCON_ADMIN_TOKEN || undefined;

    if (opts.transport === "sse") {
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
        stopReaper().then(() => {
          httpServer.close();
          sqlite.close();
          process.exit(0);
        });
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
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
    }
  });

// ─── run ───
program
  .command("run")
  .description("Start active runner")
  .option("--flow <name>", "Flow name to filter")
  .option("--once", "Process one item and exit")
  .option("--poll-interval <ms>", "Poll interval in milliseconds", "5000")
  .option("--db <path>", "Database path", DB_DEFAULT)
  .option("--reaper-interval <ms>", "Reaper poll interval in milliseconds", REAPER_INTERVAL_DEFAULT)
  .option("--claim-ttl <ms>", "Claim TTL in milliseconds", CLAIM_TTL_DEFAULT)
  .action(async (opts) => {
    const pollInterval = parseInt(opts.pollInterval, 10);
    if (Number.isNaN(pollInterval) || pollInterval < 100) {
      console.error(`Invalid --poll-interval: must be a number >= 100ms`);
      process.exit(1);
    }
    const reaperInterval = parseInt(opts.reaperInterval, 10);
    if (Number.isNaN(reaperInterval) || reaperInterval < 1000) {
      console.error("--reaper-interval must be a number >= 1000ms");
      process.exit(1);
    }
    const claimTtl = parseInt(opts.claimTtl, 10);
    if (Number.isNaN(claimTtl) || claimTtl < 5000) {
      console.error("--claim-ttl must be a number >= 5000ms");
      process.exit(1);
    }

    const { db, sqlite } = openDb(opts.db);
    const flowRepo = new DrizzleFlowRepository(db);
    const entityRepo = new DrizzleEntityRepository(db);
    const invocationRepo = new DrizzleInvocationRepository(db);
    const gateRepo = new DrizzleGateRepository(db);
    const transitionLogRepo = new DrizzleTransitionLogRepository(db);
    const integrationConfigRepo = new DrizzleIntegrationConfigRepository(db);

    const eventEmitter = new CompositeEventBusAdapter([new StdoutAdapter()]);

    // Resolve AI adapter from integration config or env
    const configs = await integrationConfigRepo.listAll();
    const aiConfig = configs.find((c) => c.capability === "ai-provider");
    let resolvedAiConfig: Record<string, unknown> | null;
    try {
      resolvedAiConfig = resolveConfigSecrets((aiConfig?.config as Record<string, unknown>) ?? null);
    } catch (err) {
      sqlite.close();
      console.error("Failed to resolve config secrets:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    const apiKey = (resolvedAiConfig as { apiKey?: string } | null)?.apiKey ?? process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error("No Anthropic API key found. Set ANTHROPIC_API_KEY or configure via integration_config.");
      sqlite.close();
      process.exit(1);
    }

    const aiAdapter = new AnthropicAdapter({ apiKey });

    const engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo,
      adapters: new Map(),
      eventEmitter,
    });

    const stopReaper = engine.startReaper(reaperInterval, claimTtl);

    const runner = new ActiveRunner({
      engine,
      aiAdapter,
      invocationRepo,
      entityRepo,
      flowRepo,
    });

    const ac = new AbortController();
    let closed = false;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      ac.abort();
      await stopReaper();
      sqlite.close();
      process.exit(0);
    };
    process.on("SIGINT", () => {
      cleanup().catch(() => process.exit(1));
    });
    process.on("SIGTERM", () => {
      cleanup().catch(() => process.exit(1));
    });

    console.log(`Active runner started${opts.flow ? ` (flow: ${opts.flow})` : ""}, poll interval: ${pollInterval}ms`);

    await runner.run({
      flowName: opts.flow,
      once: opts.once ?? false,
      pollIntervalMs: pollInterval,
      signal: ac.signal,
    });

    if (!closed) {
      closed = true;
      await stopReaper();
      sqlite.close();
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

// ─── ingest ───
program
  .command("ingest")
  .description("Create entities from external source")
  .requiredOption("--from <source>", "Source adapter (e.g. linear)")
  .requiredOption("--flow <name>", "Target flow name")
  .option("--filter <query>", "Filter query (JSON)")
  .option("--dry-run", "Show what would be ingested without creating entities")
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const { db, sqlite } = openDb(opts.db);
    const flowRepo = new DrizzleFlowRepository(db);
    const entityRepo = new DrizzleEntityRepository(db);
    const invocationRepo = new DrizzleInvocationRepository(db);
    const gateRepo = new DrizzleGateRepository(db);
    const integrationConfigRepo = new DrizzleIntegrationConfigRepository(db);
    const transitionLogRepo = new DrizzleTransitionLogRepository(db);

    // Verify flow exists
    const flow = await flowRepo.getByName(opts.flow);
    if (!flow) {
      console.error(`Flow not found: ${opts.flow}`);
      sqlite.close();
      process.exit(1);
    }

    if (opts.from !== "linear") {
      console.error(`Unsupported source: ${opts.from}. Supported: linear`);
      sqlite.close();
      process.exit(1);
    }

    // Get Linear config
    const configs = await integrationConfigRepo.listAll();
    const linearConfig = configs.find((c) => c.adapter === "linear");
    let resolvedLinearConfig: Record<string, unknown> | null;
    try {
      resolvedLinearConfig = resolveConfigSecrets((linearConfig?.config as Record<string, unknown>) ?? null);
    } catch (err) {
      sqlite.close();
      console.error("Failed to resolve config secrets:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    const apiKey = (resolvedLinearConfig as { apiKey?: string } | null)?.apiKey ?? process.env.LINEAR_API_KEY;

    if (!apiKey) {
      console.error("No Linear API key found. Set LINEAR_API_KEY or configure via integration_config.");
      sqlite.close();
      process.exit(1);
    }

    const teamId = (resolvedLinearConfig as { teamId?: string } | null)?.teamId;
    const adapter = new LinearAdapter({ apiKey, teamId });

    // Parse filter
    let filter: Record<string, unknown> = {};
    if (opts.filter) {
      try {
        filter = JSON.parse(opts.filter);
      } catch {
        console.error("Invalid --filter JSON");
        sqlite.close();
        process.exit(1);
      }
    }

    const issues = await adapter.list(filter);
    console.log(`Found ${issues.length} issues from Linear`);

    if (opts.dryRun) {
      for (const issue of issues) {
        const key = issue.key ?? issue.id;
        console.log(`  [dry-run] Would create entity: ${key} — ${issue.title}`);
      }
      sqlite.close();
      return;
    }

    const eventEmitter = new CompositeEventBusAdapter([new StdoutAdapter()]);

    const engine = new Engine({
      entityRepo,
      flowRepo,
      invocationRepo,
      gateRepo,
      transitionLogRepo,
      adapters: new Map(),
      eventEmitter,
    });

    let created = 0;
    for (const issue of issues) {
      const key = issue.key ?? issue.id;
      const refs: Record<string, { adapter: string; id: string; [key: string]: unknown }> = {
        issue: {
          adapter: "linear",
          id: String(issue.id),
          key: String(key),
          title: String(issue.title),
          url: String(issue.url ?? ""),
        },
      };
      await engine.createEntity(opts.flow, refs);
      created++;
      console.log(`  Created entity for ${key}: ${issue.title}`);
    }

    console.log(`Ingested ${created} entities into flow "${opts.flow}"`);
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
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
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
