import { type ExecFileException, execFile } from "node:child_process";
import type { Entity, OnExitConfig } from "../repositories/interfaces.js";
import { getHandlebars } from "./handlebars.js";

export interface OnExitResult {
  error: string | null;
  timedOut: boolean;
}

export async function executeOnExit(onExit: OnExitConfig, entity: Entity): Promise<OnExitResult> {
  const hbs = getHandlebars();
  let renderedCommand: string;

  // Merge artifact refs into entity.refs (same pattern as on-enter.ts)
  const artifactRefs =
    entity.artifacts !== null &&
    typeof entity.artifacts === "object" &&
    "refs" in entity.artifacts &&
    entity.artifacts.refs !== null &&
    typeof entity.artifacts.refs === "object"
      ? (entity.artifacts.refs as Record<string, unknown>)
      : {};
  const entityForContext = { ...entity, refs: { ...artifactRefs, ...(entity.refs ?? {}) } };

  try {
    renderedCommand = hbs.compile(onExit.command)({ entity: entityForContext });
  } catch (err) {
    const error = `onExit template error: ${err instanceof Error ? err.message : String(err)}`;
    return { error, timedOut: false };
  }

  const timeoutMs = onExit.timeout_ms ?? 30000;
  const { exitCode, stdout, stderr, timedOut } = await runCommand(renderedCommand, timeoutMs);

  if (timedOut) {
    return { error: `onExit command timed out after ${timeoutMs}ms`, timedOut: true };
  }

  if (exitCode !== 0) {
    return { error: `onExit command exited with code ${exitCode}: ${stderr || stdout}`, timedOut: false };
  }

  return { error: null, timedOut: false };
}

function runCommand(
  command: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { timeout: timeoutMs }, (error, stdout, stderr) => {
      const execErr = error as ExecFileException | null;
      const timedOut = execErr !== null && execErr.killed === true;
      resolve({
        exitCode: execErr ? (typeof execErr.code === "number" ? execErr.code : 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });
  });
}
