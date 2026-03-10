import { describe, expect, it, vi } from "vitest";
import type { GateEvalResult } from "../../src/engine/gate-evaluator.js";
import { evaluateGateForAllRepos } from "../../src/engine/gate-evaluator.js";
import type { Entity, Gate, IGateRepository } from "../../src/repositories/interfaces.js";

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: "gate-1",
    name: "review-bots-ready",
    type: "command",
    command: "gates/review-bots-ready.sh {{prNumber}} {{repo}}",
    outcomes: null,
    timeoutMs: null,
    functionRef: null,
    apiConfig: null,
    failurePrompt: null,
    timeoutPrompt: null,
    ...overrides,
  };
}

function makeEntity(artifacts: Record<string, unknown>): Entity {
  return {
    id: "entity-1",
    flowId: "flow-1",
    state: "reviewing",
    refs: null,
    artifacts,
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
  };
}

const mockGateRepo = {} as IGateRepository;

describe("evaluateGateForAllRepos", () => {
  it("returns passed=true when all repos pass", async () => {
    const entity = makeEntity({
      repos: ["wopr-network/wopr-platform", "wopr-network/platform-core"],
      prs: {
        "wopr-platform": "https://github.com/wopr-network/wopr-platform/pull/10",
        "platform-core": "https://github.com/wopr-network/platform-core/pull/20",
      },
    });
    const evalFn = vi.fn<(...args: unknown[]) => Promise<GateEvalResult>>().mockResolvedValue({
      passed: true,
      timedOut: false,
      output: "ok",
    });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.passed).toBe(true);
    expect(evalFn).toHaveBeenCalledTimes(2);
  });

  it("returns passed=false when one repo fails (short-circuits)", async () => {
    const entity = makeEntity({
      repos: ["wopr-network/wopr-platform", "wopr-network/platform-core"],
      prs: {
        "wopr-platform": "https://github.com/wopr-network/wopr-platform/pull/10",
        "platform-core": "https://github.com/wopr-network/platform-core/pull/20",
      },
    });
    const evalFn = vi
      .fn<(...args: unknown[]) => Promise<GateEvalResult>>()
      .mockResolvedValueOnce({ passed: true, timedOut: false, output: "ok" })
      .mockResolvedValueOnce({ passed: false, timedOut: false, output: "CI failed" });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("platform-core");
  });

  it("falls back to single evaluation when no prs map exists", async () => {
    const entity = makeEntity({});
    const evalFn = vi.fn<(...args: unknown[]) => Promise<GateEvalResult>>().mockResolvedValue({
      passed: true,
      timedOut: false,
      output: "ok",
    });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.passed).toBe(true);
    expect(evalFn).toHaveBeenCalledTimes(1);
    // Should be called with the original entity (no _currentRepo enrichment)
    expect(evalFn.mock.calls[0][1]).toBe(entity);
  });

  it("injects _currentRepo and _currentPrNumber into per-repo entity", async () => {
    const entity = makeEntity({
      repos: ["wopr-network/wopr-platform"],
      prs: {
        "wopr-platform": "https://github.com/wopr-network/wopr-platform/pull/42",
      },
    });
    const evalFn = vi.fn<(...args: unknown[]) => Promise<GateEvalResult>>().mockResolvedValue({
      passed: true,
      timedOut: false,
      output: "ok",
    });

    await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);

    const calledEntity = evalFn.mock.calls[0][1] as Entity;
    expect(calledEntity.artifacts?._currentRepo).toBe("wopr-network/wopr-platform");
    expect(calledEntity.artifacts?._currentRepoName).toBe("wopr-platform");
    expect(calledEntity.artifacts?._currentPrNumber).toBe("42");
    expect(calledEntity.artifacts?._currentPrUrl).toBe(
      "https://github.com/wopr-network/wopr-platform/pull/42",
    );
  });

  it("aggregates output from all repos when all pass", async () => {
    const entity = makeEntity({
      repos: ["wopr-network/a", "wopr-network/b"],
      prs: {
        a: "https://github.com/wopr-network/a/pull/1",
        b: "https://github.com/wopr-network/b/pull/2",
      },
    });
    const evalFn = vi
      .fn<(...args: unknown[]) => Promise<GateEvalResult>>()
      .mockResolvedValueOnce({ passed: true, timedOut: false, output: "green" })
      .mockResolvedValueOnce({ passed: true, timedOut: false, output: "green" });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.output).toBe("[a] green\n[b] green");
  });
});
