import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveRunner } from "../../src/execution/active-runner.js";
import type { ActiveRunnerDeps } from "../../src/execution/active-runner.js";
import type { Invocation } from "../../src/repositories/interfaces.js";

function makeInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: "inv-1",
    entityId: "entity-1",
    stage: "review",
    mode: "active",
    prompt: "Do something",
    context: { systemPrompt: "You are a reviewer", userContent: "Please review" },
    claimedBy: "active-runner",
    claimedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    signal: null,
    artifacts: null,
    error: null,
    ttlMs: 30000,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ActiveRunnerDeps> = {}): ActiveRunnerDeps {
  return {
    engine: {
      processSignal: vi.fn().mockResolvedValue({ gated: false }),
    } as any,
    aiAdapter: {
      invoke: vi.fn().mockResolvedValue({ content: "SIGNAL: done" }),
    } as any,
    invocationRepo: {
      findUnclaimedActive: vi.fn().mockResolvedValue([]),
      claim: vi.fn().mockResolvedValue(makeInvocation()),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(makeInvocation()),
    } as any,
    entityRepo: {
      get: vi.fn().mockResolvedValue(null),
      updateArtifacts: vi.fn().mockResolvedValue(undefined),
    } as any,
    flowRepo: {
      get: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(null),
    } as any,
    ...overrides,
  };
}

describe("sleep() abort listener cleanup", () => {
  it("removes the abort listener after normal timeout completes", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const signal = controller.signal;
    const removeSpy = vi.spyOn(signal, "removeEventListener");

    // Directly exercise sleep via ActiveRunner by triggering a gate-timeout re-queue
    // which calls sleep(30000, signal). Let the sleep complete normally, then verify cleanup.
    const invocation = makeInvocation({ context: null });
    const deps = makeDeps({
      invocationRepo: {
        findUnclaimedActive: vi.fn().mockResolvedValue([invocation]),
        claim: vi.fn().mockResolvedValue(invocation),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(undefined),
      } as any,
      engine: {
        processSignal: vi.fn().mockResolvedValue({ gated: true, gateTimedOut: true }),
      } as any,
    });

    const runner = new ActiveRunner(deps);
    const runPromise = runner.run({ signal, once: true });

    // Advance past the 30s backoff so sleep completes normally (not via abort)
    await vi.advanceTimersByTimeAsync(30001);
    await runPromise;

    // The abort listener must have been removed on normal timer completion
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    vi.useRealTimers();
  });
});

describe("context preservation on re-queue", () => {
  it("passes original invocation context when re-queuing after gate timeout", async () => {
    const invocation = makeInvocation({
      context: { systemPrompt: "sys", userContent: "user" },
    });

    const createMock = vi.fn().mockResolvedValue(makeInvocation());
    const deps = makeDeps({
      invocationRepo: {
        findUnclaimedActive: vi.fn().mockResolvedValue([invocation]),
        claim: vi.fn().mockResolvedValue(invocation),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
        create: createMock,
      } as any,
      engine: {
        processSignal: vi.fn().mockResolvedValue({ gated: true, gateTimedOut: true }),
      } as any,
    });

    vi.useFakeTimers();
    const runner = new ActiveRunner(deps);
    const controller = new AbortController();
    const runPromise = runner.run({ signal: controller.signal, once: true });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(30001);
    await runPromise.catch(() => {});
    vi.useRealTimers();

    expect(createMock).toHaveBeenCalled();
    const callArgs = createMock.mock.calls[0];
    // 6th argument is context (index 5)
    expect(callArgs[5]).toEqual({ systemPrompt: "sys", userContent: "user" });
  });

  it("passes original invocation context when re-queuing after processSignal error", async () => {
    const invocation = makeInvocation({
      context: { systemPrompt: "sys", userContent: "user" },
    });

    const createMock = vi.fn().mockResolvedValue(makeInvocation());
    const deps = makeDeps({
      invocationRepo: {
        findUnclaimedActive: vi.fn().mockResolvedValue([invocation]),
        claim: vi.fn().mockResolvedValue(invocation),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
        create: createMock,
      } as any,
      engine: {
        processSignal: vi.fn().mockRejectedValue(new Error("signal processing failed")),
      } as any,
    });

    const runner = new ActiveRunner(deps);
    await runner["processInvocation"](invocation);

    expect(createMock).toHaveBeenCalled();
    const callArgs = createMock.mock.calls[0];
    // context should include original fields plus retryCount incremented from 0 to 1
    expect(callArgs[5]).toMatchObject({ systemPrompt: "sys", userContent: "user", retryCount: 1 });
  });
});

describe("maxRetries guard on processSignal error", () => {
  it("stops re-queuing after 3 processSignal errors and marks entity as stuck", async () => {
    const invocation = makeInvocation({
      context: { retryCount: 3 },
    });

    const createMock = vi.fn().mockResolvedValue(makeInvocation());
    const updateArtifactsMock = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      invocationRepo: {
        findUnclaimedActive: vi.fn().mockResolvedValue([invocation]),
        claim: vi.fn().mockResolvedValue(invocation),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
        create: createMock,
      } as any,
      engine: {
        processSignal: vi.fn().mockRejectedValue(new Error("persistent error")),
      } as any,
      entityRepo: {
        get: vi.fn().mockResolvedValue(null),
        updateArtifacts: updateArtifactsMock,
      } as any,
    });

    const runner = new ActiveRunner(deps);
    await runner["processInvocation"](invocation);

    // Should NOT create a replacement invocation
    expect(createMock).not.toHaveBeenCalled();
    // Should mark the entity as stuck
    expect(updateArtifactsMock).toHaveBeenCalledWith(
      invocation.entityId,
      expect.objectContaining({ stuck: true }),
    );
  });

  it("re-queues with incremented retryCount when below max retries", async () => {
    const invocation = makeInvocation({
      context: { retryCount: 1 },
    });

    const createMock = vi.fn().mockResolvedValue(makeInvocation());
    const deps = makeDeps({
      invocationRepo: {
        findUnclaimedActive: vi.fn().mockResolvedValue([invocation]),
        claim: vi.fn().mockResolvedValue(invocation),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
        create: createMock,
      } as any,
      engine: {
        processSignal: vi.fn().mockRejectedValue(new Error("transient error")),
      } as any,
    });

    const runner = new ActiveRunner(deps);
    await runner["processInvocation"](invocation);

    expect(createMock).toHaveBeenCalled();
    const callArgs = createMock.mock.calls[0];
    // context should have retryCount incremented to 2
    expect(callArgs[5]).toMatchObject({ retryCount: 2 });
  });
});
