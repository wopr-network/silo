import { describe, it, expect, vi } from "vitest";
import { evaluateGate } from "../../src/engine/gate-evaluator.js";
import type { Gate, Entity, IGateRepository } from "../../src/repositories/interfaces.js";

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

  it("throws for api type gates", async () => {
    const gate = makeGate({ type: "api" });
    const entity = makeEntity();
    const gateRepo = {} as IGateRepository;

    await expect(evaluateGate(gate, entity, gateRepo)).rejects.toThrow("API gates not yet implemented");
  });

  it("throws for unknown gate types", async () => {
    const gate = makeGate({ type: "webhook" });
    const entity = makeEntity();
    const gateRepo = {} as IGateRepository;

    await expect(evaluateGate(gate, entity, gateRepo)).rejects.toThrow("Unknown gate type: webhook");
  });
});
