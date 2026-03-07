import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DrizzleFlowRepository } from "../../../src/repositories/drizzle/flow.repo.js";
import type { IFlowRepository } from "../../../src/repositories/interfaces.js";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let repo: IFlowRepository;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./drizzle" });
  repo = new DrizzleFlowRepository(db);
});

afterEach(() => {
  sqlite.close();
});

describe("DrizzleFlowRepository", () => {
  describe("create", () => {
    it("creates a flow with default values", async () => {
      const flow = await repo.create({
        name: "test-flow",
        initialState: "open",
      });
      expect(flow.id).toBeDefined();
      expect(flow.name).toBe("test-flow");
      expect(flow.initialState).toBe("open");
      expect(flow.version).toBe(1);
      expect(flow.maxConcurrent).toBe(0);
      expect(flow.maxConcurrentPerRepo).toBe(0);
      expect(flow.states).toEqual([]);
      expect(flow.transitions).toEqual([]);
      expect(flow.createdAt).toBeInstanceOf(Date);
      expect(flow.updatedAt).toBeInstanceOf(Date);
    });

    it("creates a flow with all optional fields", async () => {
      const flow = await repo.create({
        name: "full-flow",
        description: "A test flow",
        entitySchema: { type: "object" },
        initialState: "draft",
        maxConcurrent: 5,
        maxConcurrentPerRepo: 2,
        createdBy: "admin",
      });
      expect(flow.description).toBe("A test flow");
      expect(flow.entitySchema).toEqual({ type: "object" });
      expect(flow.maxConcurrent).toBe(5);
      expect(flow.maxConcurrentPerRepo).toBe(2);
      expect(flow.createdBy).toBe("admin");
    });
  });

  describe("get", () => {
    it("returns null for non-existent id", async () => {
      const result = await repo.get("non-existent");
      expect(result).toBeNull();
    });

    it("returns flow with empty states and transitions", async () => {
      const created = await repo.create({ name: "g", initialState: "s" });
      const found = await repo.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.states).toEqual([]);
      expect(found!.transitions).toEqual([]);
    });
  });

  describe("getByName", () => {
    it("returns null for non-existent name", async () => {
      const result = await repo.getByName("nope");
      expect(result).toBeNull();
    });

    it("finds flow by name", async () => {
      const created = await repo.create({ name: "named-flow", initialState: "init" });
      const found = await repo.getByName("named-flow");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });
  });

  describe("update", () => {
    it("updates flow fields and bumps updatedAt", async () => {
      const flow = await repo.create({ name: "u", initialState: "s" });
      const updated = await repo.update(flow.id, { description: "changed" });
      expect(updated.description).toBe("changed");
      expect(updated.updatedAt!.getTime()).toBeGreaterThanOrEqual(flow.updatedAt!.getTime());
    });

    it("throws for non-existent flow", async () => {
      await expect(repo.update("bad-id", { description: "x" })).rejects.toThrow("Flow not found");
    });
  });

  describe("addState", () => {
    it("adds a state to a flow", async () => {
      const flow = await repo.create({ name: "sf", initialState: "open" });
      const state = await repo.addState(flow.id, { name: "open", mode: "active" });
      expect(state.id).toBeDefined();
      expect(state.flowId).toBe(flow.id);
      expect(state.name).toBe("open");
      expect(state.mode).toBe("active");

      const hydrated = await repo.get(flow.id);
      expect(hydrated!.states).toHaveLength(1);
      expect(hydrated!.states[0].name).toBe("open");
    });

    it("defaults mode to passive", async () => {
      const flow = await repo.create({ name: "sf2", initialState: "open" });
      const state = await repo.addState(flow.id, { name: "open" });
      expect(state.mode).toBe("passive");
    });
  });

  describe("updateState", () => {
    it("updates state fields", async () => {
      const flow = await repo.create({ name: "us", initialState: "s" });
      const state = await repo.addState(flow.id, { name: "s" });
      const updated = await repo.updateState(state.id, { promptTemplate: "Do {{thing}}" });
      expect(updated.promptTemplate).toBe("Do {{thing}}");
    });

    it("no-ops gracefully when changes is empty", async () => {
      const flow = await repo.create({ name: "us-noop", initialState: "s" });
      const state = await repo.addState(flow.id, { name: "s", mode: "active" });
      const result = await repo.updateState(state.id, {});
      expect(result.mode).toBe("active");
    });

    it("throws for non-existent state", async () => {
      await expect(repo.updateState("bad", { name: "x" })).rejects.toThrow("State not found");
    });
  });

  describe("addTransition", () => {
    it("adds a transition rule to a flow", async () => {
      const flow = await repo.create({ name: "tf", initialState: "open" });
      const t = await repo.addTransition(flow.id, {
        fromState: "open",
        toState: "closed",
        trigger: "close",
        priority: 10,
      });
      expect(t.id).toBeDefined();
      expect(t.flowId).toBe(flow.id);
      expect(t.fromState).toBe("open");
      expect(t.toState).toBe("closed");
      expect(t.trigger).toBe("close");
      expect(t.priority).toBe(10);
      expect(t.createdAt).toBeInstanceOf(Date);

      const hydrated = await repo.get(flow.id);
      expect(hydrated!.transitions).toHaveLength(1);
    });
  });

  describe("updateTransition", () => {
    it("updates transition fields", async () => {
      const flow = await repo.create({ name: "ut", initialState: "s" });
      const t = await repo.addTransition(flow.id, {
        fromState: "s",
        toState: "d",
        trigger: "go",
      });
      const updated = await repo.updateTransition(t.id, { condition: "x > 5", priority: 99 });
      expect(updated.condition).toBe("x > 5");
      expect(updated.priority).toBe(99);
    });

    it("no-ops gracefully when changes is empty", async () => {
      const flow = await repo.create({ name: "ut-noop", initialState: "s" });
      const t = await repo.addTransition(flow.id, { fromState: "s", toState: "d", trigger: "go", priority: 5 });
      const result = await repo.updateTransition(t.id, {});
      expect(result.priority).toBe(5);
    });

    it("throws for non-existent transition", async () => {
      await expect(repo.updateTransition("bad", { priority: 1 })).rejects.toThrow("Transition not found");
    });
  });

  describe("snapshot and restore", () => {
    it("snapshots current flow state", async () => {
      const flow = await repo.create({ name: "snap", initialState: "open" });
      await repo.addState(flow.id, { name: "open" });
      await repo.addState(flow.id, { name: "closed" });
      await repo.addTransition(flow.id, { fromState: "open", toState: "closed", trigger: "close" });

      const ver = await repo.snapshot(flow.id);
      expect(ver.version).toBe(1);
      expect(ver.flowId).toBe(flow.id);
      expect(ver.createdAt).toBeInstanceOf(Date);
      const snap = ver.snapshot as { name: string; initialState: string; states: unknown[]; transitions: unknown[] };
      expect(snap.states).toHaveLength(2);
      expect(snap.transitions).toHaveLength(1);
      // Snapshot must include top-level flow metadata, not just states/transitions
      expect(snap.name).toBe("snap");
      expect(snap.initialState).toBe("open");
    });

    it("auto-increments version", async () => {
      const flow = await repo.create({ name: "snap2", initialState: "s" });
      const v1 = await repo.snapshot(flow.id);
      const v2 = await repo.snapshot(flow.id);
      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
    });

    it("throws for non-existent flow", async () => {
      await expect(repo.snapshot("bad")).rejects.toThrow("Flow not found");
    });

    it("restores flow to a previous version", async () => {
      const flow = await repo.create({ name: "restore-test", initialState: "open" });
      await repo.addState(flow.id, { name: "open" });
      await repo.addState(flow.id, { name: "review" });
      await repo.addTransition(flow.id, { fromState: "open", toState: "review", trigger: "submit" });

      // Snapshot v1 (2 states, 1 transition)
      await repo.snapshot(flow.id);

      // Modify: add a third state and another transition
      await repo.addState(flow.id, { name: "closed" });
      await repo.addTransition(flow.id, { fromState: "review", toState: "closed", trigger: "approve" });

      // Verify modified state (3 states, 2 transitions)
      const modified = await repo.get(flow.id);
      expect(modified!.states).toHaveLength(3);
      expect(modified!.transitions).toHaveLength(2);

      // Restore to v1
      await repo.restore(flow.id, 1);

      // Verify restored state (2 states, 1 transition)
      const restored = await repo.get(flow.id);
      expect(restored!.states).toHaveLength(2);
      expect(restored!.transitions).toHaveLength(1);
      expect(restored!.states.map((s) => s.name).sort()).toEqual(["open", "review"]);
      expect(restored!.transitions[0].trigger).toBe("submit");
    });

    it("restores top-level flow metadata from snapshot", async () => {
      const flow = await repo.create({
        name: "meta-flow",
        description: "original description",
        initialState: "open",
        maxConcurrent: 3,
        maxConcurrentPerRepo: 1,
        createdBy: "user-a",
      });

      // Snapshot v1
      await repo.snapshot(flow.id);

      // Modify top-level metadata
      await repo.update(flow.id, {
        name: "meta-flow-modified",
        description: "changed description",
        initialState: "closed",
        maxConcurrent: 10,
        maxConcurrentPerRepo: 5,
      });

      // Confirm mutation
      const modified = await repo.get(flow.id);
      expect(modified!.name).toBe("meta-flow-modified");

      // Restore to v1
      await repo.restore(flow.id, 1);

      // Top-level metadata must be restored
      const restored = await repo.get(flow.id);
      expect(restored!.name).toBe("meta-flow");
      expect(restored!.description).toBe("original description");
      expect(restored!.initialState).toBe("open");
      expect(restored!.maxConcurrent).toBe(3);
      expect(restored!.maxConcurrentPerRepo).toBe(1);
      expect(restored!.createdBy).toBe("user-a");
    });

    it("throws for non-existent version", async () => {
      const flow = await repo.create({ name: "nosnap", initialState: "s" });
      await expect(repo.restore(flow.id, 99)).rejects.toThrow("Version 99 not found");
    });
  });
});
