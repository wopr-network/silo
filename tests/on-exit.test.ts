import { describe, expect, it, vi } from "vitest";
import { executeOnExit } from "../src/engine/on-exit.js";
import type { Entity, Flow, OnExitConfig } from "../src/repositories/interfaces.js";
import type { AdapterRegistry } from "../src/integrations/registry.js";

function makeEntity(overrides?: Partial<Entity>): Entity {
  return {
    id: "entity-1",
    flowId: "flow-1",
    state: "coding",
    refs: { github: { adapter: "github", id: "wopr-network/wopr", repo: "wopr-network/wopr" } },
    artifacts: { worktreePath: "/tmp/wt-123" },
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    affinityWorkerId: null,
    affinityRole: null,
    affinityExpiresAt: null,
    parentEntityId: null,
    ...overrides,
  };
}

function makeFlow(overrides?: Partial<Flow>): Flow {
  return {
    id: "flow-1",
    name: "test-flow",
    description: null,
    entitySchema: null,
    initialState: "triage",
    maxConcurrent: 0,
    maxConcurrentPerRepo: 0,
    affinityWindowMs: 300000,
    claimRetryAfterMs: null,
    gateTimeoutMs: null,
    version: 1,
    createdBy: null,
    discipline: null,
    defaultModelTier: null,
    timeoutPrompt: null,
    paused: false,
    issueTrackerIntegrationId: null,
    vcsIntegrationId: "vcs-integration-1",
    createdAt: null,
    updatedAt: null,
    states: [],
    transitions: [],
    ...overrides,
  };
}

describe("executeOnExit", () => {
  it("dispatches op via adapter registry and returns success", async () => {
    const registry = {
      execute: vi.fn().mockResolvedValue({}),
    } as unknown as AdapterRegistry;
    const config: OnExitConfig = { op: "vcs.cleanup_worktree", params: { path: "{{entity.artifacts.worktreePath}}" } };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(registry.execute).toHaveBeenCalledWith(
      "vcs-integration-1",
      "vcs.cleanup_worktree",
      { path: "/tmp/wt-123" },
      expect.any(AbortSignal),
    );
  });

  it("returns error when adapter registry is not available", async () => {
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), null);
    expect(result.error).toContain("AdapterRegistry not available");
  });

  it("returns error when flow has no matching integration", async () => {
    const registry = { execute: vi.fn() } as unknown as AdapterRegistry;
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow({ vcsIntegrationId: null }), registry);
    expect(result.error).toContain("no vcs integration configured");
  });

  it("returns error on op failure without throwing", async () => {
    const registry = {
      execute: vi.fn().mockRejectedValue(new Error("cleanup failed")),
    } as unknown as AdapterRegistry;
    const config: OnExitConfig = { op: "vcs.cleanup_worktree" };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toContain("cleanup failed");
    expect(result.timedOut).toBe(false);
  });

  it("returns timedOut on timeout without throwing", async () => {
    const timeoutErr = new DOMException("signal timed out", "TimeoutError");
    const registry = {
      execute: vi.fn().mockRejectedValue(timeoutErr),
    } as unknown as AdapterRegistry;
    const config: OnExitConfig = { op: "vcs.cleanup_worktree", timeout_ms: 50 };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toContain("timed out");
    expect(result.timedOut).toBe(true);
  });

  it("returns error on template rendering failure without throwing", async () => {
    const registry = { execute: vi.fn() } as unknown as AdapterRegistry;
    const config: OnExitConfig = { op: "vcs.cleanup_worktree", params: { bad: "{{#each broken" } };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toContain("onExit template error");
    expect(result.timedOut).toBe(false);
  });

  it("renders Handlebars params with entity data", async () => {
    const registry = {
      execute: vi.fn().mockResolvedValue({}),
    } as unknown as AdapterRegistry;
    const config: OnExitConfig = {
      op: "vcs.cleanup_worktree",
      params: { worktreePath: "{{entity.artifacts.worktreePath}}" },
    };
    const result = await executeOnExit(config, makeEntity(), makeFlow(), registry);
    expect(result.error).toBeNull();
    expect(registry.execute).toHaveBeenCalledWith(
      "vcs-integration-1",
      "vcs.cleanup_worktree",
      { worktreePath: "/tmp/wt-123" },
      expect.any(AbortSignal),
    );
  });
});
