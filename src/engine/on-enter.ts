import { execFile } from "node:child_process";
import type { Entity, IEntityRepository, OnEnterConfig } from "../repositories/interfaces.js";
import { getHandlebars } from "./handlebars.js";

export interface OnEnterResult {
  skipped: boolean;
  artifacts: Record<string, unknown> | null;
  error: string | null;
  timedOut: boolean;
}

export async function executeOnEnter(
  onEnter: OnEnterConfig,
  entity: Entity,
  entityRepo: IEntityRepository,
): Promise<OnEnterResult> {
  // Idempotency: skip if all named artifacts already present
  const existingArtifacts = entity.artifacts ?? {};
  const allPresent = onEnter.artifacts.every((key) => existingArtifacts[key] !== undefined);
  if (allPresent) {
    return { skipped: true, artifacts: null, error: null, timedOut: false };
  }

  // Render command via Handlebars
  const hbs = getHandlebars();
  let renderedCommand: string;
  try {
    renderedCommand = hbs.compile(onEnter.command)({ entity });
  } catch (err) {
    const error = `onEnter template error: ${err instanceof Error ? err.message : String(err)}`;
    await entityRepo.updateArtifacts(entity.id, {
      onEnter_error: {
        command: onEnter.command,
        error,
        failedAt: new Date().toISOString(),
      },
    });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  // Execute command
  const timeoutMs = onEnter.timeout_ms ?? 30000;
  const { exitCode, stdout, stderr, timedOut } = await runOnEnterCommand(renderedCommand, timeoutMs);

  if (timedOut) {
    const error = `onEnter command timed out after ${timeoutMs}ms`;
    await entityRepo.updateArtifacts(entity.id, {
      onEnter_error: {
        command: renderedCommand,
        error,
        stderr,
        failedAt: new Date().toISOString(),
      },
    });
    return { skipped: false, artifacts: null, error, timedOut: true };
  }

  if (exitCode !== 0) {
    const error = `onEnter command exited with code ${exitCode}: ${stderr || stdout}`;
    await entityRepo.updateArtifacts(entity.id, {
      onEnter_error: {
        command: renderedCommand,
        error,
        failedAt: new Date().toISOString(),
      },
    });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  // Parse JSON stdout
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const error = `onEnter stdout is not valid JSON: ${stdout.slice(0, 200)}`;
    await entityRepo.updateArtifacts(entity.id, {
      onEnter_error: {
        command: renderedCommand,
        error,
        failedAt: new Date().toISOString(),
      },
    });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  // Extract named artifact keys
  const missingKeys = onEnter.artifacts.filter((key) => parsed[key] === undefined);
  if (missingKeys.length > 0) {
    const error = `onEnter stdout missing expected artifact keys: ${missingKeys.join(", ")}`;
    await entityRepo.updateArtifacts(entity.id, {
      onEnter_error: {
        command: renderedCommand,
        error,
        failedAt: new Date().toISOString(),
      },
    });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  const mergedArtifacts: Record<string, unknown> = {};
  for (const key of onEnter.artifacts) {
    mergedArtifacts[key] = parsed[key];
  }

  // Merge into entity
  await entityRepo.updateArtifacts(entity.id, mergedArtifacts);

  return { skipped: false, artifacts: mergedArtifacts, error: null, timedOut: false };
}

function runOnEnterCommand(
  command: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = execFile("/bin/sh", ["-c", command], { timeout: timeoutMs }, (error, stdout, stderr) => {
      const timedOut = error !== null && child.killed === true;
      resolve({
        exitCode: error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });
  });
}
