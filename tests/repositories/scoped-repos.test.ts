import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import { createScopedRepos } from "../../src/repositories/scoped-repos.js";

describe("ScopedRepos", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  afterEach(async () => {
    if (close) await close();
  });

  it("creates a flow with tenant_id pre-bound", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const repos = createScopedRepos(db, "tenant-1");
    const flow = await repos.flows.create({
      name: "test-flow",
      initialState: "backlog",
    });
    expect(flow.name).toBe("test-flow");

    // Verify via direct query that tenant_id was set
    const { flowDefinitions } = await import("../../src/repositories/drizzle/schema.js");
    const rows = await db.select().from(flowDefinitions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe("tenant-1");
  });

  it("creates an entity with tenant_id pre-bound", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const repos = createScopedRepos(db, "tenant-1");
    const flow = await repos.flows.create({
      name: "test-flow",
      initialState: "backlog",
    });
    const entity = await repos.entities.create(flow.id, "backlog");
    expect(entity.state).toBe("backlog");

    // Verify tenant_id via direct query
    const { entities } = await import("../../src/repositories/drizzle/schema.js");
    const rows = await db.select().from(entities);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe("tenant-1");
  });

  it("isolates flows between tenants", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const t1 = createScopedRepos(db, "tenant-1");
    const t2 = createScopedRepos(db, "tenant-2");

    // Create flow with same name in both tenants
    await t1.flows.create({ name: "my-flow", initialState: "backlog" });
    await t2.flows.create({ name: "my-flow", initialState: "ready" });

    // Each tenant sees only their own flow
    const f1 = await t1.flows.getByName("my-flow");
    const f2 = await t2.flows.getByName("my-flow");

    expect(f1).not.toBeNull();
    expect(f2).not.toBeNull();
    expect(f1!.initialState).toBe("backlog");
    expect(f2!.initialState).toBe("ready");
    expect(f1!.id).not.toBe(f2!.id);
  });

  it("isolates entities between tenants", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const t1 = createScopedRepos(db, "tenant-1");
    const t2 = createScopedRepos(db, "tenant-2");

    const flow1 = await t1.flows.create({ name: "flow-a", initialState: "start" });
    const flow2 = await t2.flows.create({ name: "flow-b", initialState: "start" });

    await t1.entities.create(flow1.id, "start");
    await t1.entities.create(flow1.id, "start");
    await t2.entities.create(flow2.id, "start");

    // Tenant 1 sees 2 entities, tenant 2 sees 1
    const e1 = await t1.entities.findByFlowAndState(flow1.id, "start");
    const e2 = await t2.entities.findByFlowAndState(flow2.id, "start");
    expect(e1).toHaveLength(2);
    expect(e2).toHaveLength(1);
  });

  it("isolates gates between tenants", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const t1 = createScopedRepos(db, "tenant-1");
    const t2 = createScopedRepos(db, "tenant-2");

    await t1.gates.create({ name: "ci-check", type: "shell", command: "echo ok" });
    await t2.gates.create({ name: "ci-check", type: "shell", command: "echo other" });

    const g1 = await t1.gates.getByName("ci-check");
    const g2 = await t2.gates.getByName("ci-check");

    expect(g1).not.toBeNull();
    expect(g2).not.toBeNull();
    expect(g1!.command).toBe("echo ok");
    expect(g2!.command).toBe("echo other");
  });

  it("listAll returns only current tenant's flows", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const t1 = createScopedRepos(db, "tenant-1");
    const t2 = createScopedRepos(db, "tenant-2");

    await t1.flows.create({ name: "flow-a", initialState: "s" });
    await t1.flows.create({ name: "flow-b", initialState: "s" });
    await t2.flows.create({ name: "flow-c", initialState: "s" });

    const list1 = await t1.flows.listAll();
    const list2 = await t2.flows.listAll();

    expect(list1).toHaveLength(2);
    expect(list2).toHaveLength(1);
    expect(list1.map((f) => f.name).sort()).toEqual(["flow-a", "flow-b"]);
    expect(list2[0].name).toBe("flow-c");
  });
});
