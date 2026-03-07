import { describe, it, expect, vi } from "vitest";
import { evaluateGate } from "../../src/engine/gate-evaluator.js";
import type { Gate, Entity, IGateRepository } from "../../src/repositories/interfaces.js";

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: "gate-1", name: "test-gate", type: "command",
    command: "echo ok", functionRef: null, apiConfig: null, timeoutMs: 30000,
    ...overrides,
  };
}

function makeEntity(): Entity {
  return {
    id: "ent-1", flowId: "flow-1", state: "review", refs: null,
    artifacts: null, claimedBy: null, claimedAt: null, flowVersion: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

const mockGateRepo = {
  record: vi.fn().mockResolvedValue({
    id: "gr-1", entityId: "ent-1", gateId: "gate-1",
    passed: false, output: "", evaluatedAt: new Date(),
  }),
} as unknown as IGateRepository;

describe("evaluateGate security", () => {
  it("rejects command with absolute path", async () => {
    const gate = makeGate({ command: "/usr/bin/whoami" });
    const result = await evaluateGate(gate, makeEntity(), mockGateRepo);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/not allowed|outside.*gates/i);
  });

  it("rejects command with .. traversal", async () => {
    const gate = makeGate({ command: "gates/../etc/passwd" });
    const result = await evaluateGate(gate, makeEntity(), mockGateRepo);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/not allowed|outside.*gates/i);
  });

  it("rejects command not under gates/", async () => {
    const gate = makeGate({ command: "node src/main.ts" });
    const result = await evaluateGate(gate, makeEntity(), mockGateRepo);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/not allowed|outside.*gates/i);
  });
});
