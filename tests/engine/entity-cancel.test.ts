import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/repositories/drizzle/schema.js";
import { DrizzleEntityRepository } from "../../src/repositories/drizzle/entity.repo.js";
import { DrizzleEventRepository } from "../../src/repositories/drizzle/event.repo.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "../../src/repositories/drizzle/invocation.repo.js";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import type { ITransitionLogRepository } from "../../src/repositories/interfaces.js";

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

describe("entity cancellation", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: Database.Database;
  let deps: McpServerDeps;
  let entityRepo: DrizzleEntityRepository;
  let flowRepo: DrizzleFlowRepository;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });

    entityRepo = new DrizzleEntityRepository(db as any);
    flowRepo = new DrizzleFlowRepository(db as any);
    deps = {
      entities: entityRepo,
      flows: flowRepo,
      invocations: new DrizzleInvocationRepository(db as any),
      gates: new DrizzleGateRepository(db as any),
      transitions: makeTransitionRepo(),
      eventRepo: new DrizzleEventRepository(db as any),
    };
  });

  async function createFlow(name: string, states: string[]) {
    const flow = await flowRepo.create({ name, initialState: states[0] });
    for (const state of states) {
      await flowRepo.addState(flow.id, { name: state });
    }
    return flow;
  }

  it("admin.entity.cancel cancels an entity and returns cancelled", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await entityRepo.create(flow.id, "open");

    const result = await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cancelled).toBe(true);
    expect(parsed.cancelled_count).toBe(1);
    expect(parsed.cancelled_ids).toContain(entity.id);

    const check = await entityRepo.get(entity.id);
    expect(check!.state).toBe("cancelled");
    expect(check!.claimedBy).toBeNull();
  });

  it("admin.entity.cancel returns error for already-cancelled entity", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await entityRepo.create(flow.id, "open");

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });
    const result = await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });
    expect(result.isError).toBe(true);
  });

  it("admin.entity.cancel --cascade cancels parent and children recursively", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await entityRepo.create(parentFlow.id, "open");
    const child1 = await entityRepo.create(childFlow.id, "open", undefined, undefined, parent.id);
    const child2 = await entityRepo.create(childFlow.id, "open", undefined, undefined, parent.id);
    const grandchild = await entityRepo.create(childFlow.id, "open", undefined, undefined, child1.id);

    const result = await callToolHandler(deps, "admin.entity.cancel", {
      entity_id: parent.id,
      cascade: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cancelled).toBe(true);
    expect(parsed.cancelled_count).toBe(4);
    expect(parsed.cancelled_ids).toContain(parent.id);
    expect(parsed.cancelled_ids).toContain(child1.id);
    expect(parsed.cancelled_ids).toContain(child2.id);
    expect(parsed.cancelled_ids).toContain(grandchild.id);

    for (const id of [parent.id, child1.id, child2.id, grandchild.id]) {
      const e = await entityRepo.get(id);
      expect(e!.state).toBe("cancelled");
    }
  });

  it("admin.entity.cancel without cascade only cancels the target", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await entityRepo.create(parentFlow.id, "open");
    const child = await entityRepo.create(childFlow.id, "open", undefined, undefined, parent.id);

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: parent.id });

    const childCheck = await entityRepo.get(child.id);
    expect(childCheck!.state).toBe("open");
  });

  it("cancelled entity cannot be claimed via entityRepo.claim", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await entityRepo.create(flow.id, "open");

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });

    const claimed = await entityRepo.claim(flow.id, "open", "agent:test");
    expect(claimed).toBeNull();
  });

  it("query.entity returns cancelled state for cancelled entity", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await entityRepo.create(flow.id, "open");

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });

    const queryResult = await callToolHandler(deps, "query.entity", { id: entity.id });
    const parsed = JSON.parse(queryResult.content[0].text);
    expect(parsed.state).toBe("cancelled");
  });

  it("cascade visits children of already-cancelled nodes", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await entityRepo.create(parentFlow.id, "open");
    const child = await entityRepo.create(childFlow.id, "open", undefined, undefined, parent.id);
    const grandchild = await entityRepo.create(childFlow.id, "open", undefined, undefined, child.id);

    // Pre-cancel the child so it's already cancelled before cascade runs
    await callToolHandler(deps, "admin.entity.cancel", { entity_id: child.id });

    // Now cascade-cancel the parent — grandchild must still be cancelled
    const result = await callToolHandler(deps, "admin.entity.cancel", {
      entity_id: parent.id,
      cascade: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cancelled).toBe(true);

    const grandchildCheck = await entityRepo.get(grandchild.id);
    expect(grandchildCheck!.state).toBe("cancelled");
  });

  it("parent_entity_id is set on spawned child entities", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await entityRepo.create(parentFlow.id, "open");
    const child = await entityRepo.create(childFlow.id, "open", undefined, undefined, parent.id);

    expect(child.parentEntityId).toBe(parent.id);

    const children = await entityRepo.findByParentId(parent.id);
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(child.id);
  });
});
