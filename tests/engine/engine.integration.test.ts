import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { EngineEvent, IEventBusAdapter } from "../../src/engine/event-types.js";
import { Engine } from "../../src/engine/engine.js";
import {
  DrizzleEntityRepository,
  DrizzleEventRepository,
  DrizzleFlowRepository,
  DrizzleGateRepository,
  DrizzleInvocationRepository,
  DrizzleTransitionLogRepository,
} from "../../src/repositories/drizzle/index.js";
import * as schema from "../../src/repositories/drizzle/schema.js";
import { loadSeed } from "../../src/config/seed-loader.js";
import { callToolHandler } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import { withTransaction as wt } from "../../src/main.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function setupEngine() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const events: EngineEvent[] = [];
  const eventEmitter: IEventBusAdapter = {
    emit: async (e) => {
      events.push(e);
    },
  };

  const entityRepo = new DrizzleEntityRepository(db);
  const flowRepo = new DrizzleFlowRepository(db);
  const invocationRepo = new DrizzleInvocationRepository(db);
  const gateRepo = new DrizzleGateRepository(db);
  const transitionLogRepo = new DrizzleTransitionLogRepository(db);
  const eventRepo = new DrizzleEventRepository(db);

  const engine = new Engine({
    entityRepo,
    flowRepo,
    invocationRepo,
    gateRepo,
    transitionLogRepo,
    adapters: new Map(),
    eventEmitter,
    sqlite,
    withTransaction: (fn) => wt(sqlite, fn),
  });

  return {
    sqlite,
    db,
    events,
    engine,
    entityRepo,
    flowRepo,
    invocationRepo,
    gateRepo,
    transitionLogRepo,
    eventRepo,
  };
}

