import { describe, expect, it } from "vitest";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps, McpServerOpts } from "../../src/execution/mcp-server.js";

// Minimal stub deps — admin tools will fail at validation, but auth check comes first
const stubDeps: McpServerDeps = {
  entities: {} as any,
  flows: {} as any,
  invocations: {} as any,
  gates: {} as any,
  transitions: {} as any,
  eventRepo: {} as any,
  integrationRepo: {} as any,
};

describe("admin auth guard", () => {
  it("rejects admin.* calls when token is configured but not provided", async () => {
    const opts: McpServerOpts = { adminToken: "secret-token-123" };
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("rejects admin.* calls when wrong token is provided", async () => {
    const opts: McpServerOpts = { adminToken: "secret-token-123", callerToken: "wrong-token" };
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("allows admin.* calls when correct token is provided", async () => {
    const opts: McpServerOpts = { adminToken: "secret-token-123", callerToken: "secret-token-123" };
    // Will fail at validation (no args), NOT at auth — proves auth passed
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("allows admin.* calls when no token is configured (open mode)", async () => {
    const opts: McpServerOpts = {};
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("allows flow.* calls without any token even when admin token is configured", async () => {
    const opts: McpServerOpts = { adminToken: "secret-token-123" };
    // flow.claim requires role param, will fail there — not at auth
    const result = await callToolHandler(stubDeps, "flow.claim", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("role");
  });

  it("allows query.* calls without any token even when admin token is configured", async () => {
    const opts: McpServerOpts = { adminToken: "secret-token-123" };
    const result = await callToolHandler(stubDeps, "query.entity", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("id");
  });

  it("treats empty-string SILO_ADMIN_TOKEN as unset (open mode)", async () => {
    const opts: McpServerOpts = { adminToken: "" };
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("allows admin.* calls when no callerToken is provided (stdio trust mode)", async () => {
    // stdio passes adminToken but no callerToken — stdioTrusted bypasses auth
    const opts: McpServerOpts = { adminToken: "secret-token-123", stdioTrusted: true };
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("uses generic error message without env var name", async () => {
    const opts: McpServerOpts = { adminToken: "secret-token-123" };
    const result = await callToolHandler(stubDeps, "admin.flow.create", {}, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("SILO_ADMIN_TOKEN");
  });
});
