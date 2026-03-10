import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createScopedRepos, type ScopedRepos } from "../../src/repositories/scoped-repos.js";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import type { PGlite } from "@electric-sql/pglite";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import type { ITransitionLogRepository } from "../../src/repositories/interfaces.js";

const TENANT = "test-tenant";

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
  let db: TestDb;
  let client: PGlite;
  let closeFn: () => Promise<void>;
  let repos: ScopedRepos;
  let deps: McpServerDeps;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    client = testDb.client;
    closeFn = testDb.close;
    repos = createScopedRepos(db, TENANT);

    deps = {
      entities: repos.entities,
      flows: repos.flows,
      invocations: repos.invocations,
      gates: repos.gates,
      transitions: makeTransitionRepo(),
      eventRepo: repos.events,
    };
  });

  afterEach(async () => {
    await closeFn();
  });

  async function createFlow(name: string, states: string[]) {
    const flow = await repos.flows.create({ name, initialState: states[0] });
    for (const state of states) {
      await repos.flows.addState(flow.id, { name: state });
    }
    return flow;
  }

  it("admin.entity.cancel cancels an entity and returns cancelled", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await repos.entities.create(flow.id, "open");

    const result = await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cancelled).toBe(true);
    expect(parsed.cancelled_count).toBe(1);
    expect(parsed.cancelled_ids).toContain(entity.id);

    const check = await repos.entities.get(entity.id);
    expect(check!.state).toBe("cancelled");
    expect(check!.claimedBy).toBeNull();
  });

  it("admin.entity.cancel returns error for already-cancelled entity", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await repos.entities.create(flow.id, "open");

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });
    const result = await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });
    expect(result.isError).toBe(true);
  });

  it("admin.entity.cancel --cascade cancels parent and children recursively", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await repos.entities.create(parentFlow.id, "open");
    const child1 = await repos.entities.create(childFlow.id, "open", undefined, undefined, parent.id);
    const child2 = await repos.entities.create(childFlow.id, "open", undefined, undefined, parent.id);
    const grandchild = await repos.entities.create(childFlow.id, "open", undefined, undefined, child1.id);

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
      const e = await repos.entities.get(id);
      expect(e!.state).toBe("cancelled");
    }
  });

  it("admin.entity.cancel without cascade only cancels the target", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await repos.entities.create(parentFlow.id, "open");
    const child = await repos.entities.create(childFlow.id, "open", undefined, undefined, parent.id);

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: parent.id });

    const childCheck = await repos.entities.get(child.id);
    expect(childCheck!.state).toBe("open");
  });

  it("cancelled entity cannot be claimed via entityRepo.claim", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await repos.entities.create(flow.id, "open");

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });

    const claimed = await repos.entities.claim(flow.id, "open", "agent:test");
    expect(claimed).toBeNull();
  });

  it("query.entity returns cancelled state for cancelled entity", async () => {
    const flow = await createFlow("test-flow", ["open", "done"]);
    const entity = await repos.entities.create(flow.id, "open");

    await callToolHandler(deps, "admin.entity.cancel", { entity_id: entity.id });

    const queryResult = await callToolHandler(deps, "query.entity", { id: entity.id });
    const parsed = JSON.parse(queryResult.content[0].text);
    expect(parsed.state).toBe("cancelled");
  });

  it("cascade visits children of already-cancelled nodes", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await repos.entities.create(parentFlow.id, "open");
    const child = await repos.entities.create(childFlow.id, "open", undefined, undefined, parent.id);
    const grandchild = await repos.entities.create(childFlow.id, "open", undefined, undefined, child.id);

    // Pre-cancel the child so it's already cancelled before cascade runs
    await callToolHandler(deps, "admin.entity.cancel", { entity_id: child.id });

    // Now cascade-cancel the parent — grandchild must still be cancelled
    const result = await callToolHandler(deps, "admin.entity.cancel", {
      entity_id: parent.id,
      cascade: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cancelled).toBe(true);

    const grandchildCheck = await repos.entities.get(grandchild.id);
    expect(grandchildCheck!.state).toBe("cancelled");
  });

  it("parent_entity_id is set on spawned child entities", async () => {
    const parentFlow = await createFlow("parent-flow", ["open", "done"]);
    const childFlow = await createFlow("child-flow", ["open", "done"]);

    const parent = await repos.entities.create(parentFlow.id, "open");
    const child = await repos.entities.create(childFlow.id, "open", undefined, undefined, parent.id);

    expect(child.parentEntityId).toBe(parent.id);

    const children = await repos.entities.findByParentId(parent.id);
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(child.id);
  });
});
