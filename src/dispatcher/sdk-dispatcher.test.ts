import { afterEach, describe, expect, it, vi } from "vitest";
import type { IEntityActivityRepo } from "../radar-db/repos/entity-activity-repo.js";
import { SdkDispatcher } from "./sdk-dispatcher.js";

// Minimal stub for IEntityActivityRepo
function makeRepo(): IEntityActivityRepo {
  return {
    insert: vi
      .fn()
      .mockReturnValue({ id: "x", entityId: "e1", slotId: "s1", seq: 0, type: "start", data: {}, createdAt: 0 }),
    getByEntity: vi.fn().mockReturnValue([]),
    getSummary: vi.fn().mockReturnValue(""),
    deleteByEntity: vi.fn(),
  };
}

// Helper: build an async iterable from an array of SDK messages
async function* makeStream(messages: object[]) {
  for (const m of messages) yield m;
}

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";

const mockQuery = vi.mocked(query);

describe("SdkDispatcher", () => {
  it("inserts start row on dispatch", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.001, stop_reason: "end_turn" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    await dispatcher.dispatch("do work", { entityId: "e1", workerId: "slot-1", modelTier: "haiku" });

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "start" }));
  });

  it("inserts tool_use rows for each tool call", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } },
              { type: "tool_use", name: "Bash", input: { command: "ls" } },
            ],
          },
        },
        { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.002, stop_reason: "end_turn" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    await dispatcher.dispatch("do work", { entityId: "e1", workerId: "slot-1", modelTier: "haiku" });

    const calls = vi.mocked(repo.insert).mock.calls.map((c) => c[0]);
    const toolUse = calls.filter((c) => c.type === "tool_use");
    expect(toolUse).toHaveLength(2);
    expect(toolUse[0].data).toEqual({ name: "Read", input: { file_path: "/foo.ts" } });
    expect(toolUse[1].data).toEqual({ name: "Bash", input: { command: "ls" } });
  });

  it("inserts text rows for assistant text", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "thinking..." }] },
        },
        { type: "result", subtype: "success", is_error: false, total_cost_usd: 0, stop_reason: "end_turn" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    await dispatcher.dispatch("do work", { entityId: "e1", workerId: "slot-1", modelTier: "haiku" });

    const calls = vi.mocked(repo.insert).mock.calls.map((c) => c[0]);
    const textRows = calls.filter((c) => c.type === "text");
    expect(textRows).toHaveLength(1);
    expect(textRows[0].data).toEqual({ text: "thinking..." });
  });

  it("inserts result row and parses signal from last text", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "PR created: https://github.com/wopr-network/radar/pull/99" }] },
        },
        { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.005, stop_reason: "end_turn" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    const result = await dispatcher.dispatch("do work", { entityId: "e1", workerId: "slot-1", modelTier: "sonnet" });

    const calls = vi.mocked(repo.insert).mock.calls.map((c) => c[0]);
    const resultRow = calls.find((c) => c.type === "result");
    expect(resultRow?.data).toMatchObject({ subtype: "success", cost_usd: 0.005 });

    expect(result.signal).toBe("pr_created");
    expect(result.artifacts).toMatchObject({ prNumber: 99 });
    expect(result.exitCode).toBe(0);
  });

  it("returns crash on is_error=true result", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        { type: "result", subtype: "error_max_turns", is_error: true, total_cost_usd: 0, stop_reason: "max_turns" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    const result = await dispatcher.dispatch("do work", { entityId: "e1", workerId: "slot-1", modelTier: "haiku" });

    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(1);
  });

  describe("uses LINEAR_MCP_URL env var for MCP server args", () => {
    const originalMcpUrl = process.env.LINEAR_MCP_URL;
    const originalKey = process.env.LINEAR_API_KEY;

    afterEach(() => {
      if (originalMcpUrl === undefined) delete process.env.LINEAR_MCP_URL;
      else process.env.LINEAR_MCP_URL = originalMcpUrl;
      if (originalKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = originalKey;
    });

    it("passes custom URL to MCP server args", async () => {
      const repo = makeRepo();
      process.env.LINEAR_MCP_URL = "https://custom-mcp.example.com/mcp";
      process.env.LINEAR_API_KEY = "lin_api_test123";

      vi.resetModules();

      // Re-mock after resetModules
      vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
        query: vi.fn(),
      }));
      const { query: freshQuery } = await import("@anthropic-ai/claude-agent-sdk");
      const freshMockQuery = vi.mocked(freshQuery);
      vi.clearAllMocks();
      freshMockQuery.mockReturnValue(
        makeStream([
          { type: "result", subtype: "success", is_error: false, total_cost_usd: 0, stop_reason: "end_turn" },
        ]) as ReturnType<typeof freshQuery>,
      );

      const { SdkDispatcher: FreshDispatcher } = await import("./sdk-dispatcher.js");
      const dispatcher = new FreshDispatcher(repo);
      await dispatcher.dispatch("work", { entityId: "e1", workerId: "s", modelTier: "haiku" });

      const callArgs = freshMockQuery.mock.lastCall?.[0] as {
        options: { mcpServers?: Record<string, { args: string[] }> };
      };
      const mcpArgs = callArgs?.options?.mcpServers?.["linear-server"]?.args;
      expect(mcpArgs).toContain("https://custom-mcp.example.com/mcp");
    });
  });

  it("returns timeout when abort fires", async () => {
    const repo = makeRepo();
    // Stream that hangs until aborted
    mockQuery.mockReturnValue(
      (async function* () {
        await new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 10),
        );
      })() as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    const result = await dispatcher.dispatch("do work", {
      entityId: "e1",
      workerId: "slot-1",
      modelTier: "haiku",
      timeout: 5, // abort very quickly
    });

    expect(result.signal).toBe("timeout");
  });

  it("uses correct model string for each tier", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        { type: "result", subtype: "success", is_error: false, total_cost_usd: 0, stop_reason: "end_turn" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    await dispatcher.dispatch("work", { entityId: "e1", workerId: "s", modelTier: "opus" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ model: "claude-opus-4-6" }) }),
    );
  });

  it("dispatches prompt as-is (history injection is run-loop's responsibility)", async () => {
    const repo = makeRepo();
    mockQuery.mockReturnValue(
      makeStream([
        { type: "result", subtype: "success", is_error: false, total_cost_usd: 0, stop_reason: "end_turn" },
      ]) as ReturnType<typeof query>,
    );

    const dispatcher = new SdkDispatcher(repo);
    await dispatcher.dispatch("new task", { entityId: "e1", workerId: "slot-2", modelTier: "haiku" });

    expect(repo.getSummary).not.toHaveBeenCalled();
    const promptArg = mockQuery.mock.lastCall?.[0] as { prompt: string } | undefined;
    expect(promptArg?.prompt).toContain("new task");
  });
});
