import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import { DrizzleDomainEventRepository } from "../../src/repositories/drizzle/domain-event.repo.js";

const TENANT = "t_test";

describe("DrizzleDomainEventRepository CAS", () => {
  let db: TestDb;
  let client: PGlite;
  let close: () => Promise<void>;
  let repo: DrizzleDomainEventRepository;

  beforeEach(async () => {
    ({ db, client, close } = await createTestDb());
    await client.exec(
      `INSERT INTO flow_definitions (id, tenant_id, name, initial_state) VALUES ('f1', '${TENANT}', 'test', 'open')`,
    );
    await client.exec(
      `INSERT INTO entities (id, tenant_id, flow_id, state, created_at, updated_at) VALUES ('e1', '${TENANT}', 'f1', 'open', 0, 0)`,
    );
    repo = new DrizzleDomainEventRepository(db, TENANT);
  });

  afterEach(async () => {
    await close();
  });

  it("getLastSequence returns 0 for entity with no events", async () => {
    const seq = await repo.getLastSequence("e1");
    expect(seq).toBe(0);
  });

  it("getLastSequence returns max sequence after appends", async () => {
    await repo.append("test.event", "e1", { foo: 1 });
    await repo.append("test.event", "e1", { foo: 2 });
    const seq = await repo.getLastSequence("e1");
    expect(seq).toBe(2);
  });

  it("appendCas succeeds when expectedSequence matches", async () => {
    await repo.append("test.event", "e1", { setup: true });
    // last sequence is now 1
    const result = await repo.appendCas("invocation.claimed", "e1", { agentId: "agent:coder" }, 1);
    expect(result).not.toBeNull();
    expect(result!.sequence).toBe(2);
    expect(result!.type).toBe("invocation.claimed");
  });

  it("appendCas returns null when expectedSequence is stale", async () => {
    await repo.append("test.event", "e1", { setup: true });
    await repo.append("test.event", "e1", { raced: true });
    // last sequence is now 2, but caller thinks it's 1
    const result = await repo.appendCas("invocation.claimed", "e1", { agentId: "agent:coder" }, 1);
    expect(result).toBeNull();
  });

  it("appendCas returns null on concurrent race (same expectedSequence)", async () => {
    // Both try to append at sequence 1 (no prior events)
    const r1 = await repo.appendCas("invocation.claimed", "e1", { agentId: "agent:a" }, 0);
    const r2 = await repo.appendCas("invocation.claimed", "e1", { agentId: "agent:b" }, 0);
    expect(r1).not.toBeNull();
    expect(r2).toBeNull();
  });
});
