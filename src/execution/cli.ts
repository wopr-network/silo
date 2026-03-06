#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { Command } from "commander";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { AnthropicAdapter } from "../adapters/anthropic.js";
import { CompositeEventBusAdapter } from "../adapters/composite.js";
import { LinearAdapter } from "../adapters/linear.js";
import { StdoutAdapter } from "../adapters/stdout.js";
import { exportSeed } from "../config/exporter.js";
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
import type { McpServerDeps } from "./mcp-server.js";
import { createMcpServer, startStdioServer } from "./mcp-server.js";

const DB_DEFAULT = process.env.AGENTIC_DB_PATH ?? "./agentic-flow.db";
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

function openDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, sqlite };
}

const program = new Command();
program.name("agentic").version("0.1.0");

// ─── init ───
program
  .command("init")
  .option("--seed <path>", "Path to seed JSON file")
  .option("--force", "Drop existing data before loading")
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const seedPath = opts.seed;
    if (typeof seedPath !== "string") {
      console.log("Usage: agentic init --seed <path> [--force]");
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
  .option("--db <path>", "Database path", DB_DEFAULT)
  .action(async (opts) => {
    const { db, sqlite } = openDb(opts.db);
    const deps: McpServerDeps = {
      entities: new DrizzleEntityRepository(db),
      flows: new DrizzleFlowRepository(db),
      invocations: new DrizzleInvocationRepository(db),
      gates: new DrizzleGateRepository(db),
      transitions: new DrizzleTransitionLogRepository(db),
      eventRepo: new DrizzleEventRepository(db),
      integrationRepo: new DrizzleIntegrationRepository(db),
    };

    if (opts.transport === "sse") {
      const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
      const http = await import("node:http");
      const port = parseInt(opts.port, 10);

      // Map session IDs to transports for POST routing
      const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();

      const httpServer = http.createServer(async (req, res) => {
        if (req.url === "/sse" && req.method === "GET") {
          const transport = new SSEServerTransport("/messages", res);
          transports.set(transport.sessionId, transport);
          res.on("close", () => transports.delete(transport.sessionId));
          const server = createMcpServer(deps);
          await server.connect(transport);
        } else if (req.url?.startsWith("/messages") && req.method === "POST") {
          const url = new URL(req.url, `http://localhost:${port}`);
          const sessionId = url.searchParams.get("sessionId") ?? "";
          const transport = transports.get(sessionId);
          if (transport) {
            await transport.handlePostMessage(req, res);
          } else {
            res.writeHead(404).end("Session not found");
          }
        } else {
          res.writeHead(404).end();
        }
      });

      httpServer.listen(port, () => {
        console.log(`MCP SSE server listening on port ${port}`);
      });

      const shutdown = () => {
        httpServer.close();
        sqlite.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
      // stdio (default)
      console.error("Starting MCP server on stdio...");
      const cleanup = () => {
        sqlite.close();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      await startStdioServer(deps);
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
  .action(async (opts) => {
    const pollInterval = parseInt(opts.pollInterval, 10);
    if (Number.isNaN(pollInterval) || pollInterval < 100) {
      console.error(`Invalid --poll-interval: must be a number >= 100ms`);
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
    const apiKey = (aiConfig?.config as { apiKey?: string } | null)?.apiKey ?? process.env.ANTHROPIC_API_KEY;

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
      // Give in-flight operations a moment to complete
      await new Promise((resolve) => setTimeout(resolve, 200));
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
    const apiKey = (linearConfig?.config as { apiKey?: string } | null)?.apiKey ?? process.env.LINEAR_API_KEY;

    if (!apiKey) {
      console.error("No Linear API key found. Set LINEAR_API_KEY or configure via integration_config.");
      sqlite.close();
      process.exit(1);
    }

    const teamId = (linearConfig?.config as { teamId?: string } | null)?.teamId;
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
