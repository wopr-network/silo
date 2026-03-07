import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Gate, Entity, IGateRepository } from "../../src/repositories/interfaces.js";

// Mock ssrf-guard
vi.mock("../../src/engine/ssrf-guard.js", () => ({
  checkSsrf: vi.fn(),
}));

// Mock gate-command-validator (required by gate-evaluator)
vi.mock("../../src/engine/gate-command-validator.js", () => ({
  validateGateCommand: () => ({ valid: true, resolvedPath: null, error: null }),
}));

import { evaluateGate } from "../../src/engine/gate-evaluator.js";
import { checkSsrf } from "../../src/engine/ssrf-guard.js";

const mockCheckSsrf = vi.mocked(checkSsrf);

function makeEntity(): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "review",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeGateRepo(): IGateRepository {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as IGateRepository;
}

describe("evaluateGate SSRF integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks API gate when SSRF check fails", async () => {
    mockCheckSsrf.mockResolvedValue({
      allowed: false,
      reason: "SSRF_BLOCKED: evil.corp resolves to private/reserved address 10.0.0.1",
    });

    const gate: Gate = {
      id: "g1",
      name: "api-check",
      type: "api",
      command: null,
      functionRef: null,
      timeoutMs: 5000,
      apiConfig: { url: "https://evil.corp/meta", method: "GET", expectStatus: 200 },
    };

    const result = await evaluateGate(gate, makeEntity(), makeGateRepo());
    expect(result.passed).toBe(false);
    expect(result.output).toContain("SSRF_BLOCKED");
    expect(result.timedOut).toBe(false);
  });

  it("allows API gate when SSRF check passes", async () => {
    mockCheckSsrf.mockResolvedValue({ allowed: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
    } as Response);

    const gate: Gate = {
      id: "g1",
      name: "api-check",
      type: "api",
      command: null,
      functionRef: null,
      timeoutMs: 5000,
      apiConfig: { url: "https://example.com/health", method: "GET", expectStatus: 200 },
    };

    const result = await evaluateGate(gate, makeEntity(), makeGateRepo());
    expect(result.passed).toBe(true);
    fetchSpy.mockRestore();
  });

  it("records BLOCKED result when checkSsrf throws (malformed URL)", async () => {
    mockCheckSsrf.mockRejectedValue(new Error("Invalid URL"));

    const gate: Gate = {
      id: "g2",
      name: "bad-url-gate",
      type: "api",
      command: null,
      functionRef: null,
      timeoutMs: 5000,
      apiConfig: { url: "https://example.com/ok", method: "GET", expectStatus: 200 },
    };

    const gateRepo = makeGateRepo();
    const result = await evaluateGate(gate, makeEntity(), gateRepo);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("SSRF_BLOCKED");
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "g2", false, expect.stringContaining("SSRF_BLOCKED"));
  });
});
