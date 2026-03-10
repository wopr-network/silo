/**
 * Hono-based HTTP API server for silo.
 *
 * Replaces the old node:http + custom Router server.
 * Serves norad (dashboard), workers (claim/report), and admin tooling.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { Engine } from "../engine/engine.js";
import type { EngineEvent, IEventBusAdapter } from "../engine/event-types.js";
import type { McpServerDeps } from "../execution/mcp-helpers.js";
import { callToolHandler } from "../execution/mcp-server.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { UI_HTML } from "../ui/index.html.js";

// ─── Auth helpers ───

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const lower = header.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

function tokensMatch(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a.trim()).digest();
  const hashB = createHash("sha256").update(b.trim()).digest();
  return timingSafeEqual(hashA, hashB);
}

// ─── SSE adapter for Hono streaming ───

export class HonoSseAdapter implements IEventBusAdapter {
  private controllers = new Set<ReadableStreamDefaultController<string>>();
  private listeners = new Set<(event: EngineEvent) => Promise<void>>();

  addController(ctrl: ReadableStreamDefaultController<string>): void {
    this.controllers.add(ctrl);
  }

  removeController(ctrl: ReadableStreamDefaultController<string>): void {
    this.controllers.delete(ctrl);
  }

  addListener(fn: (event: EngineEvent) => Promise<void>): void {
    this.listeners.add(fn);
  }

  removeListener(fn: (event: EngineEvent) => Promise<void>): void {
    this.listeners.delete(fn);
  }

  get clientCount(): number {
    return this.controllers.size + this.listeners.size;
  }

  async emit(event: EngineEvent): Promise<void> {
    const { emittedAt, ...rest } = event;
    const msg = JSON.stringify({ ...rest, timestamp: emittedAt.toISOString() });
    const frame = `data: ${msg}\n\n`;
    for (const ctrl of this.controllers) {
      try {
        ctrl.enqueue(frame);
      } catch {
        this.controllers.delete(ctrl);
      }
    }
    for (const listener of this.listeners) {
      await listener(event).catch(() => {});
    }
  }
}

// ─── Unwrap MCP tool result → { status, body } ───

function mcpResultToResponse(result: { content: { type: string; text: string }[]; isError?: boolean }): {
  status: number;
  body: unknown;
} {
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

// ─── Server config ───

export interface HonoServerDeps {
  engine: Engine;
  mcpDeps: McpServerDeps;
  adminToken?: string;
  workerToken?: string;
  corsOrigins?: string[];
  logger?: Logger;
  enableUi?: boolean;
  sseAdapter?: HonoSseAdapter;
}

// ─── Build the Hono app ───

export function createHonoApp(deps: HonoServerDeps): Hono {
  const app = new Hono();
  const log = deps.logger ?? consoleLogger;

  // Ensure engine is set on mcpDeps
  deps.mcpDeps.engine = deps.engine;

  // ─── CORS ───
  if (deps.corsOrigins && deps.corsOrigins.length > 0) {
    app.use(
      "/api/*",
      cors({
        origin: deps.corsOrigins,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    );
  } else {
    // Loopback-only CORS
    app.use(
      "/api/*",
      cors({
        origin: (origin) => {
          if (!origin) return origin;
          if (
            /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
            /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
            /^https?:\/\/\[::1\](:\d+)?$/.test(origin)
          ) {
            return origin;
          }
          return undefined as unknown as string;
        },
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    );
  }

  // ─── Auth middleware factories ───

  // biome-ignore lint/suspicious/noConfusingVoidType: Hono middleware next() returns void
  function requireWorkerAuth(): (c: import("hono").Context, next: () => Promise<void>) => Promise<Response | void> {
    return async (c, next) => {
      const configuredToken = deps.workerToken?.trim() || undefined;
      if (!configuredToken) return next();
      const callerToken = extractBearerToken(c.req.header("authorization"));
      if (!callerToken || !tokensMatch(configuredToken, callerToken)) {
        return c.json({ error: "Unauthorized: worker endpoints require authentication." }, 401);
      }
      return next();
    };
  }

  // biome-ignore lint/suspicious/noConfusingVoidType: Hono middleware next() returns void
  function requireAdminAuth(): (c: import("hono").Context, next: () => Promise<void>) => Promise<Response | void> {
    return async (c, next) => {
      const configuredToken = deps.adminToken?.trim() || undefined;
      if (!configuredToken) return next();
      const callerToken = extractBearerToken(c.req.header("authorization"));
      if (!callerToken || !tokensMatch(configuredToken, callerToken)) {
        return c.json({ error: "Unauthorized: admin endpoints require authentication." }, 401);
      }
      return next();
    };
  }

  // ─── JSON body parser with explicit error ───
  async function parseJsonBody(c: import("hono").Context): Promise<Record<string, unknown> | null> {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ─── Status ───
  app.get("/api/status", async (c) => {
    const status = await deps.engine.getStatus();
    return c.json(status);
  });

  // ─── Worker: Claim (cross-flow) ───
  app.post("/api/claim", requireWorkerAuth(), async (c) => {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);
    const args = { role: body.role as string };
    const result = await callToolHandler(deps.mcpDeps, "flow.claim", args);
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  // ─── Worker: Claim (flow-specific) ───
  app.post("/api/flows/:flow/claim", requireWorkerAuth(), async (c) => {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);
    const args = { role: body.role as string, flow: c.req.param("flow") };
    const result = await callToolHandler(deps.mcpDeps, "flow.claim", args);
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  // ─── Worker: Report (longRunning — no timeout) ───
  app.post("/api/entities/:id/report", requireWorkerAuth(), async (c) => {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);
    const args: Record<string, unknown> = {
      entity_id: c.req.param("id"),
      signal: body.signal as string,
    };
    if (body.worker_id) args.worker_id = body.worker_id;
    if (body.artifacts) args.artifacts = body.artifacts;
    const result = await callToolHandler(deps.mcpDeps, "flow.report", args);
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  // ─── Worker: Fail ───
  app.post("/api/entities/:id/fail", requireWorkerAuth(), async (c) => {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);
    const args = { entity_id: c.req.param("id"), error: body.error as string };
    const result = await callToolHandler(deps.mcpDeps, "flow.fail", args);
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  // ─── Entity CRUD ───
  app.post("/api/entities", async (c) => {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid JSON" }, 400);
    const flowName = body.flow as string;
    const refs = body.refs as Record<string, { adapter: string; id: string }> | undefined;
    const payload = body.payload as Record<string, unknown> | undefined;
    if (!flowName) return c.json({ error: "Missing required field: flow" }, 400);
    try {
      const entity = await deps.engine.createEntity(flowName, refs, payload);
      return c.json(entity as unknown as Record<string, unknown>, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 500);
    }
  });

  app.get("/api/entities/:id", async (c) => {
    const result = await callToolHandler(deps.mcpDeps, "query.entity", { id: c.req.param("id") });
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  app.get("/api/entities", async (c) => {
    const flow = c.req.query("flow");
    const state = c.req.query("state");
    if (!flow || !state) return c.json({ error: "Required query params: flow, state" }, 400);
    const args: Record<string, unknown> = { flow, state };
    const limitStr = c.req.query("limit");
    if (limitStr) {
      const limit = parseInt(limitStr, 10);
      if (!Number.isNaN(limit) && limit > 0) args.limit = limit;
    }
    const result = await callToolHandler(deps.mcpDeps, "query.entities", args);
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  // ─── Flow definitions ───
  app.get("/api/flows", async (c) => {
    const flows = await deps.mcpDeps.flows.listAll();
    return c.json(flows as unknown as Record<string, unknown>[]);
  });

  app.get("/api/flows/:id", async (c) => {
    const result = await callToolHandler(deps.mcpDeps, "query.flow", { name: c.req.param("id") });
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  app.put("/api/flows/:id", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const flowName = c.req.param("id");
    const existing = await deps.mcpDeps.flows.getByName(flowName);
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const toolName = existing ? "admin.flow.update" : "admin.flow.create";
    const args = existing
      ? { flow_name: flowName, definition: body.definition, description: body.description }
      : { name: flowName, definition: body.definition, description: body.description };
    const result = await callToolHandler(deps.mcpDeps, toolName, args, {
      adminToken: deps.adminToken,
      callerToken,
    });
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  app.delete("/api/flows/:id", async (c) => {
    return c.json({ error: "Flow deletion not implemented" }, 501);
  });

  // ─── Admin routes ───
  const admin = new Hono();

  admin.post("/flows/:flow/pause", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.flow.pause",
      { flow_name: c.req.param("flow") },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  admin.post("/flows/:flow/resume", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.flow.resume",
      { flow_name: c.req.param("flow") },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  admin.post("/entities/:id/cancel", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.entity.cancel",
      { entity_id: c.req.param("id") },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  admin.post("/entities/:id/reset", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.entity.reset",
      { entity_id: c.req.param("id"), target_state: body.target_state as string },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  admin.post("/workers/:worker_id/drain", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.worker.drain",
      { worker_id: c.req.param("worker_id") },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  admin.post("/workers/:worker_id/undrain", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.worker.undrain",
      { worker_id: c.req.param("worker_id") },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  admin.post("/entities/:id/gates/:gateName/rerun", requireAdminAuth(), async (c) => {
    const callerToken = extractBearerToken(c.req.header("authorization"));
    const result = await callToolHandler(
      deps.mcpDeps,
      "admin.gate.rerun",
      { entity_id: c.req.param("id"), gate_name: c.req.param("gateName") },
      { adminToken: deps.adminToken, callerToken },
    );
    const { status, body: resBody } = mcpResultToResponse(result);
    return c.json(resBody as Record<string, unknown>, status as 200);
  });

  app.route("/api/admin", admin);

  // ─── UI routes (optional) ───
  if (deps.enableUi) {
    app.get("/ui", (c) => {
      return c.html(UI_HTML);
    });

    const ui = new Hono();

    ui.get("/entity/:id/events", requireAdminAuth(), async (c) => {
      const id = c.req.param("id") as string;
      const limitStr = c.req.query("limit");
      const limit = limitStr !== undefined ? parseInt(limitStr, 10) : 100;
      if (limitStr !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        return c.json({ error: "invalid limit parameter" }, 400);
      }
      const evts = await deps.mcpDeps.eventRepo.findByEntity(id, limit);
      return c.json(evts as unknown as Record<string, unknown>[]);
    });

    ui.get("/entity/:id/invocations", requireAdminAuth(), async (c) => {
      const id = c.req.param("id") as string;
      const invocations = await deps.mcpDeps.invocations.findByEntity(id);
      return c.json(invocations as unknown as Record<string, unknown>[]);
    });

    ui.get("/entity/:id/gates", requireAdminAuth(), async (c) => {
      const id = c.req.param("id") as string;
      const results = await deps.mcpDeps.gates.resultsFor(id);
      return c.json(results as unknown as Record<string, unknown>[]);
    });

    ui.get("/events/recent", requireAdminAuth(), async (c) => {
      const limitStr = c.req.query("limit");
      const limit = limitStr !== undefined ? parseInt(limitStr, 10) : 200;
      if (limitStr !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        return c.json({ error: "invalid limit parameter" }, 400);
      }
      const evts = await deps.mcpDeps.eventRepo.findRecent(limit);
      return c.json(evts as unknown as Record<string, unknown>[]);
    });

    // SSE endpoint
    ui.get("/events", async (c) => {
      const queryToken = c.req.query("token");
      const headerToken = extractBearerToken(c.req.header("authorization"));
      const callerToken = headerToken ?? queryToken;
      const configuredToken = deps.adminToken?.trim() || undefined;
      if (configuredToken) {
        if (!callerToken || !tokensMatch(configuredToken, callerToken)) {
          return c.json({ error: "Unauthorized" }, 401);
        }
      }

      return streamSSE(c, async (stream) => {
        // Send initial comment to establish connection
        await stream.writeSSE({ data: "", event: "ping" });

        // Keep connection open until client disconnects
        const closed = new Promise<void>((resolve) => {
          stream.onAbort(() => resolve());
        });

        // If we have an SSE adapter, pipe events through it
        if (deps.sseAdapter) {
          const handler = async (event: EngineEvent) => {
            const { emittedAt, ...rest } = event;
            await stream.writeSSE({
              data: JSON.stringify({ ...rest, timestamp: emittedAt.toISOString() }),
            });
          };
          deps.sseAdapter.addListener(handler);
          await closed;
          deps.sseAdapter.removeListener(handler);
        } else {
          await closed;
        }
      });
    });

    app.route("/api/ui", ui);
  }

  // ─── Error handling ───
  app.onError((err, c) => {
    log.error("Request error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  // ─── 404 fallback ───
  app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
  });

  return app;
}

// ─── Convenience: create and start the server ───

export function startHonoServer(
  deps: HonoServerDeps,
  port: number,
  hostname = "127.0.0.1",
): { app: Hono; server: import("node:http").Server; close: () => void } {
  const app = createHonoApp(deps);
  const httpServer = serve({ fetch: app.fetch, port, hostname }) as import("node:http").Server;

  // Harden against Slowloris / DoS — matches old server's explicit timeouts
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;

  return {
    app,
    server: httpServer,
    close: () => httpServer.close(),
  };
}
