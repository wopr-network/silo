import { describe, expect, it, vi } from "vitest";
import { evaluateGate, hydrateTemplate } from "../../src/engine/gate-evaluator.js";
import type { Entity, Gate } from "../../src/repositories/interfaces.js";

const baseEntity: Entity = {
  id: "e1",
  flowId: "f1",
  state: "open",
  refs: null,
  artifacts: null,
  claimedBy: null,
  claimedAt: null,
  flowVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: "g1",
    name: "test-gate",
    type: "command",
    command: "echo hello",
    functionRef: null,
    apiConfig: null,
    timeoutMs: 5000,
    ...overrides,
  };
}

// ─── hydrateTemplate ───

describe("hydrateTemplate", () => {
  it("replaces entity placeholders", () => {
    const result = hydrateTemplate("echo {{entity.id}}", {
      entity: { id: "e1", state: "open" },
    });
    expect(result).toBe("echo e1");
  });

  it("returns raw string when no placeholders", () => {
    expect(hydrateTemplate("pnpm test", {})).toBe("pnpm test");
  });
});

// ─── evaluateGate — shell ───

describe("evaluateGate — shell", () => {
  it("passes when command exits 0", async () => {
    const gate = makeGate({ command: "echo ok" });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(true);
    expect(result.output).toContain("ok");
  });

  it("fails when command exits non-zero", async () => {
    const gate = makeGate({ command: "false" });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
  });

  it("fails with descriptive message when command is null", async () => {
    const gate = makeGate({ command: null });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toBe("Gate command is not configured");
  });

  it("fails with descriptive message when command is empty string", async () => {
    const gate = makeGate({ command: "" });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toBe("Gate command is not configured");
  });

  it("respects timeout", async () => {
    const gate = makeGate({ command: "sleep 10", timeoutMs: 100 });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/timed out|ETIMEDOUT|killed/i);
  }, 2000);

  it("hydrates entity placeholders in command", async () => {
    const gate = makeGate({ command: "echo {{entity.id}}" });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(true);
    expect(result.output).toContain("e1");
  });
});

// ─── evaluateGate — function ───

describe("evaluateGate — function", () => {
  it("fails when functionRef is null", async () => {
    const gate = makeGate({ type: "function", command: null, functionRef: null });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("not configured");
  });

  it("fails when functionRef has no colon separator", async () => {
    const gate = makeGate({ type: "function", command: null, functionRef: "no-colon" });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Invalid function_ref format");
  });

  it("fails when module cannot be imported", async () => {
    const gate = makeGate({
      type: "function",
      command: null,
      functionRef: "/nonexistent/module.js:check",
    });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
  });

  it("calls function and returns its result when it passes", async () => {
    const gate = makeGate({
      type: "function",
      command: null,
      functionRef: new URL("./fixtures/passing-gate.js", import.meta.url).pathname + ":check",
    });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(true);
    expect(result.output).toBe("all good");
  });

  it("respects timeout on slow function", async () => {
    const gate = makeGate({
      type: "function",
      command: null,
      functionRef: new URL("./fixtures/slow-gate.js", import.meta.url).pathname + ":check",
      timeoutMs: 50,
    });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/timed out/i);
  }, 2000);
});

// ─── evaluateGate — api ───

describe("evaluateGate — api", () => {
  it("fails when apiConfig is null", async () => {
    const gate = makeGate({ type: "api", command: null, apiConfig: null });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("not configured");
  });

  it("fails when apiConfig has no url", async () => {
    const gate = makeGate({ type: "api", command: null, apiConfig: { method: "GET" } });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("url");
  });

  it("passes when response status matches expect_status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("OK"),
    }));
    const gate = makeGate({
      type: "api",
      command: null,
      apiConfig: {
        url: "http://localhost:9999/health",
        method: "GET",
        expect_status: 200,
      },
    });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(true);
    vi.unstubAllGlobals();
  });

  it("fails when response status does not match expect_status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }));
    const gate = makeGate({
      type: "api",
      command: null,
      apiConfig: {
        url: "http://localhost:9999/health",
        method: "GET",
        expect_status: 200,
      },
    });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("500");
    vi.unstubAllGlobals();
  });

  it("hydrates entity placeholders in URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("OK"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const gate = makeGate({
      type: "api",
      command: null,
      apiConfig: {
        url: "http://localhost:9999/entity/{{entity.id}}",
        method: "GET",
        expect_status: 200,
      },
    });
    await evaluateGate(gate, baseEntity);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9999/entity/e1",
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });

  it("respects timeout via AbortSignal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException("aborted", "AbortError")), 200);
      }),
    ));
    const gate = makeGate({
      type: "api",
      command: null,
      apiConfig: {
        url: "http://localhost:9999/slow",
        method: "GET",
        expect_status: 200,
      },
      timeoutMs: 50,
    });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/timed out|aborted/i);
    vi.unstubAllGlobals();
  }, 2000);
});

// ─── evaluateGate — unknown type ───

describe("evaluateGate — unknown type", () => {
  it("fails with descriptive message for unknown gate type", async () => {
    const gate = makeGate({ type: "webhook" as string });
    const result = await evaluateGate(gate, baseEntity);
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Unknown gate type");
  });
});
