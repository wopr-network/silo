import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { Engine } from "../engine/engine.js";
import type { McpServerDeps } from "../execution/mcp-server.js";
import { callToolHandler } from "../execution/mcp-server.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { type ApiResponse, type ParsedRequest, Router } from "./router.js";

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const lower = header.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

export interface HttpServerDeps {
  engine: Engine;
  mcpDeps: McpServerDeps;
  adminToken?: string;
  workerToken?: string;
  corsOrigin?: string; // explicit CORS origin, or undefined for loopback default
  logger?: Logger;
}

function requireAdminToken(deps: HttpServerDeps, req: ParsedRequest): ApiResponse | null {
  const configuredToken = deps.adminToken?.trim() || undefined;
  if (!configuredToken) return null; // open mode
  const callerToken = extractBearerToken(req.authorization);
  if (!callerToken) {
    return { status: 401, body: { error: "Unauthorized: admin endpoints require authentication." } };
  }
  const hashA = createHash("sha256").update(configuredToken.trim()).digest();
  const hashB = createHash("sha256").update(callerToken.trim()).digest();
  if (!timingSafeEqual(hashA, hashB)) {
    return { status: 401, body: { error: "Unauthorized: admin endpoints require authentication." } };
  }
  return null;
}

function requireWorkerToken(deps: HttpServerDeps, req: ParsedRequest): ApiResponse | null {
  const configuredToken = deps.workerToken?.trim() || undefined; // treat "" and whitespace-only as unset
  if (!configuredToken) return null; // open mode
  const callerToken = extractBearerToken(req.authorization);
  if (!callerToken) {
    return { status: 401, body: { error: "Unauthorized: worker endpoints require authentication." } };
  }
  const hashA = createHash("sha256").update(configuredToken.trim()).digest();
  const hashB = createHash("sha256").update(callerToken.trim()).digest();
  if (!timingSafeEqual(hashA, hashB)) {
    return { status: 401, body: { error: "Unauthorized: worker endpoints require authentication." } };
  }
  return null;
}

const BODY_SIZE_LIMIT = 1024 * 1024; // 1MB

function readBody(req: http.IncomingMessage): Promise<{ body: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_SIZE_LIMIT) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), tooLarge }));
    req.on("error", (err) => {
      if (tooLarge) resolve({ body: "", tooLarge: true });
      else reject(err);
    });
  });
}

/** Unwrap MCP tool result into HTTP response */
function mcpResultToApi(result: { content: { type: string; text: string }[]; isError?: boolean }): ApiResponse {
  const text = result.content[0]?.text ?? "";
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text };
  }

  if (result.isError) {
    const msg =
      typeof body === "object" && body !== null && "message" in body ? (body as Record<string, unknown>).message : text;
    const msgStr = String(msg);
    if (msgStr.includes("not found") || msgStr.includes("Not found")) return { status: 404, body: { error: msgStr } };
    if (msgStr.includes("Unauthorized")) return { status: 401, body: { error: msgStr } };
    if (msgStr.includes("Validation error")) return { status: 400, body: { error: msgStr } };
    if (msgStr.includes("No active invocation")) return { status: 409, body: { error: msgStr } };
    return { status: 500, body: { error: msgStr } };
  }

  if (body === null) return { status: 204, body: null };
  return { status: 200, body };
}

