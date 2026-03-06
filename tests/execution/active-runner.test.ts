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
      get: vi.fn().mockResolvedValue({ id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "execution", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null }),
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
    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-sonnet-4-6" });
    expect(invocationRepo.complete).toHaveBeenCalledWith("inv-1", "done", { files: ["main.ts"] });
    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "done", { files: ["main.ts"] });
  });

  it("maps reasoning tier to claude-opus-4-6", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "reasoning", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-opus-4-6" });
  });

  it("maps monitoring tier to claude-haiku-4-5", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: "monitoring", mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-haiku-4-5" });
  });

  it("defaults to execution tier when modelTier is null", async () => {
    const inv = mockInvocation();
    invocationRepo.findUnclaimedActive.mockResolvedValue([inv]);
    invocationRepo.claim.mockResolvedValue({ ...inv, claimedBy: "active-runner" });
    flowRepo.get.mockResolvedValue({
      id: "flow-1", name: "dev", states: [{ name: "coding", modelTier: null, mode: "active", agentRole: "coder", promptTemplate: null, constraints: null, id: "s1", flowId: "flow-1" }], transitions: [], initialState: "coding", maxConcurrent: 0, maxConcurrentPerRepo: 0, version: 1, description: null, entitySchema: null, createdBy: null, createdAt: null, updatedAt: null,
    });

    await runner.run({ once: true });

    expect(aiAdapter.invoke).toHaveBeenCalledWith("Write the code", { model: "claude-sonnet-4-6" });
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
    (aiAdapter.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "SIGNAL: complete" });

    await runner.run({ once: true });

    expect(invocationRepo.complete).toHaveBeenCalledWith("inv-1", "complete", {});
    expect(engine.processSignal).toHaveBeenCalledWith("ent-1", "complete", {});
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

  it("filters by flowName when provided", async () => {
    flowRepo.getByName.mockResolvedValue({ id: "flow-42", name: "deploy" });
    invocationRepo.findUnclaimedActive.mockResolvedValue([]);

    await runner.run({ once: true, flowName: "deploy" });

    expect(flowRepo.getByName).toHaveBeenCalledWith("deploy");
    expect(invocationRepo.findUnclaimedActive).toHaveBeenCalledWith("flow-42");
  });
});
