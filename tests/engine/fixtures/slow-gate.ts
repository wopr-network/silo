import type { GateEvalResult } from "../../../src/engine/gate-evaluator.js";

export function check(): Promise<GateEvalResult> {
  return new Promise(() => {
    // intentionally never resolves — for timeout testing
  });
}
