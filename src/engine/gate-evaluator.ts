import { exec } from "node:child_process";
import type { Entity, Gate, IGateRepository } from "../repositories/interfaces.js";

export interface GateEvalResult {
  passed: boolean;
  output: string;
}

/**
 * Evaluate a gate against an entity. Records the result in gateRepo.
 * Currently supports "command" type gates only.
 * "function" and "api" types throw — implement when needed.
 */
export async function evaluateGate(gate: Gate, entity: Entity, gateRepo: IGateRepository): Promise<GateEvalResult> {
  let passed = false;
  let output = "";

  if (gate.type === "command") {
    const result = await runCommand(gate.command ?? "", gate.timeoutMs);
    passed = result.exitCode === 0;
    output = result.output;
  } else if (gate.type === "function") {
    throw new Error(`Function gates not yet implemented: ${gate.functionRef}`);
  } else if (gate.type === "api") {
    throw new Error(`API gates not yet implemented`);
  }

  await gateRepo.record(entity.id, gate.id, passed, output);
  return { passed, output };
}

function runCommand(command: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? 1 : 0,
        output: (stdout + stderr).trim(),
      });
    });
  });
}
