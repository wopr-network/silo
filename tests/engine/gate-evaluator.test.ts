import { describe, it, expect, vi } from "vitest";
import { evaluateGate } from "../../src/engine/gate-evaluator.js";
import type { Gate, Entity, IGateRepository } from "../../src/repositories/interfaces.js";

vi.mock("../../src/engine/gate-command-validator.js", () => ({
  validateGateCommand: () => ({ valid: true, resolvedPath: null, error: null }),
}));

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: "gate-1",
    name: "lint-check",
    type: "command",
    command: "echo ok",
    functionRef: null,
    apiConfig: null,
    timeoutMs: 30000,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
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
    ...overrides,
  };
}

describe("evaluateGate", () => {
  it("returns passed=true for command gate that succeeds", async () => {
    const gate = makeGate({ type: "command", command: "echo ok" });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: true, output: "ok", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(true);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", true, expect.any(String));
  });

  it("returns passed=false for command gate that fails", async () => {
    const gate = makeGate({ type: "command", command: "exit 1" });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.any(String));
  });

  it("returns passed=false when command times out", async () => {
    const gate = makeGate({ type: "command", command: "sleep 10", timeoutMs: 50 });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "timeout", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
  });

  it("throws for function type gates", async () => {
    const gate = makeGate({ type: "function", functionRef: "myFn" });
    const entity = makeEntity();
    const gateRepo = {} as IGateRepository;

    await expect(evaluateGate(gate, entity, gateRepo)).rejects.toThrow("Function gates not yet implemented");
  });

  it("returns passed=false when apiConfig is missing", async () => {
    const gate = makeGate({ type: "api", apiConfig: null });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "Gate apiConfig is not configured", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toBe("Gate apiConfig is not configured");
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, "Gate apiConfig is not configured");
  });

  it("returns passed=false and records when apiConfig is missing", async () => {
    const gate = makeGate({ type: "api", apiConfig: null });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, "Gate apiConfig is not configured");
  });

  it("returns passed=false when Handlebars template is malformed", async () => {
    const gate = makeGate({
      type: "api",
      apiConfig: { url: "https://example.com/{{unclosed" },
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/Template error/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/Template error/));
  });

  it("returns passed=false when rendered URL uses non-https protocol", async () => {
    const gate = makeGate({
      type: "api",
      apiConfig: { url: "http://example.com/check" },
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/URL protocol not allowed/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/URL protocol not allowed/));
  });

  it("returns passed=true for api gate with matching status", async () => {
    const gate = makeGate({
      type: "api",
      apiConfig: { url: "https://example.com/check/{{id}}", method: "GET", expectStatus: 200 },
    });
    const entity = makeEntity({ id: "ent-42" });
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-42", gateId: "gate-1",
        passed: true, output: "HTTP 200", evaluatedAt: new Date(),
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    try {
      const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
      expect(result.passed).toBe(true);
      expect(result.output).toBe("HTTP 200");
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/check/ent-42", expect.objectContaining({ method: "GET" }));
      expect(gateRepo.record).toHaveBeenCalledWith("ent-42", "gate-1", true, "HTTP 200");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns passed=false for api gate with non-matching status", async () => {
    const gate = makeGate({
      type: "api",
      apiConfig: { url: "https://example.com/check", method: "POST", expectStatus: 200 },
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "HTTP 500", evaluatedAt: new Date(),
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({ status: 500 });
    vi.stubGlobal("fetch", mockFetch);

    try {
      const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
      expect(result.passed).toBe(false);
      expect(result.output).toBe("HTTP 500");
      expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, "HTTP 500");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns passed=false when api gate fetch throws", async () => {
    const gate = makeGate({
      type: "api",
      apiConfig: { url: "https://example.com/check" },
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "fetch failed", evaluatedAt: new Date(),
      }),
    };

    const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", mockFetch);

    try {
      const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
      expect(result.passed).toBe(false);
      expect(result.output).toBe("fetch failed");
      expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, "fetch failed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults method to GET and expectStatus to 200 for api gate", async () => {
    const gate = makeGate({
      type: "api",
      apiConfig: { url: "https://example.com/health" },
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: true, output: "HTTP 200", evaluatedAt: new Date(),
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    try {
      const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
      expect(result.passed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/health", expect.objectContaining({ method: "GET" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws for unknown gate types", async () => {
    const gate = makeGate({ type: "webhook" });
    const entity = makeEntity();
    const gateRepo = {} as IGateRepository;

    await expect(evaluateGate(gate, entity, gateRepo)).rejects.toThrow("Unknown gate type: webhook");
  });
});
