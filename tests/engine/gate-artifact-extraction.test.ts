import { describe, it, expect } from "vitest";
import type { GateEvalResult } from "../../src/engine/gate-evaluator.js";

describe("Gate artifact extraction contract", () => {
  it("GateEvalResult can carry artifacts", () => {
    const result: GateEvalResult = {
      passed: true,
      timedOut: false,
      output: "Matching comment found",
      outcome: "exists",
      artifacts: { architectSpec: "## Implementation Spec\n\nThe full spec." },
    };

    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.architectSpec).toContain("## Implementation Spec");
  });

  it("GateEvalResult without artifacts is backward-compatible", () => {
    const result: GateEvalResult = {
      passed: true,
      timedOut: false,
      output: "All checks passed",
      outcome: "passed",
    };

    expect(result.artifacts).toBeUndefined();
  });

  it("PR metadata artifacts have expected shape", () => {
    const result: GateEvalResult = {
      passed: true,
      timedOut: false,
      output: "PR is mergeable",
      outcome: "mergeable",
      artifacts: {
        prUrl: "https://github.com/wopr-network/holyship/pull/42",
        prNumber: 42,
        headSha: "abc123def456",
      },
    };

    expect(result.artifacts!.prUrl).toMatch(/^https:\/\/github\.com\//);
    expect(result.artifacts!.prNumber).toBe(42);
    expect(typeof result.artifacts!.headSha).toBe("string");
  });
});
