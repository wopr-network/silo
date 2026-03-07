import { describe, it, expect } from "vitest";
import { validateGateCommand } from "../../src/engine/gate-command-validator.js";

describe("validateGateCommand", () => {
  it("accepts a command under gates/ directory", () => {
    const result = validateGateCommand("gates/lint-check.sh");
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.resolvedPath).toMatch(/gates\/lint-check\.sh$/);
  });

  it("rejects absolute paths", () => {
    const result = validateGateCommand("/usr/bin/rm -rf /");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/absolute/i);
  });

  it("rejects paths with .. traversal", () => {
    const result = validateGateCommand("gates/../etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/outside.*gates/i);
  });

  it("rejects commands not under gates/", () => {
    const result = validateGateCommand("src/main.ts");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must start with.*gates\//i);
  });

  it("rejects empty command", () => {
    const result = validateGateCommand("");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("extracts only the executable for validation, ignores args", () => {
    const result = validateGateCommand("gates/check.sh --strict --verbose");
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toMatch(/gates\/check\.sh$/);
  });

  it("rejects dotdot in the middle of path", () => {
    const result = validateGateCommand("gates/sub/../../../etc/shadow");
    expect(result.valid).toBe(false);
  });

  it("rejects filename that starts with '..' but is not a traversal (false positive fix)", () => {
    // '..lint-check' starts with '..' but is not a path traversal
    // It should be rejected because it resolves outside gates/ (since it's not under gates/),
    // but the rejection must NOT be caused by the startsWith check falsely triggering
    const result = validateGateCommand("gates/..lint-check");
    // gates/..lint-check resolves to GATES_ROOT/..lint-check — still inside gates/ lexically
    // so it should be valid (startsWith(".." + sep) does NOT match "..lint-check")
    expect(result.valid).toBe(true);
  });

  it("rejects '..' as the entire command", () => {
    const result = validateGateCommand("..");
    expect(result.valid).toBe(false);
  });
});
