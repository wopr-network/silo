import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { EngineEvent, IEventBusAdapter } from "../../src/adapters/interfaces.js";

// Integration test scaffold — wired up to real repos when WOP-1814 Drizzle
// implementations are available. For now it exercises the migration path.

describe("Engine integration (in-memory SQLite)", () => {
  let sqlite: Database.Database;
  let events: EngineEvent[];

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: "./drizzle" });

    events = [];
  });

  afterEach(() => {
    sqlite.close();
  });

  it("in-memory SQLite migrations run without error", () => {
    // Verifies the migration files are valid against a fresh DB.
    expect(sqlite.open).toBe(true);
  });

  it("full pipeline: create flow → create entity → processSignal through states (placeholder)", async () => {
    // PLACEHOLDER: uncomment and wire up real Drizzle repo implementations
    // from WOP-1814 when they land.
    //
    // const eventEmitter: IEventBusAdapter = {
    //   emit: async (e) => { events.push(e); },
    // };
    // const engine = new Engine({ entityRepo, flowRepo, invocationRepo, gateRepo,
    //   transitionLogRepo, adapters: new Map(), eventEmitter });
    //
    // const flow = await flowRepo.create({ name: "ci-pipeline", initialState: "open" });
    // await flowRepo.addState(flow.id, { name: "open", agentRole: "planner", mode: "active", promptTemplate: "Plan" });
    // await flowRepo.addState(flow.id, { name: "coding", agentRole: "coder", mode: "active", promptTemplate: "Code" });
    // await flowRepo.addState(flow.id, { name: "done" });
    // await flowRepo.addTransition(flow.id, { fromState: "open", toState: "coding", trigger: "plan_complete" });
    // await flowRepo.addTransition(flow.id, { fromState: "coding", toState: "done", trigger: "code_complete" });
    //
    // const entity = await engine.createEntity("ci-pipeline");
    // expect(entity.state).toBe("open");
    //
    // const r1 = await engine.processSignal(entity.id, "plan_complete");
    // expect(r1.newState).toBe("coding");
    //
    // const r2 = await engine.processSignal(entity.id, "code_complete");
    // expect(r2.newState).toBe("done");
    //
    // const history = await transitionLogRepo.historyFor(entity.id);
    // expect(history.map(h => h.toState)).toEqual(["open", "coding", "done"]);

    expect(true).toBe(true);
  });
});