export function createHttpServer(deps: HttpServerDeps): http.Server {
  const router = new Router();

  // Ensure engine is set on mcpDeps
  deps.mcpDeps.engine = deps.engine;
  if (deps.logger) deps.mcpDeps.logger = deps.logger;

  // --- Status ---
  router.add("GET", "/api/status", async () => {
    const status = await deps.engine.getStatus();
    return { status: 200, body: status };
  });

  // --- Flow claim (cross-flow: no flow filter) ---
  router.add("POST", "/api/claim", async (req) => {
    const authErr = requireWorkerToken(deps, req);
    if (authErr) return authErr;
    const args = { role: req.body?.role as string };
    const result = await callToolHandler(deps.mcpDeps, "flow.claim", args);
    return mcpResultToApi(result);
  });

  // --- Flow claim ---
  router.add("POST", "/api/flows/:flow/claim", async (req) => {
    const authErr = requireWorkerToken(deps, req);
    if (authErr) return authErr;
    const args = { role: req.body?.role as string, flow: req.params.flow };
    const result = await callToolHandler(deps.mcpDeps, "flow.claim", args);
    return mcpResultToApi(result);
  });

  // --- Entity report ---
  // longRunning: true — flow.report blocks for the duration of gate evaluation
  // (potentially many minutes). The server handler calls req.setTimeout(0) for
  // this route specifically so only this connection bypasses the global 30s timeout.
  router.add(
    "POST",
    "/api/entities/:id/report",
    async (req) => {
      const authErr = requireWorkerToken(deps, req);
      if (authErr) return authErr;
      const args: Record<string, unknown> = {
        entity_id: req.params.id,
        signal: req.body?.signal as string,
      };
      if (req.body?.worker_id) args.worker_id = req.body.worker_id as string;
      if (req.body?.artifacts) args.artifacts = req.body.artifacts;
      const result = await callToolHandler(deps.mcpDeps, "flow.report", args);
      return mcpResultToApi(result);
    },
    { longRunning: true },
  );

  // --- Entity fail ---
  router.add("POST", "/api/entities/:id/fail", async (req) => {
    const authErr = requireWorkerToken(deps, req);
    if (authErr) return authErr;
    const args = { entity_id: req.params.id, error: req.body?.error as string };
    const result = await callToolHandler(deps.mcpDeps, "flow.fail", args);
    return mcpResultToApi(result);
  });

  // --- Entity CRUD ---
  router.add("POST", "/api/entities", async (req) => {
    const flowName = req.body?.flow as string;
    const refs = req.body?.refs as Record<string, { adapter: string; id: string }> | undefined;
    const payload = req.body?.payload as Record<string, unknown> | undefined;
    if (!flowName) return { status: 400, body: { error: "Missing required field: flow" } };
    try {
      const entity = await deps.engine.createEntity(flowName, refs, payload);
      return { status: 201, body: entity };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return { status: 404, body: { error: msg } };
      return { status: 500, body: { error: msg } };
    }
  });

  router.add("GET", "/api/entities/:id", async (req) => {
    const result = await callToolHandler(deps.mcpDeps, "query.entity", { id: req.params.id });
    return mcpResultToApi(result);
  });

  router.add("GET", "/api/entities", async (req) => {
    const flow = req.query.get("flow");
    const state = req.query.get("state");
    if (!flow || !state) return { status: 400, body: { error: "Required query params: flow, state" } };
    const limitStr = req.query.get("limit");
    const args: Record<string, unknown> = { flow, state };
    if (limitStr) {
      const limit = parseInt(limitStr, 10);
      if (!Number.isNaN(limit) && limit > 0) args.limit = limit;
    }
    const result = await callToolHandler(deps.mcpDeps, "query.entities", args);
    return mcpResultToApi(result);
  });

  // --- Flow definition CRUD ---
  router.add("GET", "/api/flows", async () => {
    const flows = await deps.mcpDeps.flows.listAll();
    return { status: 200, body: flows };
  });

  router.add("GET", "/api/flows/:id", async (req) => {
    const result = await callToolHandler(deps.mcpDeps, "query.flow", { name: req.params.id });
    return mcpResultToApi(result);
  });

  router.add("PUT", "/api/flows/:id", async (req) => {
    const existing = await deps.mcpDeps.flows.getByName(req.params.id as string);
    // Only pick known fields from body — never spread req.body to prevent param injection
    const definition = req.body?.definition;
    const description = req.body?.description as string | undefined;
    const callerToken = extractBearerToken(req.authorization);
    if (existing) {
      const result = await callToolHandler(
        deps.mcpDeps,
        "admin.flow.update",
        { flow_name: req.params.id, definition, description },
        { adminToken: deps.adminToken, callerToken },
      );
      return mcpResultToApi(result);
    } else {
      const result = await callToolHandler(
        deps.mcpDeps,
        "admin.flow.create",
        { name: req.params.id, definition, description },
        { adminToken: deps.adminToken, callerToken },
      );
      return mcpResultToApi(result);
    }
  });

  router.add("DELETE", "/api/flows/:id", async () => {
    return { status: 501, body: { error: "Flow deletion not implemented" } };
  });

  // --- Admin: Pause/Resume Flow ---
  router.add("POST", "/api/admin/flows/:flow/pause", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.flow.pause",
      { flow_name: req.params.flow },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  router.add("POST", "/api/admin/flows/:flow/resume", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.flow.resume",
      { flow_name: req.params.flow },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  // --- Admin: Cancel Entity ---
  router.add("POST", "/api/admin/entities/:id/cancel", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.entity.cancel",
      { entity_id: req.params.id },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  // --- Admin: Reset Entity ---
  router.add("POST", "/api/admin/entities/:id/reset", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.entity.reset",
      { entity_id: req.params.id, target_state: req.body?.target_state as string },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  // --- Admin: Drain/Undrain Worker ---
  router.add("POST", "/api/admin/workers/:workerId/drain", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.worker.drain",
      { worker_id: req.params.workerId },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  router.add("POST", "/api/admin/workers/:workerId/undrain", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.worker.undrain",
      { worker_id: req.params.workerId },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  // --- Admin: Rerun Gate ---
  router.add("POST", "/api/admin/entities/:id/gates/:gateName/rerun", async (req) => {
    const authErr = requireAdminToken(deps, req);
    if (authErr) return authErr;
    const callerToken = extractBearerToken(req.authorization);
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.gate.rerun",
      { entity_id: req.params.id, gate_name: req.params.gateName },
      { adminToken: deps.adminToken, callerToken },
    );
    return mcpResultToApi(result);
  });

  // --- HTTP server ---
  const server = http.createServer(async (req, res) => {
    // CORS
    const origin = req.headers.origin;
    if (origin) {
      const isLoopbackOrigin =
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        /^https?:\/\/\[::1\](:\d+)?$/.test(origin);
      const corsAllowed = deps.corsOrigin
        ? origin === deps.corsOrigin // explicit origin: exact match only
        : isLoopbackOrigin; // loopback mode: only reflect loopback origins
      if (corsAllowed) {
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      }
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost`);
    const match = router.match(req.method ?? "GET", url.pathname);

    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // flow.report blocks until gate evaluation completes (potentially many
    // minutes). Extend timeout per-request for this route only; all other
    // routes keep the global 30s limit.
    if (match.longRunning) {
      req.setTimeout(0);
    }

    let body: Record<string, unknown> | null = null;
    if (req.method === "POST" || req.method === "PUT") {
      try {
        const { body: raw, tooLarge } = await readBody(req);
        if (tooLarge) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body too large" }));
          return;
        }
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
    }

    const parsed: ParsedRequest = {
      params: match.params,
      query: url.searchParams,
      body,
      authorization: req.headers.authorization,
    };

    try {
      const apiRes = await match.handler(parsed);
      if (apiRes.status === 204) {
        res.writeHead(204).end();
      } else {
        res.writeHead(apiRes.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(apiRes.body));
      }
    } catch (err) {
      (deps.logger ?? consoleLogger).error("Request error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  // Sensible defaults protect all routes from Slowloris/slow-header DoS.
  // The entity report route calls req.setTimeout(0) per-request to bypass this
  // limit only for connections that need long-running gate evaluation.
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;

  return server;
}
