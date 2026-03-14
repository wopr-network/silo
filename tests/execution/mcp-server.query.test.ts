import { describe, it, expect, beforeEach, vi } from "vitest";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import {
  mockFlow,
  createMockDeps,
  callTool,
} from "./helpers.js";

describe("query tools", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];
  });

  it("query.entity returns entity with history", async () => {
    const result = await callTool(deps, "query.entity", { id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("id", "ent-1");
    expect(data).toHaveProperty("history");
  });

  it("query.entities returns matching entities", async () => {
    const result = await callTool(deps, "query.entities", {
      flow: "test-flow",
      state: "draft",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("query.invocations returns invocations for entity", async () => {
    const result = await callTool(deps, "query.invocations", { entity_id: "ent-1" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
  });

  it("query.flow returns flow definition", async () => {
    const result = await callTool(deps, "query.flow", { name: "test-flow" });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data).toHaveProperty("name", "test-flow");
    expect(data).toHaveProperty("states");
    expect(data).toHaveProperty("transitions");
  });

  it("query.flow returns error for unknown flow", async () => {
    const result = await callTool(deps, "query.flow", { name: "nonexistent" });
    expect(result.isError).toBe(true);
  });

  it("query.flows returns all flow definitions without promptTemplate", async () => {
    const result = await callTool(deps, "query.flows", {});
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0]).toHaveProperty("name", "test-flow");
    expect(data[0]).toHaveProperty("states");
    expect(data[0]).toHaveProperty("transitions");
    // promptTemplate must not be exposed in list responses
    for (const state of data[0].states) {
      expect(state).not.toHaveProperty("promptTemplate");
    }
  });

  it("query.flows returns empty array when no flows exist", async () => {
    const freshDeps = { ...deps, flows: { ...deps.flows, list: vi.fn(async () => []) } };
    const result = await callToolHandler(freshDeps, "query.flows", {});
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("query.flows requires workerToken when configured", async () => {
    const result = await callToolHandler(
      deps,
      "query.flows",
      {},
      { workerToken: "secret-token", callerToken: "wrong-token" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unauthorized");
  });

  it("query.entity rejects missing id", async () => {
    const result = await callTool(deps, "query.entity", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.entities rejects missing flow", async () => {
    const result = await callTool(deps, "query.entities", { state: "draft" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.entities rejects invalid limit", async () => {
    const result = await callTool(deps, "query.entities", { flow: "test-flow", state: "draft", limit: 999 });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.invocations rejects missing entity_id", async () => {
    const result = await callTool(deps, "query.invocations", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });

  it("query.flow rejects missing name", async () => {
    const result = await callTool(deps, "query.flow", {});
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });
});
