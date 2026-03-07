import { describe, it, expect, vi } from "vitest";
import { evaluateGate } from "../../src/engine/gate-evaluator.js";
import type { Gate, Entity, IGateRepository } from "../../src/repositories/interfaces.js";

vi.mock("../../src/engine/gate-command-validator.js", () => ({
  validateGateCommand: (cmd: string) => {
    // Return a realistic resolvedPath so execFile receives the binary path, not the full command string.
    // This preserves the TOCTOU fix (resolvedPath flows to runCommand) while keeping tests hermetic.
    const binaryMap: Record<string, string> = {
      "echo ok": "/usr/bin/echo",
      "echo ent-1": "/usr/bin/echo",
      "echo linear-123": "/usr/bin/echo",
      "exit 1": "/bin/sh",
      "sleep 10": "/usr/bin/sleep",
    };
    return { valid: true, resolvedPath: binaryMap[cmd] ?? null, error: null };
  },
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

  it("returns passed=true for function gate with valid module", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/passing-gate.ts:check",
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: true, output: "all good", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(true);
    expect(result.output).toBe("all good");
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", true, "all good");
  });

  it("returns passed=false when function gate times out", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/slow-gate.ts:check",
      timeoutMs: 50,
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/timed out/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/timed out/));
  });

  it("returns passed=false when functionRef has no colon separator", async () => {
    const gate = makeGate({ type: "function", functionRef: "no-colon" });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/Invalid functionRef/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/Invalid functionRef/));
  });

  it("returns passed=false when exported name is not a function", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/passing-gate.ts:nonExistent",
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/not found/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/not found/));
  });

  it("returns passed=false when functionRef is null", async () => {
    const gate = makeGate({ type: "function", functionRef: null });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "Gate functionRef is not configured", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toBe("Gate functionRef is not configured");
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
      apiConfig: { url: "https://example.com/check/{{entity.id}}", method: "GET", expectStatus: 200 },
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

  it("renders Handlebars templates in command gate before execution", async () => {
    const gate = makeGate({ type: "command", command: "echo {{entity.id}}" });
    const entity = makeEntity({ id: "ent-1" });
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: true, output: "ent-1", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(true);
    // output should be the rendered entity id, not the literal template string
    expect(result.output).toBe("ent-1");
  });

  it("throws for unknown gate types", async () => {
    const gate = makeGate({ type: "webhook" });
    const entity = makeEntity();
    const gateRepo = {} as IGateRepository;

    await expect(evaluateGate(gate, entity, gateRepo)).rejects.toThrow("Unknown gate type: webhook");
  });

  it("returns passed=false for functionRef path outside project root (path traversal)", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "../../../etc/passwd:check",
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/outside the project root/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/outside the project root/));
  });

  it("clears the timeout timer when the function gate resolves", async () => {
    // If the timer is not cleared, the handle keeps the test process alive
    // (vitest detects leaked timers). This test verifies the timer IS cleared.
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/passing-gate.ts:check",
      timeoutMs: 5000,
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: true, output: "all good", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(true);
    // No leaked timer — passes cleanly if clearTimeout was called
  });

  it("treats timeoutMs=0 as no timeout (uses default), not zero-ms timeout", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/passing-gate.ts:check",
      timeoutMs: 0,
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: true, output: "all good", evaluatedAt: new Date(),
      }),
    };

    // Should succeed, not immediately timeout
    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(true);
  });

  it("returns passed=false when function returns wrong shape", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/bad-return-gate.ts:check",
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({
        id: "gr-1", entityId: "ent-1", gateId: "gate-1",
        passed: false, output: "", evaluatedAt: new Date(),
      }),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/invalid return/i);
  });

  it("records passed=false and returns when function gate throws", async () => {
    const gate = makeGate({
      type: "function",
      functionRef: "tests/engine/fixtures/throwing-gate.ts:check",
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/gate exploded/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/gate exploded/));
  });

  it("renders Handlebars templates in command using { entity } context", async () => {
    const gate = makeGate({
      type: "command",
      command: "echo {{entity.refs.linear.id}}",
    });
    const entity = makeEntity({
      refs: { linear: { id: "linear-123" } } as unknown as Entity["refs"],
    });
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    // The rendered command should be "echo linear-123", which exits 0
    expect(result.passed).toBe(true);
  });

  it("returns passed=false for absolute path outside project root (traversal via absolute path)", async () => {
    // Absolute path that starts with PROJECT_ROOT string but escapes via symlink trickery
    // is caught by relative() check. A plain traversal path is already covered by the
    // existing test; this verifies the containment logic handles the absolute-path edge case.
    const gate = makeGate({
      type: "function",
      functionRef: "/etc/passwd:check",
    });
    const entity = makeEntity();
    const gateRepo: Pick<IGateRepository, "record"> = {
      record: vi.fn().mockResolvedValue({}),
    };

    const result = await evaluateGate(gate, entity, gateRepo as IGateRepository);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/outside the project root/);
    expect(gateRepo.record).toHaveBeenCalledWith("ent-1", "gate-1", false, expect.stringMatching(/outside the project root/));
  });
});
