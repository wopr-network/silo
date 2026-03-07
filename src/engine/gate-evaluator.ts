import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Entity, Gate, IGateRepository } from "../repositories/interfaces.js";
import { validateGateCommand } from "./gate-command-validator.js";

export interface GateEvalResult {
  passed: boolean;
  timedOut: boolean;
  output: string;
}

// Anchor path-traversal checks to the project root. realpathSync resolves symlinks
// so the containment check works even when the project directory itself is a symlink.
const PROJECT_ROOT = realpathSync(resolve(fileURLToPath(new URL("../..", import.meta.url))));

/**
 * Evaluate a gate against an entity. Records the result in gateRepo.
 * Supports "command", "function", and "api" gate types.
 */
export async function evaluateGate(gate: Gate, entity: Entity, gateRepo: IGateRepository): Promise<GateEvalResult> {
  let passed = false;
  let output = "";
  let timedOut = false;

  if (gate.type === "command") {
    if (!gate.command) {
      return { passed: false, timedOut: false, output: "Gate command is not configured" };
    }
    // Render Handlebars templates in the command string before validation/execution
    let renderedCommand: string;
    try {
      const hbs = (await import("./handlebars.js")).getHandlebars();
      renderedCommand = hbs.compile(gate.command)({ entity });
    } catch (err) {
      const msg = `Template error: ${err instanceof Error ? err.message : String(err)}`;
      await gateRepo.record(entity.id, gate.id, false, msg);
      return { passed: false, timedOut: false, output: msg };
    }
    // Defense-in-depth: validate command path even though schema should have caught it
    const validation = validateGateCommand(renderedCommand);
    if (!validation.valid) {
      const msg = `Gate command not allowed: ${validation.error}`;
      await gateRepo.record(entity.id, gate.id, false, msg);
      return { passed: false, timedOut: false, output: msg };
    }
    const [, ...args] = renderedCommand.split(/\s+/);
    const resolvedPath = validation.resolvedPath ?? renderedCommand.split(/\s+/)[0];
    const result = await runCommand(resolvedPath, args, gate.timeoutMs);
    passed = result.exitCode === 0;
    output = result.output;
    timedOut = result.timedOut;
  } else if (gate.type === "function") {
    try {
      if (!gate.functionRef) {
        const result = { passed: false, timedOut: false, output: "Gate functionRef is not configured" };
        await gateRepo.record(entity.id, gate.id, result.passed, result.output);
        return result;
      }
      const result = await runFunction(gate.functionRef, entity, gate);
      passed = result.passed;
      output = result.output;
      timedOut = result.timedOut;
    } catch (err) {
      passed = false;
      output = err instanceof Error ? err.message : String(err);
    }
  } else if (gate.type === "api") {
    if (!gate.apiConfig) {
      passed = false;
      output = "Gate apiConfig is not configured";
    } else {
      let url: string;
      try {
        const hbs = (await import("./handlebars.js")).getHandlebars();
        url = hbs.compile(gate.apiConfig.url as string)({ entity, ...entity });
      } catch (err) {
        passed = false;
        output = `Template error: ${err instanceof Error ? err.message : String(err)}`;
        await gateRepo.record(entity.id, gate.id, passed, output);
        return { passed, timedOut: false, output };
      }
      if (!url.startsWith("https://")) {
        passed = false;
        output = `URL protocol not allowed: ${url.split("://")[0] ?? "unknown"}`;
        await gateRepo.record(entity.id, gate.id, passed, output);
        return { passed, timedOut: false, output };
      }
      const method = (gate.apiConfig.method as string) ?? "GET";
      const expectStatus = (gate.apiConfig.expectStatus as number) ?? 200;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), gate.timeoutMs ?? 10000);
      try {
        const res = await fetch(url, { method, signal: controller.signal });
        passed = res.status === expectStatus;
        output = `HTTP ${res.status}`;
      } catch (err) {
        passed = false;
        output = err instanceof Error ? err.message : String(err);
        timedOut = err instanceof Error && err.name === "AbortError";
      } finally {
        clearTimeout(timeout);
      }
    }
  } else {
    throw new Error(`Unknown gate type: ${gate.type}`);
  }

  await gateRepo.record(entity.id, gate.id, passed, output);
  return { passed, timedOut, output };
}

async function runFunction(
  functionRef: string,
  entity: Entity,
  gate: Gate,
): Promise<{ passed: boolean; output: string; timedOut: boolean }> {
  const lastColon = functionRef.lastIndexOf(":");
  if (lastColon === -1) {
    throw new Error(`Invalid functionRef "${functionRef}" — expected "path:exportName"`);
  }
  const modulePath = functionRef.slice(0, lastColon);
  const exportName = functionRef.slice(lastColon + 1);

  const absPath = resolve(PROJECT_ROOT, modulePath);
  // Reject paths that escape the project root (path traversal guard)
  let realPath: string;
  try {
    realPath = realpathSync(absPath);
  } catch {
    // File doesn't exist yet — use the unresolved path for the bounds check
    realPath = absPath;
  }
  const rel = relative(PROJECT_ROOT, realPath);
  if (rel.startsWith("..") || resolve(PROJECT_ROOT, rel) !== realPath) {
    throw new Error(`Gate modulePath "${modulePath}" resolves outside the project root`);
  }
  const moduleUrl = pathToFileURL(realPath).href;

  const mod = await import(moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw new Error(`Gate function "${exportName}" not found in ${modulePath}`);
  }

  const timeout = gate.timeoutMs != null && gate.timeoutMs > 0 ? gate.timeoutMs : 30000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ passed: boolean; output: string; timedOut: boolean }>((resolve) => {
    timer = setTimeout(
      () => resolve({ passed: false, output: `Function gate timed out after ${timeout}ms`, timedOut: true }),
      timeout,
    );
  });
  let result: { passed: boolean; output: string; timedOut?: boolean };
  try {
    const raw = await Promise.race([Promise.resolve(fn(entity, gate)), timeoutPromise]);
    result = { ...raw, timedOut: (raw as { timedOut?: boolean }).timedOut ?? false };
  } catch (err) {
    result = {
      passed: false,
      output: `Function gate error: ${err instanceof Error ? err.message : String(err)}`,
      timedOut: false,
    };
  } finally {
    clearTimeout(timer);
  }

  // Validate return shape — bad implementations silently fail rather than corrupt the record
  if (result === null || typeof result !== "object" || typeof (result as { passed?: unknown }).passed !== "boolean") {
    return {
      passed: false,
      output: `Invalid return from gate function "${exportName}": expected { passed: boolean, output?: string }`,
      timedOut: false,
    };
  }

  return {
    passed: (result as { passed: boolean; output?: unknown }).passed,
    output: String((result as { output?: unknown }).output ?? ""),
    timedOut: result.timedOut ?? false,
  };
}

function runCommand(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? 1 : 0,
        output: (stdout + stderr).trim(),
        timedOut: error !== null && "killed" in error && error.killed === true,
      });
    });
  });
}
