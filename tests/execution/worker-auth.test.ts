import { describe, expect, it } from "vitest";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps, McpServerOpts } from "../../src/execution/mcp-server.js";

const stubDeps: McpServerDeps = {
  entities: {} as any,
  flows: {} as any,
  invocations: {} as any,
  gates: {} as any,
  transitions: {} as any,
  eventRepo: {} as any,
};

describe("worker auth guard", () => {
  it("rejects flow.* calls when worker token is configured but not provided", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123" };
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("rejects flow.* calls when wrong worker token is provided", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123", callerToken: "wrong-token" };
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("allows flow.* calls when correct worker token is provided", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123", callerToken: "worker-secret-123" };
    // Will fail at repo call, NOT at auth
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("allows flow.* calls when no worker token is configured (open mode)", async () => {
    const opts: McpServerOpts = {};
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("allows flow.* calls in stdio trusted mode even with worker token configured", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123", stdioTrusted: true };
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("treats empty-string DEFCON_WORKER_TOKEN as unset (open mode)", async () => {
    const opts: McpServerOpts = { workerToken: "" };
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("does not leak env var name in error message", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123" };
    const result = await callToolHandler(stubDeps, "flow.claim", { role: "engineering" }, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("DEFCON_WORKER_TOKEN");
  });

  it("query.* calls remain open even when worker token is configured", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123" };
    const result = await callToolHandler(stubDeps, "query.entity", { id: "test" }, opts);
    expect(result.content[0].text).not.toContain("Unauthorized");
  });

  it("flow.get_prompt requires worker token when configured", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123" };
    const result = await callToolHandler(stubDeps, "flow.get_prompt", { entity_id: "test" }, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("flow.report requires worker token when configured", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123" };
    const result = await callToolHandler(stubDeps, "flow.report", { entity_id: "test", signal: "done" }, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("flow.fail requires worker token when configured", async () => {
    const opts: McpServerOpts = { workerToken: "worker-secret-123" };
    const result = await callToolHandler(stubDeps, "flow.fail", { entity_id: "test", error: "boom" }, opts);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });
});
