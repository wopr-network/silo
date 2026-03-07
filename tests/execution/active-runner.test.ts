import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActiveRunner } from "../../src/execution/active-runner.js";
import type { Engine } from "../../src/engine/engine.js";
import type { IAIProviderAdapter } from "../../src/adapters/interfaces.js";
import type { IInvocationRepository, Invocation, IEntityRepository, IFlowRepository } from "../../src/repositories/interfaces.js";

function mockInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: "inv-1",
    entityId: "ent-1",
    stage: "coding",
    agentRole: "coder",
    mode: "active",
    prompt: "Write the code",
    context: null,
    claimedBy: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    signal: null,
    artifacts: null,
    error: null,
    ttlMs: 1800000,
    ...overrides,
  };
}

describe("ActiveRunner", () => {
  let engine: { processSignal: ReturnType<typeof vi.fn> };
  let aiAdapter: IAIProviderAdapter;
  let invocationRepo: {
    findUnclaimedActive: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
  };
  let entityRepo: { get: ReturnType<typeof vi.fn> };
  let flowRepo: { get: ReturnType<typeof vi.fn>; getByName: ReturnType<typeof vi.fn> };
  let runner: ActiveRunner;

  beforeEach(() => {
    engine = { processSignal: vi.fn().mockResolvedValue({ newState: "review", gated: false, terminal: false, gatesPassed: [] }) };
    aiAdapter = { invoke: vi.fn().mockResolvedValue({ content: "SIGNAL: done\n\nARTIFACTS:\n{\"files\": [\"main.ts\"]}" }) };
    invocationRepo = {
      findUnclaimedActive: vi.fn().mockResolvedValue([]),
      claim: vi.fn().mockResolvedValue(null),
      complete: vi.fn().mockResolvedValue(mockInvocation({ completedAt: new Date() })),
      fail: vi.fn().mockResolvedValue(mockInvocation({ failedAt: new Date() })),
    };
    entityRepo = {
      get: vi.fn().mockResolvedValue({ id: "ent-1", flowId: "flow-1", state: "coding", refs: null, artifacts: null, claimedBy: null, claimedAt: null, flowVersion: 1, createdAt: new Date(), updatedAt: new Date() }),
    };
    flowRepo = {
      get: vi.fn().mockResolvedValue({ id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "execution", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [{ id: "t1", flowId: "flow-1", fromState: "coding", toState: "review", trigger: "done", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null }], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null }),
      getByName: vi.fn().mockResolvedValue(null),
    };
    runner = new ActiveRunner({
      engine: engine as unknown as Engine,
      aiAdapter,
      invocationRepo: invocationRepo as unknown as IInvocationRepository,
      entityRepo: entityRepo as unknown as IEntityRepository,
      flowRepo: flowRepo as unknown as IFlowRepository,
    });
  });

  it("returns immediately in --once mode when no work is available", async () => {
    invocationRepo.findUnclaimedActive.mockResolvedValue([]);
    await runner.run({ once: true });
    expect(invocationRepo.findUnclaimedActive).toHaveBeenCalledOnce();
    expect(aiAdapter.invoke).not.toHaveBeenCalled();
  });

  it("claims, invokes AI, parses response, and calls processSignal", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });

    await runner.run({ once: true });

    expect(invocationRepo.claim).toHaveBeenCalledWith("inv-1", "active-runner");
    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-sonnet-4-6", systemPrompt: expect.any(String) });
    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "done", { files: ["main.ts"] }, "inv-1");
    expect(invocationRepo.complete).toHaveBeenCalledWith("inv-1", "done", { files: ["main.ts"] });
  });

  it("maps reasoning tier to claude-opus-4-6", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "reasoning", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [{ id: "t1", flowId: "flow-1", fromState: "coding", toState: "review", trigger: "done", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null }], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-opus-4-6", systemPrompt: expect.any(String) });
  });

  it("maps monitoring tier to claude-haiku-4-5", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "monitoring", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [{ id: "t1", flowId: "flow-1", fromState: "coding", toState: "review", trigger: "done", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null }], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-haiku-4-5", systemPrompt: expect.any(String) });
  });

  it("defaults to execution tier when modelTier is null", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: null, mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [{ id: "t1", flowId: "flow-1", fromState: "coding", toState: "review", trigger: "done", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null }], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-sonnet-4-6", systemPrompt: expect.any(String) });
  });

  it("skips when claim returns null (race condition)", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue(null);

    await runner.run({ once: true });

    expect(aiAdapter.invoke).not.toHaveBeenCalled();
    expect(engine.processSignal).not.toHaveBeenCalled();
  });

  it("fails invocation when response has no SIGNAL line", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "I did the thing but no signal" });

    await runner.run({ once: true });

    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", expect.stringContaining("No SIGNAL found"));
    expect(engine.processSignal).not.toHaveBeenCalled();
  });

  it("fails invocation when AI adapter throws", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API timeout"));

    await runner.run({ once: true });

    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", "API timeout");
    expect(engine.processSignal).not.toHaveBeenCalled();
  });

  it("parses response with ARTIFACTS as empty object when missing", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "execution", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }],
      transitions: [{ id: "t1", flowId: "flow-1", fromState: "coding", toState: "done", trigger: "complete", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null }],
      initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "SIGNAL: complete" });

    await runner.run({ once: true });

    expect(invocationRepo.complete).toHaveBeenCalledWith("inv-1", "complete", {});
    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "complete", {}, "inv-1");
  });

  it("stops on abort signal", async () => {
    const controller = new AbortController();
    invocationRepo.findUnclaimedActive.mockResolvedValue([]);

    // Abort after first poll
    invocationRepo.findUnclaimedActive.mockImplementation(async () => {
      controller.abort();
      return [];
    });

    await runner.run({ signal: controller.signal });

    expect(invocationRepo.findUnclaimedActive).toHaveBeenCalledOnce();
  });

  it("fails invocation when processSignal throws (not swallowed)", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    engine.processSignal.mockRejectedValue(new Error("transition not found"));

    await runner.run({ once: true });

    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "done", { files: ["main.ts"] }, "inv-1");
    expect(invocationRepo.complete).not.toHaveBeenCalled();
    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", "transition not found");
  });

  it("logs and continues when complete() throws after successful processSignal", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    invocationRepo.complete.mockRejectedValue(new Error("db write failed"));

    await runner.run({ once: true });

    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "done", { files: ["main.ts"] }, "inv-1");
    expect(invocationRepo.complete).toHaveBeenCalledWith("inv-1", "done", { files: ["main.ts"] });
    // complete() threw but the runner should not rethrow — loop continues
    expect(invocationRepo.fail).not.toHaveBeenCalled();
  });

  it("filters by flowName when provided", async () => {
    flowRepo.getByName.mockResolvedValue({ id: "flow-42", name: "deploy" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([]);

    await runner.run({ once: true, flowName: "deploy" });

    expect(flowRepo.getByName).toHaveBeenCalledWith("deploy");
    expect(invocationRepo.findUnclaimedActive).toHaveBeenCalledWith("flow-42");
  });

  it("rejects signal not valid for entity's current state", async () => {
    const inv = mockInvocation({ stage: "reviewing" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "SIGNAL: merged" });

    entityRepo.get.mockResolvedValue({
      id: "ent-1", flowId: "flow-1", state: "reviewing", refs: null, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", initialState: "backlog", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
      states: [
        { name: "reviewing", modelTier: "execution", mode: "active", agentRole: "reviewer", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" },
      ],
      transitions: [
        { id: "t1", flowId: "flow-1", fromState: "reviewing", toState: "merging", trigger: "clean", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null },
        { id: "t2", flowId: "flow-1", fromState: "reviewing", toState: "fixing", trigger: "issues", gateId: null, condition: null, priority: 1, spawnFlow: null, spawnTemplate: null, createdAt: null },
      ],
    });

    await runner.run({ once: true });

    expect(engine.processSignal).not.toHaveBeenCalled();
    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", expect.stringContaining('Invalid signal "merged"'));
  });

  it("accepts signal that is a valid trigger for the entity's current state", async () => {
    const inv = mockInvocation({ stage: "reviewing" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "SIGNAL: clean" });

    entityRepo.get.mockResolvedValue({
      id: "ent-1", flowId: "flow-1", state: "reviewing", refs: null, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", initialState: "backlog", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
      states: [
        { name: "reviewing", modelTier: "execution", mode: "active", agentRole: "reviewer", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" },
      ],
      transitions: [
        { id: "t1", flowId: "flow-1", fromState: "reviewing", toState: "merging", trigger: "clean", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null },
        { id: "t2", flowId: "flow-1", fromState: "reviewing", toState: "fixing", trigger: "issues", gateId: null, condition: null, priority: 1, spawnFlow: null, spawnTemplate: null, createdAt: null },
      ],
    });

    await runner.run({ once: true });

    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "clean", {}, "inv-1");
  });

  it("blocks prompt injection: signal valid in another state but not the current one", async () => {
    const inv = mockInvocation({ stage: "coding" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "SIGNAL: clean" });

    entityRepo.get.mockResolvedValue({
      id: "ent-1", flowId: "flow-1", state: "coding", refs: null, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", initialState: "backlog", maxConcurrent: 0, maxConcurrentPerRepo: 0,
      version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
      states: [
        { name: "coding", modelTier: "execution", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" },
      ],
      transitions: [
        { id: "t1", flowId: "flow-1", fromState: "coding", toState: "reviewing", trigger: "pr_created", gateId: null, condition: null, priority: 0, spawnFlow: null, spawnTemplate: null, createdAt: null },
      ],
    });

    await runner.run({ once: true });

    expect(engine.processSignal).not.toHaveBeenCalled();
    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", expect.stringContaining('Invalid signal "clean"'));
  });

  it("fails stale invocation when invocation.stage does not match entity.state", async () => {
    // invocation was created when entity was in "coding" but entity has since transitioned to "reviewing"
    const inv = mockInvocation({ stage: "coding" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    entityRepo.get.mockResolvedValue({
      id: "ent-1", flowId: "flow-1", state: "reviewing", refs: null, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).not.toHaveBeenCalled();
    expect(engine.processSignal).not.toHaveBeenCalled();
    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", expect.stringContaining("stale invocation: stage mismatch"));
  });

  it("proceeds normally when invocation.stage matches entity.state", async () => {
    const inv = mockInvocation({ stage: "coding" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    // entity.state matches invocation.stage
    entityRepo.get.mockResolvedValue({
      id: "ent-1", flowId: "flow-1", state: "coding", refs: null, artifacts: null,
      claimedBy: null, claimedAt: null, flowVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalled();
    expect(invocationRepo.fail).not.toHaveBeenCalledWith("inv-1", expect.stringContaining("stale invocation"));
  });

  it("fails invocation when entity is null (fail closed on signal validation)", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    entityRepo.get.mockResolvedValue(null);

    await runner.run({ once: true });

    expect(aiAdapter.invoke).not.toHaveBeenCalled();
    expect(engine.processSignal).not.toHaveBeenCalled();
    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", expect.stringContaining("entity or flow not found"));
  });

  it("fails invocation when flow is null (fail closed on signal validation)", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue(null);

    await runner.run({ once: true });

    expect(aiAdapter.invoke).not.toHaveBeenCalled();
    expect(engine.processSignal).not.toHaveBeenCalled();
    expect(invocationRepo.fail).toHaveBeenCalledWith("inv-1", expect.stringContaining("entity or flow not found"));
  });

  it("uses systemPrompt and userContent from invocation context when present", async () => {
    const inv = mockInvocation({
      context: {
        systemPrompt: "Custom security instructions from template",
        userContent: "<external-data>\n{\"id\":\"ent-1\"}\n</external-data>",
      },
    });
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });

    await runner.run({ once: true });

    const invokeCall = (aiAdapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(invokeCall[0]).toContain("<external-data>");
    expect(invokeCall[1].systemPrompt).toContain("Custom security instructions from template");
  });

  it("passes systemPrompt to AI adapter on every invoke", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });

    await runner.run({ once: true });

    const invokeCall = (aiAdapter.invoke as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(invokeCall[1]).toHaveProperty("model");
    expect(invokeCall[1]).toHaveProperty("systemPrompt");
    expect(typeof invokeCall[1].systemPrompt).toBe("string");
    expect(invokeCall[1].systemPrompt.length).toBeGreaterThan(0);
  });
});
