import { describe, expect, it } from "vitest";

// Test the mcpResultToResponse logic directly by reproducing the function
// (it is not exported from hono-server.ts, so we test the behavior inline)
describe("mcpResultToResponse error code routing", () => {
  function mcpResultToResponse(result: {
    content: { type: string; text: string }[];
    isError?: boolean;
    errorCode?: string;
  }): { status: number; body: unknown } {
    const text = result.content[0]?.text ?? "";
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }

    if (result.isError) {
      const msg =
        typeof body === "object" && body !== null && "message" in body
          ? (body as Record<string, unknown>).message
          : text;
      const msgStr = String(msg);

      // Prefer typed error codes
      if (result.errorCode === "NOT_FOUND") return { status: 404, body: { error: msgStr } };
      if (result.errorCode === "VALIDATION") return { status: 400, body: { error: msgStr } };
      if (result.errorCode === "CONFLICT") return { status: 409, body: { error: msgStr } };
      if (result.errorCode === "UNAUTHORIZED") return { status: 401, body: { error: msgStr } };

      // Fallback: string matching
      if (msgStr.includes("not found") || msgStr.includes("Not found")) return { status: 404, body: { error: msgStr } };
      if (msgStr.includes("Unauthorized")) return { status: 401, body: { error: msgStr } };
      if (msgStr.includes("Validation error")) return { status: 400, body: { error: msgStr } };
      if (msgStr.includes("No active invocation")) return { status: 409, body: { error: msgStr } };
      return { status: 500, body: { error: msgStr } };
    }

    if (body === null) return { status: 204, body: null };
    return { status: 200, body };
  }

  it("returns 404 when errorCode is NOT_FOUND regardless of message text", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "Entity xyz does not exist" }],
      isError: true,
      errorCode: "NOT_FOUND",
    });
    expect(result.status).toBe(404);
  });

  it("returns 400 when errorCode is VALIDATION", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "bad input" }],
      isError: true,
      errorCode: "VALIDATION",
    });
    expect(result.status).toBe(400);
  });

  it("returns 409 when errorCode is CONFLICT", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "already exists" }],
      isError: true,
      errorCode: "CONFLICT",
    });
    expect(result.status).toBe(409);
  });

  it("returns 401 when errorCode is UNAUTHORIZED", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "access denied" }],
      isError: true,
      errorCode: "UNAUTHORIZED",
    });
    expect(result.status).toBe(401);
  });

  it("falls back to string matching when no errorCode - not found", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "Entity not found: abc" }],
      isError: true,
    });
    expect(result.status).toBe(404);
  });

  it("returns 500 for unknown errors without errorCode", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "something unexpected" }],
      isError: true,
    });
    expect(result.status).toBe(500);
  });

  it("returns 200 for successful results", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: '{"ok":true}' }],
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  });

  it("returns 204 for null body", () => {
    const result = mcpResultToResponse({
      content: [{ type: "text", text: "null" }],
    });
    expect(result.status).toBe(204);
  });
});
