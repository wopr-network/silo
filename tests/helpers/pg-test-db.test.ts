import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "./pg-test-db.js";
import { flowDefinitions } from "../../src/repositories/drizzle/schema.js";

describe("PGlite bootstrap", () => {
  let close: () => Promise<void>;
  let db: TestDb;

  afterEach(async () => {
    if (close) await close();
  });

  it("creates tables and accepts inserts", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    await db.insert(flowDefinitions).values({
      id: "test-id",
      tenantId: "tenant-1",
      name: "test-flow",
      initialState: "backlog",
    });
    const rows = await db.select().from(flowDefinitions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe("tenant-1");
    expect(rows[0].name).toBe("test-flow");
    expect(rows[0].paused).toBe(false);
  });

  it("enforces composite unique constraint (tenant_id, name)", async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    await db.insert(flowDefinitions).values({
      id: "flow-1",
      tenantId: "tenant-1",
      name: "my-flow",
      initialState: "backlog",
    });

    // Same name, different tenant — should succeed
    await db.insert(flowDefinitions).values({
      id: "flow-2",
      tenantId: "tenant-2",
      name: "my-flow",
      initialState: "backlog",
    });

    // Same name, same tenant — should fail
    await expect(
      db.insert(flowDefinitions).values({
        id: "flow-3",
        tenantId: "tenant-1",
        name: "my-flow",
        initialState: "backlog",
      }),
    ).rejects.toThrow();

    const rows = await db.select().from(flowDefinitions);
    expect(rows).toHaveLength(2);
  });
});