describe("Engine integration (in-memory SQLite)", () => {
  let ctx: ReturnType<typeof setupEngine>;

  beforeEach(() => {
    ctx = setupEngine();
  });

  afterEach(() => {
    ctx.sqlite.close();
  });

  it("in-memory SQLite migrations run without error", () => {
    expect(ctx.sqlite.open).toBe(true);
  });

  it("happy path: seed load → entity create → signal through to terminal", async () => {
    const seedPath = resolve(__dirname, "fixtures/simple-flow.seed.json");
    const seedResult = await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });
    expect(seedResult.flows).toBe(1);

    const entity = await ctx.engine.createEntity("simple-pipeline");
    expect(entity.state).toBe("backlog");

    const r1 = await ctx.engine.processSignal(entity.id, "assigned");
    expect(r1.newState).toBe("coding");
    expect(r1.gated).toBe(false);
    expect(r1.terminal).toBe(false);
    expect(typeof r1.invocationId).toBe("string");
    expect(r1.invocationId!.length).toBeGreaterThan(0);

    const r2 = await ctx.engine.processSignal(entity.id, "completed");
    expect(r2.newState).toBe("done");
    expect(r2.terminal).toBe(true);
    expect(r2.invocationId).toBeUndefined();

    const history = await ctx.transitionLogRepo.historyFor(entity.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.toState)).toEqual(["coding", "done"]);

    const transitionEvents = ctx.events.filter((e) => e.type === "entity.transitioned");
    expect(transitionEvents).toHaveLength(2);

    const finalEntity = await ctx.entityRepo.get(entity.id);
    expect(finalEntity!.state).toBe("done");
  });

  it("gate evaluation: gate blocks → update gate → gate passes", async () => {
    const seedPath = resolve(__dirname, "fixtures/gated-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("gated-pipeline");
    expect(entity.state).toBe("coding");

    const r1 = await ctx.engine.processSignal(entity.id, "submit");
    expect(r1.gated).toBe(true);
    expect(r1.newState).toBeUndefined();
    expect(r1.gateName).toBe("score-check");

    const blockedEntity = await ctx.entityRepo.get(entity.id);
    expect(blockedEntity!.state).toBe("coding");
    const failures = blockedEntity!.artifacts?.gate_failures as Array<Record<string, unknown>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].gateName).toBe("score-check");

    const gateFailEvents = ctx.events.filter((e) => e.type === "gate.failed");
    expect(gateFailEvents).toHaveLength(1);

    const gates = await ctx.gateRepo.listAll();
    const scoreGate = gates.find((g) => g.name === "score-check")!;
    await ctx.gateRepo.update(scoreGate.id, { command: "gates/test-pass.sh" });

    const r2 = await ctx.engine.processSignal(entity.id, "submit");
    expect(r2.gated).toBe(false);
    expect(r2.newState).toBe("reviewing");

    const gatePassEvents = ctx.events.filter((e) => e.type === "gate.passed");
    expect(gatePassEvents).toHaveLength(1);

    const gateResults = await ctx.gateRepo.resultsFor(entity.id);
    expect(gateResults.length).toBeGreaterThanOrEqual(2);
    expect(gateResults).toContainEqual(expect.objectContaining({ passed: true }));
  });

  it("multi-gate lifecycle: seed → create → gate fail → retry → advance through all gates to terminal", async () => {
    const seedPath = resolve(__dirname, "fixtures/multi-gate-pipeline.seed.json");
    const seedResult = await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });
    expect(seedResult.flows).toBe(1);
    expect(seedResult.gates).toBe(3);

    // Step 1: Create entity — starts in "todo"
    const entity = await ctx.engine.createEntity("multi-gate-pipeline");
    expect(entity.state).toBe("todo");

    // Step 2: Signal "start" — ready-check gate passes → transitions to "coding"
    const r1 = await ctx.engine.processSignal(entity.id, "start");
    expect(r1.gated).toBe(false);
    expect(r1.newState).toBe("coding");
    expect(r1.terminal).toBe(false);
    expect(r1.gatesPassed).toContain("ready-check");

    // Verify entity state updated
    const afterR1 = await ctx.entityRepo.get(entity.id);
    expect(afterR1!.state).toBe("coding");

    // Verify gate.passed event emitted
    const gatePassedEvents1 = ctx.events.filter(
      (e) => e.type === "gate.passed" && e.entityId === entity.id,
    );
    expect(gatePassedEvents1).toHaveLength(1);

    // Step 3: Signal "submit" — code-quality gate FAILS (throwing-gate.ts throws)
    const r2 = await ctx.engine.processSignal(entity.id, "submit");
    expect(r2.gated).toBe(true);
    expect(r2.newState).toBeUndefined();
    expect(r2.gateName).toBe("code-quality");

    // Verify entity still in "coding"
    const afterR2 = await ctx.entityRepo.get(entity.id);
    expect(afterR2!.state).toBe("coding");

    // Verify gate_failures artifact recorded
    const failures = afterR2!.artifacts?.gate_failures as Array<Record<string, unknown>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].gateName).toBe("code-quality");

    // Verify gate.failed event emitted
    const gateFailedEvents = ctx.events.filter(
      (e) => e.type === "gate.failed" && e.entityId === entity.id,
    );
    expect(gateFailedEvents).toHaveLength(1);

    // Step 4: Fix the gate — update code-quality to use the passing command
    const gates = await ctx.gateRepo.listAll();
    const codeQualityGate = gates.find((g) => g.name === "code-quality")!;
    await ctx.gateRepo.update(codeQualityGate.id, {
      command: "gates/test-pass.sh",
    });

    // Step 5: Retry "submit" — code-quality gate now passes → transitions to "reviewing"
    const r3 = await ctx.engine.processSignal(entity.id, "submit");
    expect(r3.gated).toBe(false);
    expect(r3.newState).toBe("reviewing");
    expect(r3.terminal).toBe(false);
    expect(r3.gatesPassed).toContain("code-quality");

    // Verify entity state updated
    const afterR3 = await ctx.entityRepo.get(entity.id);
    expect(afterR3!.state).toBe("reviewing");

    // Verify gate_failures cleared after successful transition
    const clearedFailures = afterR3!.artifacts?.gate_failures as Array<unknown>;
    expect(clearedFailures).toEqual([]);

    // Step 6: Signal "approve" — review-approval gate passes → transitions to "done" (terminal)
    const r4 = await ctx.engine.processSignal(entity.id, "approve");
    expect(r4.gated).toBe(false);
    expect(r4.newState).toBe("done");
    expect(r4.terminal).toBe(true);
    expect(r4.gatesPassed).toContain("review-approval");

    // Verify final entity state
    const finalEntity = await ctx.entityRepo.get(entity.id);
    expect(finalEntity!.state).toBe("done");

    // Step 7: Assert complete transition log
    const history = await ctx.transitionLogRepo.historyFor(entity.id);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.fromState)).toEqual(["todo", "coding", "reviewing"]);
    expect(history.map((h) => h.toState)).toEqual(["coding", "reviewing", "done"]);
    expect(history.map((h) => h.trigger)).toEqual(["start", "submit", "approve"]);

    // Step 8: Assert event summary
    const transitionEvents = ctx.events.filter(
      (e) => e.type === "entity.transitioned" && e.entityId === entity.id,
    );
    expect(transitionEvents).toHaveLength(3);

    const allGatePassedEvents = ctx.events.filter(
      (e) => e.type === "gate.passed" && e.entityId === entity.id,
    );
    expect(allGatePassedEvents).toHaveLength(3); // ready-check, code-quality (retry), review-approval

    // Gate results recorded in DB
    const gateResults = await ctx.gateRepo.resultsFor(entity.id);
    // 1 fail (code-quality initial) + 3 passes (ready-check, code-quality retry, review-approval)
    expect(gateResults).toHaveLength(4);
    expect(gateResults.filter((r) => !r.passed)).toHaveLength(1);
    expect(gateResults.filter((r) => r.passed)).toHaveLength(3);
  });

  it("multi-entity concurrency: 10 entities reach correct states independently", async () => {
    const seedPath = resolve(__dirname, "fixtures/simple-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entities = await Promise.all(Array.from({ length: 10 }, () => ctx.engine.createEntity("simple-pipeline")));
    expect(entities).toHaveLength(10);
    for (const e of entities) {
      expect(e.state).toBe("backlog");
    }

    const r1s = await Promise.all(entities.map((e) => ctx.engine.processSignal(e.id, "assigned")));
    for (const r of r1s) {
      expect(r.newState).toBe("coding");
    }

    const r2s = await Promise.all(entities.map((e) => ctx.engine.processSignal(e.id, "completed")));
    for (const r of r2s) {
      expect(r.newState).toBe("done");
      expect(r.terminal).toBe(true);
    }

    for (const e of entities) {
      const final = await ctx.entityRepo.get(e.id);
      expect(final!.state).toBe("done");
    }

    const transitionEvents = ctx.events.filter((e) => e.type === "entity.transitioned");
    expect(transitionEvents).toHaveLength(20);
  });

  it("spawn flow: parent terminal transition spawns child entity", async () => {
    const seedPath = resolve(__dirname, "fixtures/spawn-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const parentEntity = await ctx.engine.createEntity("parent-flow");
    expect(parentEntity.state).toBe("working");

    const result = await ctx.engine.processSignal(parentEntity.id, "finish");
    expect(result.newState).toBe("completed");
    expect(result.terminal).toBe(true);
    expect(result.spawned).toBeInstanceOf(Array);
    expect(result.spawned!.length).toBeGreaterThan(0);
    expect(typeof result.spawned![0]).toBe("string");
    expect(result.spawned).toHaveLength(1);

    const spawnEvents = ctx.events.filter((e) => e.type === "flow.spawned");
    expect(spawnEvents).toHaveLength(1);

    const childFlow = await ctx.flowRepo.getByName("child-flow");
    expect(childFlow).not.toBeNull();
    const childEntities = await ctx.entityRepo.findByFlowAndState(childFlow!.id, "pending");
    expect(childEntities).toHaveLength(1);

    const childResult = await ctx.engine.processSignal(childEntities[0].id, "process");
    expect(childResult.newState).toBe("child-done");
    expect(childResult.terminal).toBe(true);
  });

  it("MCP flow: claim → get_prompt → report through to terminal via callToolHandler", async () => {
    const seedPath = resolve(__dirname, "fixtures/simple-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("simple-pipeline");
    const r1 = await ctx.engine.processSignal(entity.id, "assigned");
    expect(r1.newState).toBe("coding");
    expect(typeof r1.invocationId).toBe("string");
    expect(r1.invocationId!.length).toBeGreaterThan(0);

    const mcpDeps: McpServerDeps = {
      entities: ctx.entityRepo,
      flows: ctx.flowRepo,
      invocations: ctx.invocationRepo,
      gates: ctx.gateRepo,
      transitions: ctx.transitionLogRepo,
      eventRepo: ctx.eventRepo,
      engine: ctx.engine,
    };

    const claimResult = await callToolHandler(mcpDeps, "flow.claim", { workerId: "wkr_test", role: "coder" });
    expect(claimResult.isError).toBeUndefined();
    const claimData = JSON.parse(claimResult.content[0].text) as {
      entity_id: string;
      invocation_id: string;
      prompt: string;
    } | null;
    expect(claimData).not.toBeNull();
    expect(claimData!.entity_id).toBe(entity.id);
    expect(typeof claimData!.invocation_id).toBe("string");
    expect(claimData!.prompt).toContain(entity.id);

    const promptResult = await callToolHandler(mcpDeps, "flow.get_prompt", { entity_id: entity.id });
    expect(promptResult.isError).toBeUndefined();
    const promptData = JSON.parse(promptResult.content[0].text) as { prompt: string };
    expect(typeof promptData.prompt).toBe("string");
    expect(promptData.prompt.length).toBeGreaterThan(0);

    const reportResult = await callToolHandler(mcpDeps, "flow.report", {
      entity_id: entity.id,
      signal: "completed",
      artifacts: { result: "success" },
    });
    expect(reportResult.isError).toBeUndefined();
    const reportData = JSON.parse(reportResult.content[0].text) as {
      new_state: string;
      next_action: string;
    };
    expect(reportData.new_state).toBe("done");
    expect(reportData.next_action).toBe("completed");

    const finalEntity = await ctx.entityRepo.get(entity.id);
    expect(finalEntity!.state).toBe("done");
  });

  it("multi-gate traversal: two sequential gates pass, assertions at each boundary", async () => {
    const seedPath = resolve(__dirname, "fixtures/multi-gate-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("multi-gate-pipeline");
    expect(entity.state).toBe("draft");

    // Gate 1: lint-check on draft→review
    const r1 = await ctx.engine.processSignal(entity.id, "submit");
    expect(r1.gated).toBe(false);
    expect(r1.newState).toBe("review");
    expect(r1.gatesPassed).toContain("lint-check");
    expect(r1.terminal).toBe(false);

    const afterR1 = await ctx.entityRepo.get(entity.id);
    expect(afterR1!.state).toBe("review");

    // Gate 2: deploy-check on review→staging
    const r2 = await ctx.engine.processSignal(entity.id, "approve");
    expect(r2.gated).toBe(false);
    expect(r2.newState).toBe("staging");
    expect(r2.gatesPassed).toContain("deploy-check");
    expect(r2.terminal).toBe(false);

    const afterR2 = await ctx.entityRepo.get(entity.id);
    expect(afterR2!.state).toBe("staging");

    // Final ungated transition: staging→released
    const r3 = await ctx.engine.processSignal(entity.id, "ship");
    expect(r3.gated).toBe(false);
    expect(r3.newState).toBe("released");
    expect(r3.gatesPassed).toEqual([]);
    expect(r3.terminal).toBe(true);

    // Verify gate results recorded for both gates
    const gateResults = await ctx.gateRepo.resultsFor(entity.id);
    const passedGates = gateResults.filter((r) => r.passed);
    expect(passedGates).toHaveLength(2);

    // Verify gate.passed events for both gates
    const gatePassEvents = ctx.events.filter((e) => e.type === "gate.passed");
    expect(gatePassEvents).toHaveLength(2);
  });

  it("transition history: full audit trail with correct from/to/trigger for every step", async () => {
    const seedPath = resolve(__dirname, "fixtures/multi-gate-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("multi-gate-pipeline");

    await ctx.engine.processSignal(entity.id, "submit");
    await ctx.engine.processSignal(entity.id, "approve");
    await ctx.engine.processSignal(entity.id, "ship");

    const history = await ctx.transitionLogRepo.historyFor(entity.id);
    expect(history).toHaveLength(3);

    expect(history[0].fromState).toBe("draft");
    expect(history[0].toState).toBe("review");
    expect(history[0].trigger).toBe("submit");

    expect(history[1].fromState).toBe("review");
    expect(history[1].toState).toBe("staging");
    expect(history[1].trigger).toBe("approve");

    expect(history[2].fromState).toBe("staging");
    expect(history[2].toState).toBe("released");
    expect(history[2].trigger).toBe("ship");

    // Timestamps are monotonically increasing
    for (let i = 1; i < history.length; i++) {
      expect(history[i].timestamp.getTime()).toBeGreaterThanOrEqual(history[i - 1].timestamp.getTime());
    }
  });

  it("event coverage: entity.created + entity.transitioned emitted for full lifecycle", async () => {
    const seedPath = resolve(__dirname, "fixtures/multi-gate-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("multi-gate-pipeline");

    await ctx.engine.processSignal(entity.id, "submit");
    await ctx.engine.processSignal(entity.id, "approve");
    await ctx.engine.processSignal(entity.id, "ship");

    // entity.created
    const createdEvents = ctx.events.filter((e) => e.type === "entity.created");
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].entityId).toBe(entity.id);

    // entity.transitioned — one per signal
    const transitionEvents = ctx.events.filter((e) => e.type === "entity.transitioned");
    expect(transitionEvents).toHaveLength(3);

    const transitions = transitionEvents as Array<{
      type: "entity.transitioned";
      entityId: string;
      fromState: string;
      toState: string;
      trigger: string;
    }>;
    expect(transitions[0].fromState).toBe("draft");
    expect(transitions[0].toState).toBe("review");
    expect(transitions[0].trigger).toBe("submit");

    expect(transitions[1].fromState).toBe("review");
    expect(transitions[1].toState).toBe("staging");
    expect(transitions[1].trigger).toBe("approve");

    expect(transitions[2].fromState).toBe("staging");
    expect(transitions[2].toState).toBe("released");
    expect(transitions[2].trigger).toBe("ship");

    // gate.passed — 2 gated transitions
    const gatePassedEvents = ctx.events.filter((e) => e.type === "gate.passed");
    expect(gatePassedEvents).toHaveLength(2);

    // All events have entityId matching our entity
    const allEntityEvents = ctx.events.filter(
      (e) => "entityId" in e && e.entityId === entity.id,
    );
    // entity.created(1) + entity.transitioned(3) + gate.passed(2) = 6
    expect(allEntityEvents).toHaveLength(6);
  });

  it("gate timeout: gate times out → gateTimedOut true, timeoutPrompt rendered, gate.timedOut event", async () => {
    const seedPath = resolve(__dirname, "fixtures/timeout-gate-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("timeout-pipeline");
    expect(entity.state).toBe("pending");

    const result = await ctx.engine.processSignal(entity.id, "validate");
    expect(result.gated).toBe(true);
    expect(result.gateTimedOut).toBe(true);
    expect(result.gateName).toBe("slow-gate");
    expect(result.newState).toBeUndefined();
    expect(result.terminal).toBe(false);

    // timeoutPrompt should be rendered with Handlebars
    expect(result.timeoutPrompt).toContain("slow-gate");
    expect(result.timeoutPrompt).toContain(entity.id);

    // Entity stays in pending
    const afterTimeout = await ctx.entityRepo.get(entity.id);
    expect(afterTimeout!.state).toBe("pending");

    // gate.timedOut event emitted (NOT gate.failed)
    const timedOutEvents = ctx.events.filter((e) => e.type === "gate.timedOut");
    expect(timedOutEvents).toHaveLength(1);
    expect(timedOutEvents[0].entityId).toBe(entity.id);

    const failedEvents = ctx.events.filter((e) => e.type === "gate.failed");
    expect(failedEvents).toHaveLength(0);

    // Gate failure recorded in entity artifacts
    const artifacts = afterTimeout!.artifacts as Record<string, unknown>;
    const failures = artifacts.gate_failures as Array<Record<string, unknown>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].gateName).toBe("slow-gate");
  });

  it("check_back: flow.claim returns check_back with retry_after_ms when no work available", async () => {
    // Load a flow but do NOT create any entities — no work exists
    const seedPath = resolve(__dirname, "fixtures/simple-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const mcpDeps: McpServerDeps = {
      entities: ctx.entityRepo,
      flows: ctx.flowRepo,
      invocations: ctx.invocationRepo,
      gates: ctx.gateRepo,
      transitions: ctx.transitionLogRepo,
      eventRepo: ctx.eventRepo,
      engine: ctx.engine,
    };

    const claimResult = await callToolHandler(mcpDeps, "flow.claim", { role: "coder" });
    expect(claimResult.isError).toBeUndefined();
    const data = JSON.parse(claimResult.content[0].text) as {
      next_action: string;
      retry_after_ms: number;
      message: string;
    };
    expect(data.next_action).toBe("check_back");
    expect(data.retry_after_ms).toBeGreaterThan(0);
    expect(data.message).toContain("No work available");
  });

  it("flow.fail: marks active invocation as failed via MCP callToolHandler", async () => {
    const seedPath = resolve(__dirname, "fixtures/error-terminal-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("error-pipeline");
    expect(entity.state).toBe("queued");

    // Move to working state (has promptTemplate, creates invocation)
    const r1 = await ctx.engine.processSignal(entity.id, "start");
    expect(r1.newState).toBe("working");
    expect(r1.invocationId).toBeDefined();

    const mcpDeps: McpServerDeps = {
      entities: ctx.entityRepo,
      flows: ctx.flowRepo,
      invocations: ctx.invocationRepo,
      gates: ctx.gateRepo,
      transitions: ctx.transitionLogRepo,
      eventRepo: ctx.eventRepo,
      engine: ctx.engine,
    };

    // Claim the invocation so it becomes "active"
    const claimResult = await callToolHandler(mcpDeps, "flow.claim", { role: "coder" });
    expect(claimResult.isError).toBeUndefined();
    const claimData = JSON.parse(claimResult.content[0].text);
    expect(claimData.entity_id).toBe(entity.id);

    // Call flow.fail
    const failResult = await callToolHandler(mcpDeps, "flow.fail", {
      entity_id: entity.id,
      error: "Agent encountered unrecoverable error",
    });
    expect(failResult.isError).toBeUndefined();
    const failData = JSON.parse(failResult.content[0].text) as { acknowledged: boolean };
    expect(failData.acknowledged).toBe(true);

    // Verify invocation is marked failed
    const invocations = await ctx.invocationRepo.findByEntity(entity.id);
    const failedInvocations = invocations.filter((i) => i.failedAt !== null);
    expect(failedInvocations).toHaveLength(1);

    // Entity stays in working state (flow.fail does NOT transition — it just marks invocation failed)
    const finalEntity = await ctx.entityRepo.get(entity.id);
    expect(finalEntity!.state).toBe("working");

    // After flow.fail, entity is NOT reclaimable: no unclaimed invocation exists, so flow.claim returns check_back
    const reclaimResult = await callToolHandler(mcpDeps, "flow.claim", { role: "coder" });
    expect(reclaimResult.isError).toBeUndefined();
    const reclaimData = JSON.parse(reclaimResult.content[0].text) as { next_action: string };
    expect(reclaimData.next_action).toBe("check_back");
  });

  it("processSignal is atomic: simulated crash rolls back all writes", async () => {
    const seedPath = resolve(__dirname, "fixtures/simple-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("simple-pipeline");
    expect(entity.state).toBe("backlog");

    // Snapshot pre-transition state
    const preEntity = await ctx.entityRepo.get(entity.id);
    expect(preEntity!.state).toBe("backlog");
    const preHistory = await ctx.transitionLogRepo.historyFor(entity.id);
    const preInvocations = await ctx.invocationRepo.findByEntity(entity.id);

    // Sabotage transitionLogRepo.record to throw mid-transaction
    const originalRecord = ctx.transitionLogRepo.record.bind(ctx.transitionLogRepo);
    ctx.transitionLogRepo.record = async () => {
      throw new Error("simulated crash");
    };

    // processSignal should throw
    await expect(ctx.engine.processSignal(entity.id, "assigned")).rejects.toThrow("simulated crash");

    // Restore original
    ctx.transitionLogRepo.record = originalRecord;

    // Verify rollback: entity should still be in "backlog"
    const postEntity = await ctx.entityRepo.get(entity.id);
    expect(postEntity!.state).toBe("backlog");

    // No new transition log entries
    const postHistory = await ctx.transitionLogRepo.historyFor(entity.id);
    expect(postHistory).toHaveLength(preHistory.length);

    // No new invocations created
    const postInvocations = await ctx.invocationRepo.findByEntity(entity.id);
    expect(postInvocations).toHaveLength(preInvocations.length);

    // Now do the transition for real — should succeed normally
    const result = await ctx.engine.processSignal(entity.id, "assigned");
    expect(result.newState).toBe("coding");

    const finalEntity = await ctx.entityRepo.get(entity.id);
    expect(finalEntity!.state).toBe("coding");
  });

  it("error terminal: working→error transition via fail signal", async () => {
    const seedPath = resolve(__dirname, "fixtures/error-terminal-flow.seed.json");
    await loadSeed(seedPath, ctx.flowRepo, ctx.gateRepo, { db: ctx.db });

    const entity = await ctx.engine.createEntity("error-pipeline");
    expect(entity.state).toBe("queued");

    await ctx.engine.processSignal(entity.id, "start");
    const entityInWorking = await ctx.entityRepo.get(entity.id);
    expect(entityInWorking!.state).toBe("working");

    // Transition working→error via fail signal
    const r = await ctx.engine.processSignal(entity.id, "fail");
    expect(r.newState).toBe("error");
    expect(r.terminal).toBe(true);

    const finalEntity = await ctx.entityRepo.get(entity.id);
    expect(finalEntity!.state).toBe("error");

    const history = await ctx.transitionLogRepo.historyFor(entity.id);
    expect(history.some((h) => h.fromState === "working" && h.toState === "error" && h.trigger === "fail")).toBe(true);
  });
});
