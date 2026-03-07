import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/repositories/drizzle/schema.js";
import { DrizzleFlowRepository } from "../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../src/repositories/drizzle/gate.repo.js";
import { DrizzleEntityRepository } from "../src/repositories/drizzle/entity.repo.js";
import { DrizzleEventRepository } from "../src/repositories/drizzle/event.repo.js";
import { DrizzleInvocationRepository } from "../src/repositories/drizzle/invocation.repo.js";
import { callToolHandler } from "../src/execution/mcp-server.js";
import type { McpServerDeps } from "../src/execution/mcp-server.js";
import type { ITransitionLogRepository } from "../src/repositories/interfaces.js";

function makeTransitionRepo(): ITransitionLogRepository {
  return {
    record: async () => ({
      id: crypto.randomUUID(),
      entityId: "",
      fromState: null,
      toState: "",
      trigger: null,
      invocationId: null,
      timestamp: new Date(),
    }),
    historyFor: async () => [],
  };
}

describe("admin MCP tools", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: Database.Database;
  let deps: McpServerDeps;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });

    deps = {
      entities: new DrizzleEntityRepository(db as any),
      flows: new DrizzleFlowRepository(db as any),
      invocations: new DrizzleInvocationRepository(db as any),
      gates: new DrizzleGateRepository(db as any),
      transitions: makeTransitionRepo(),
      eventRepo: new DrizzleEventRepository(db as any),
    };
  });

  it("admin.flow.create creates a flow", async () => {
    const result = await callToolHandler(deps, "admin.flow.create", {
      name: "test-flow",
      initialState: "open",
      description: "A test flow",
      states: [{ name: "open" }],
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("test-flow");
    expect(parsed.initialState).toBe("open");
  });

  it("admin.flow.create rejects invalid input", async () => {
    const result = await callToolHandler(deps, "admin.flow.create", {});
    expect(result.isError).toBe(true);
  });

  it("admin.state.create adds a state to an existing flow", async () => {
    await callToolHandler(deps, "admin.flow.create", { name: "test-flow", initialState: "open", states: [{ name: "open" }] });
    const result = await callToolHandler(deps, "admin.state.create", {
      flow_name: "test-flow",
      name: "review",
      mode: "passive",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("review");
  });

  it("admin.state.create errors on nonexistent flow", async () => {
    const result = await callToolHandler(deps, "admin.state.create", {
      flow_name: "no-such-flow",
      name: "review",
    });
    expect(result.isError).toBe(true);
  });

  it("admin.flow.update updates flow metadata", async () => {
    await callToolHandler(deps, "admin.flow.create", { name: "test-flow", initialState: "open", states: [{ name: "open" }] });
    const result = await callToolHandler(deps, "admin.flow.update", {
      flow_name: "test-flow",
      description: "Updated description",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.description).toBe("Updated description");
  });

  it("admin.transition.create adds a transition", async () => {
    await callToolHandler(deps, "admin.flow.create", {
      name: "test-flow",
      initialState: "open",
      states: [{ name: "open" }, { name: "review" }],
    });
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "open",
      toState: "review",
      trigger: "submit",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.fromState).toBe("open");
    expect(parsed.toState).toBe("review");
  });

  it("admin.transition.create rejects unknown fromState", async () => {
    await callToolHandler(deps, "admin.flow.create", {
      name: "test-flow",
      initialState: "open",
      states: [{ name: "open" }],
    });
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "nonexistent",
      toState: "open",
      trigger: "go",
    });
    expect(result.isError).toBe(true);
  });

  it("admin.transition.create rejects unknown toState", async () => {
    await callToolHandler(deps, "admin.flow.create", {
      name: "test-flow",
      initialState: "open",
      states: [{ name: "open" }],
    });
    const result = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "open",
      toState: "nonexistent",
      trigger: "go",
    });
    expect(result.isError).toBe(true);
  });

  it("admin.gate.create + admin.gate.attach", async () => {
    await callToolHandler(deps, "admin.flow.create", {
      name: "test-flow",
      initialState: "open",
      states: [{ name: "open" }, { name: "review" }],
    });

    const trResult = await callToolHandler(deps, "admin.transition.create", {
      flow_name: "test-flow",
      fromState: "open",
      toState: "review",
      trigger: "submit",
    });
    const transition = JSON.parse(trResult.content[0].text);

    const gateResult = await callToolHandler(deps, "admin.gate.create", {
      name: "lint-gate",
      type: "command",
      command: "gates/lint-check.sh",
    });
    expect(gateResult.isError).toBeUndefined();
    const gate = JSON.parse(gateResult.content[0].text);
    expect(gate.name).toBe("lint-gate");

    const attachResult = await callToolHandler(deps, "admin.gate.attach", {
      flow_name: "test-flow",
      transition_id: transition.id,
      gate_name: "lint-gate",
    });
    expect(attachResult.isError).toBeUndefined();
    const attached = JSON.parse(attachResult.content[0].text);
    expect(attached.gateId).toBeTruthy();
  });

  it("admin.flow.snapshot + admin.flow.restore roundtrips", async () => {
    await callToolHandler(deps, "admin.flow.create", { name: "test-flow", initialState: "open", states: [{ name: "open" }] });

    const snapResult = await callToolHandler(deps, "admin.flow.snapshot", { flow_name: "test-flow" });
    expect(snapResult.isError).toBeUndefined();
    const snap = JSON.parse(snapResult.content[0].text);
    expect(snap.version).toBeGreaterThanOrEqual(1);
    const snapVersion = snap.version;

    // Add another state post-snapshot
    await callToolHandler(deps, "admin.state.create", { flow_name: "test-flow", name: "review" });

    // Restore to the explicit snapshot version
    const restoreResult = await callToolHandler(deps, "admin.flow.restore", {
      flow_name: "test-flow",
      version: snapVersion,
    });
    expect(restoreResult.isError).toBeUndefined();

    // Verify the flow no longer has the "review" state
    const flow = await deps.flows.getByName("test-flow");
    expect(flow?.states.map((s) => s.name)).toEqual(["open"]);
  });

  it("mutations auto-snapshot before modifying existing flow", async () => {
    await callToolHandler(deps, "admin.flow.create", { name: "test-flow", initialState: "open", states: [{ name: "open" }] });

    // This should trigger an auto-snapshot
    await callToolHandler(deps, "admin.flow.update", {
      flow_name: "test-flow",
      description: "Updated description",
    });

    const flow = await deps.flows.getByName("test-flow");
    const versions = db
      .select()
      .from(schema.flowVersions)
      .where(eq(schema.flowVersions.flowId, flow!.id))
      .all();
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  it("mutations emit definition.changed events", async () => {
    await callToolHandler(deps, "admin.flow.create", { name: "test-flow", initialState: "open", states: [{ name: "open" }] });

    const eventRows = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "definition.changed"))
      .all();
    expect(eventRows.length).toBeGreaterThanOrEqual(1);
  });

  it("full pipeline: create flow → add states → add transitions → gate → entity created in initial state", async () => {
    // 1. Create flow with states inline
    await callToolHandler(deps, "admin.flow.create", {
      name: "pipeline",
      initialState: "open",
      states: [
        { name: "open", mode: "passive", promptTemplate: "Plan the work" },
        { name: "in-progress", mode: "passive", promptTemplate: "Implement the plan" },
        { name: "done" },
      ],
    });

    // 2. (states already added inline above)

    // 3. Add transitions
    await callToolHandler(deps, "admin.transition.create", {
      flow_name: "pipeline",
      fromState: "open",
      toState: "in-progress",
      trigger: "plan_complete",
    });
    await callToolHandler(deps, "admin.transition.create", {
      flow_name: "pipeline",
      fromState: "in-progress",
      toState: "done",
      trigger: "code_complete",
    });

    // 4. Create a gate and attach it
    await callToolHandler(deps, "admin.gate.create", {
      name: "lint-check",
      type: "command",
      command: "gates/lint-check.sh",
    });
    const flow = await deps.flows.getByName("pipeline");
    const trToAttach = flow!.transitions.find((t) => t.fromState === "in-progress");
    await callToolHandler(deps, "admin.gate.attach", {
      flow_name: "pipeline",
      transition_id: trToAttach!.id,
      gate_name: "lint-check",
    });

    // 5. Verify the flow is fully formed
    const finalFlow = await deps.flows.getByName("pipeline");
    expect(finalFlow!.states).toHaveLength(3);
    expect(finalFlow!.transitions).toHaveLength(2);
    expect(finalFlow!.transitions.find((t) => t.fromState === "in-progress")!.gateId).toBeTruthy();

    // 6. Create entity and verify it starts in initial state
    const entity = await deps.entities.create(finalFlow!.id, finalFlow!.initialState);
    expect(entity.state).toBe("open");
  });
});
