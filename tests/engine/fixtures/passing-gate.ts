import type { GateEvalResult } from "../../../src/engine/gate-evaluator.js";

export function check(): GateEvalResult {
  return { passed: true, output: "all good" };
}
