import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { Engine } from "../engine/engine.js";
import type { McpServerDeps } from "../execution/mcp-server.js";
import { callToolHandler } from "../execution/mcp-server.js";
import { type ApiResponse, type ParsedRequest, Router } from "./router.js";

export interface HttpServerDeps {
  engine: Engine;
  mcpDeps: McpServerDeps;
  adminToken?: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const lower = header.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a.trim()).digest();
  const hashB = createHash("sha256").update(b.trim()).digest();
  return timingSafeEqual(hashA, hashB);
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

  // --- Status ---
  router.add("GET", "/api/status", async () => {
    const status = await deps.engine.getStatus();
    return { status: 200, body: status };
  });

  // --- Flow claim ---
  router.add("POST", "/api/flows/:flow/claim", async (req) => {
    const args = { role: req.body?.role as string, flow: req.params.flow };
    const result = await callToolHandler(deps.mcpDeps, "flow.claim", args);
    const apiRes = mcpResultToApi(result);
    // null result (no work) → 204
    if (apiRes.status === 200 && apiRes.body === null) return { status: 204, body: null };
    return apiRes;
  });

  // --- Entity report ---
  router.add("POST", "/api/entities/:id/report", async (req) => {
    const args: Record<string, unknown> = {
      entity_id: req.params.id,
      signal: req.body?.signal as string,
    };
    if (req.body?.artifacts) args.artifacts = req.body.artifacts;
    const result = await callToolHandler(deps.mcpDeps, "flow.report", args);
    return mcpResultToApi(result);
  });

  // --- Entity fail ---
  router.add("POST", "/api/entities/:id/fail", async (req) => {
    const args = { entity_id: req.params.id, error: req.body?.error as string };
    const result = await callToolHandler(deps.mcpDeps, "flow.fail", args);
    return mcpResultToApi(result);
  });

  // --- Entity CRUD ---
  router.add("POST", "/api/entities", async (req) => {
    const flowName = req.body?.flow as string;
    const refs = req.body?.refs as Record<string, { adapter: string; id: string }> | undefined;
    if (!flowName) return { status: 400, body: { error: "Missing required field: flow" } };
    try {
      const entity = await deps.engine.createEntity(flowName, refs);
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
    if (limitStr) args.limit = parseInt(limitStr, 10);
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
    const callerToken = req.body?._token as string | undefined;
    const existing = await deps.mcpDeps.flows.getByName(req.params.id as string);
    if (existing) {
      const result = await callToolHandler(
        deps.mcpDeps,
        "admin.flow.update",
        { flow_name: req.params.id, ...req.body },
        { adminToken: deps.adminToken, callerToken },
      );
      return mcpResultToApi(result);
    } else {
      const result = await callToolHandler(
        deps.mcpDeps,
        "admin.flow.create",
        { name: req.params.id, ...req.body },
        { adminToken: deps.adminToken, callerToken },
      );
      return mcpResultToApi(result);
    }
  });

  router.add("DELETE", "/api/flows/:id", async () => {
    return { status: 501, body: { error: "Flow deletion not implemented" } };
  });

  // --- HTTP server ---
  const server = http.createServer(async (req, res) => {
    // CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

    const callerToken = extractBearerToken(req.headers.authorization);
    // Suppress unused variable warning
    void callerToken;
    void constantTimeEqual;

    let body: Record<string, unknown> | null = null;
    if (req.method === "POST" || req.method === "PUT") {
      try {
        const raw = await readBody(req);
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
      console.error("Request error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  return server;
}
