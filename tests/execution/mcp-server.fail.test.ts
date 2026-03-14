import { describe, it, expect, beforeEach } from "vitest";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import {
  mockFlow,
  createMockDeps,
  callTool,
} from "./helpers.js";

describe("flow.fail", () => {
  let deps: McpServerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    const coderFlow = mockFlow({ discipline: "coder" });
    deps.flows.getByName = async (name) => (name === "test-flow" ? coderFlow : null);
    deps.flows.list = async () => [coderFlow];
    deps.flows.listAll = async () => [coderFlow];
  });

  it("flow.fail marks invocation as failed", async () => {
    const result = await callTool(deps, "flow.fail", {
      entity_id: "ent-1",
      error: "build failed",
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const data = JSON.parse(content[0].text);
    expect(data.acknowledged).toBe(true);
  });

  it("flow.fail rejects missing error", async () => {
    const result = await callTool(deps, "flow.fail", { entity_id: "ent-1" });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Validation error");
  });
});
