import { afterEach, describe, expect, it } from "vitest";
import { resolveGateTimeout } from "../../src/engine/gate-evaluator.js";

describe("resolveGateTimeout", () => {
  const originalEnv = process.env.SILO_DEFAULT_GATE_TIMEOUT_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SILO_DEFAULT_GATE_TIMEOUT_MS;
    } else {
      process.env.SILO_DEFAULT_GATE_TIMEOUT_MS = originalEnv;
    }
  });

  it("uses gate-level timeout when set and > 0", () => {
    expect(resolveGateTimeout(60000, 120000)).toBe(60000);
  });

  it("falls through to flow-level when gate timeout is undefined", () => {
    expect(resolveGateTimeout(undefined, 120000)).toBe(120000);
  });

  it("falls through to flow-level when gate timeout is null", () => {
    expect(resolveGateTimeout(null, 120000)).toBe(120000);
  });

  it("falls through to flow-level when gate timeout is 0", () => {
    expect(resolveGateTimeout(0, 120000)).toBe(120000);
  });

  it("falls through to system default when both are undefined", () => {
    expect(resolveGateTimeout(undefined, undefined)).toBe(300000);
  });

  it("falls through to system default when flow timeout is null", () => {
    expect(resolveGateTimeout(undefined, null)).toBe(300000);
  });

  it("falls through to system default when flow timeout is 0", () => {
    expect(resolveGateTimeout(undefined, 0)).toBe(300000);
  });

  it("gate-level takes priority over flow-level", () => {
    expect(resolveGateTimeout(5000, 999000)).toBe(5000);
  });

  it("respects SILO_DEFAULT_GATE_TIMEOUT_MS env var", () => {
    process.env.SILO_DEFAULT_GATE_TIMEOUT_MS = "600000";
    expect(resolveGateTimeout(undefined, undefined)).toBe(600000);
  });

  it("falls back to 300000 when SILO_DEFAULT_GATE_TIMEOUT_MS is not a valid number", () => {
    process.env.SILO_DEFAULT_GATE_TIMEOUT_MS = "not-a-number";
    expect(resolveGateTimeout(undefined, undefined)).toBe(300000);
  });

  it("falls back to 300000 when SILO_DEFAULT_GATE_TIMEOUT_MS is 0", () => {
    process.env.SILO_DEFAULT_GATE_TIMEOUT_MS = "0";
    expect(resolveGateTimeout(undefined, undefined)).toBe(300000);
  });
});
