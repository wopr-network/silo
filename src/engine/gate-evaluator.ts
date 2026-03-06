import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Handlebars from "handlebars";
import type { Entity, Gate } from "../repositories/interfaces.js";

const execFileAsync = promisify(execFile);
const hbs = Handlebars.create();

export interface GateEvalResult {
  passed: boolean;
  output: string;
}

export function hydrateTemplate(template: string, context: Record<string, unknown>): string {
  return hbs.compile(template)(context);
}

export async function evaluateGate(gate: Gate, entity: Entity): Promise<GateEvalResult> {
  switch (gate.type) {
    case "command":
      return evaluateShellGate(gate, entity);
    case "function":
      return evaluateFunctionGate(gate, entity);
    case "api":
      return evaluateApiGate(gate, entity);
    default:
      return { passed: false, output: `Unknown gate type: ${gate.type}` };
  }
}

async function evaluateShellGate(gate: Gate, entity: Entity): Promise<GateEvalResult> {
  if (!gate.command) {
    return { passed: false, output: "Gate command is not configured" };
  }

  const context = { entity, gate };
  const hydrated = hydrateTemplate(gate.command, context);

  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", hydrated], {
      timeout: gate.timeoutMs,
    });
    return { passed: true, output: (stdout + stderr).trim() };
  } catch (err: unknown) {
    const error = err as { killed?: boolean; code?: number; stderr?: string; message?: string };
    if (error.killed) {
      return { passed: false, output: `Command timed out after ${gate.timeoutMs}ms` };
    }
    return {
      passed: false,
      output: (error.stderr ?? error.message ?? "Unknown error").trim(),
    };
  }
}

async function evaluateFunctionGate(gate: Gate, entity: Entity): Promise<GateEvalResult> {
  if (!gate.functionRef) {
    return { passed: false, output: "Gate function_ref is not configured" };
  }

  const colonIndex = gate.functionRef.indexOf(":");
  if (colonIndex === -1) {
    return {
      passed: false,
      output: `Invalid function_ref format: "${gate.functionRef}" (expected "module_path:export_name")`,
    };
  }

  const modulePath = gate.functionRef.slice(0, colonIndex);
  const exportName = gate.functionRef.slice(colonIndex + 1);

  try {
    const mod = await import(modulePath);
    const fn = mod[exportName];
    if (typeof fn !== "function") {
      return {
        passed: false,
        output: `Export "${exportName}" from "${modulePath}" is not a function`,
      };
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Function gate timed out after ${gate.timeoutMs}ms`)), gate.timeoutMs);
    });

    const result = await Promise.race([fn(entity, gate), timeoutPromise]);

    if (
      typeof result !== "object" ||
      result === null ||
      typeof (result as Record<string, unknown>).passed !== "boolean" ||
      typeof (result as Record<string, unknown>).output !== "string"
    ) {
      return {
        passed: false,
        output: "Function gate returned invalid result (expected { passed: boolean, output: string })",
      };
    }

    return { passed: (result as GateEvalResult).passed, output: (result as GateEvalResult).output };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, output: message };
  }
}

async function evaluateApiGate(gate: Gate, entity: Entity): Promise<GateEvalResult> {
  if (!gate.apiConfig) {
    return { passed: false, output: "API gate config is not configured" };
  }

  const config = gate.apiConfig as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    expect_status?: number;
    body?: string;
  };

  if (!config.url) {
    return { passed: false, output: "API gate config missing url" };
  }

  const context = { entity, gate };
  const url = hydrateTemplate(config.url, context);
  const method = config.method ?? "GET";
  const expectedStatus = config.expect_status ?? 200;

  try {
    const response = await fetch(url, {
      method,
      headers: config.headers,
      body: config.body ? hydrateTemplate(config.body, context) : undefined,
      signal: AbortSignal.timeout(gate.timeoutMs),
    });

    const text = await response.text();

    return {
      passed: response.status === expectedStatus,
      output:
        response.status === expectedStatus
          ? text.slice(0, 1000)
          : `Expected status ${expectedStatus}, got ${response.status}: ${text.slice(0, 500)}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("aborted") ||
      message.includes("AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return { passed: false, output: `API gate timed out after ${gate.timeoutMs}ms` };
    }
    return { passed: false, output: message };
  }
}
