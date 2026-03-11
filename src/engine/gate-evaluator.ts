import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GateError, NotFoundError, ValidationError } from "../errors.js";
import type { AdapterRegistry } from "../integrations/registry.js";
import type { PrimitiveOp } from "../integrations/types.js";
import { logger } from "../logger.js";
import type { Entity, Flow, Gate, IGateRepository } from "../repositories/interfaces.js";
import { validateGateCommand } from "./gate-command-validator.js";
import { checkSsrf } from "./ssrf-guard.js";

export interface GateEvalResult {
  passed: boolean;
  timedOut: boolean;
  output: string;
  /** Named outcome from structured JSON output, if the gate emitted one. */
  outcome?: string;
  /** Human-readable message from structured JSON output. */
  message?: string;
}

// Anchor path-traversal checks to the project root. realpathSync resolves symlinks
// so the containment check works even when the project directory itself is a symlink.
const PROJECT_ROOT = realpathSync(resolve(fileURLToPath(new URL("../..", import.meta.url))));
const GATES_DIR = realpathSync(resolve(PROJECT_ROOT, "gates")) + sep;

function getSystemDefaultGateTimeout(): number {
  const parsed = parseInt(process.env.SILO_DEFAULT_GATE_TIMEOUT_MS ?? "", 10);
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : 300000;
}

export function resolveGateTimeout(
  gateTimeoutMs: number | null | undefined,
  flowGateTimeoutMs: number | null | undefined,
): number {
  if (gateTimeoutMs != null && gateTimeoutMs > 0) return gateTimeoutMs;
  if (flowGateTimeoutMs != null && flowGateTimeoutMs > 0) return flowGateTimeoutMs;
  return getSystemDefaultGateTimeout();
}

/**
 * Evaluate a gate against an entity. Records the result in gateRepo.
 * Supports "command", "function", "api", and "primitive" gate types.
 */
export async function evaluateGate(
  gate: Gate,
  entity: Entity,
  gateRepo: IGateRepository,
  flowGateTimeoutMs?: number | null,
  flow?: Flow | null,
  adapterRegistry?: AdapterRegistry | null,
): Promise<GateEvalResult> {
  const effectiveTimeout = resolveGateTimeout(gate.timeoutMs, flowGateTimeoutMs);
  let passed = false;
  let output = "";
  let timedOut = false;

  if (gate.type === "primitive") {
    if (!gate.primitiveOp) {
      const result = { passed: false, timedOut: false, output: "Gate primitiveOp is not configured" };
      await gateRepo.record(entity.id, gate.id, result.passed, result.output);
      return result;
    }
    if (!adapterRegistry) {
      const result = { passed: false, timedOut: false, output: "AdapterRegistry not available for primitive gate" };
      await gateRepo.record(entity.id, gate.id, result.passed, result.output);
      return result;
    }

    const op = gate.primitiveOp as PrimitiveOp;
    const opCategory = op.split(".")[0];
    const integrationId = opCategory === "issue_tracker" ? flow?.issueTrackerIntegrationId : flow?.vcsIntegrationId;

    if (!integrationId) {
      const result = {
        passed: false,
        timedOut: false,
        output: `Flow has no ${opCategory} integration configured`,
      };
      await gateRepo.record(entity.id, gate.id, result.passed, result.output);
      return result;
    }

    // Render primitive params via Handlebars
    let renderedParams: Record<string, unknown>;
    try {
      const hbs = (await import("./handlebars.js")).getHandlebars();
      const rawParams = gate.primitiveParams ?? {};
      renderedParams = Object.fromEntries(
        Object.entries(rawParams).map(([k, v]) => [k, typeof v === "string" ? hbs.compile(v)({ entity }) : v]),
      );
    } catch (err) {
      const msg = `Primitive gate template error: ${err instanceof Error ? err.message : String(err)}`;
      await gateRepo.record(entity.id, gate.id, false, msg);
      return { passed: false, timedOut: false, output: msg };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    let opResult: Record<string, unknown>;
    try {
      opResult = await adapterRegistry.execute(integrationId, op, renderedParams, controller.signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      timedOut = err instanceof Error && err.name === "AbortError";
      await gateRepo.record(entity.id, gate.id, false, msg);
      return { passed: false, timedOut, output: msg };
    } finally {
      clearTimeout(timer);
    }

    const outcome = typeof opResult.outcome === "string" ? opResult.outcome : undefined;
    // A primitive gate passes if the outcome is "passed", "exists", "merged", or "queued",
    // or if the gate's outcomes map declares proceed: true for the returned outcome.
    const outcomeConfig = outcome ? gate.outcomes?.[outcome] : undefined;
    if (outcomeConfig) {
      passed = outcomeConfig.proceed === true;
    } else {
      passed = outcome === "passed" || outcome === "exists" || outcome === "merged" || outcome === "queued";
    }
    output = outcome ?? JSON.stringify(opResult);

    logger.info(`[gate:primitive] "${gate.name}" op=${op} outcome=${outcome ?? "(none)"}`, {
      entityId: entity.id,
      passed,
    });

    await gateRepo.record(entity.id, gate.id, passed, output);
    return { passed, timedOut: false, output, outcome };
  } else if (gate.type === "command") {
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
    // validation.parts is guaranteed non-null when valid is true
    const parts = validation.parts ?? [renderedCommand];
    const [executable, ...args] = parts;
    const resolvedPath = validation.resolvedPath ?? executable;
    const result = await runCommand(resolvedPath, args, effectiveTimeout);
    passed = result.exitCode === 0;
    output = result.output;
    timedOut = result.timedOut;

    const stdoutLines = result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const lastLine = stdoutLines.at(-1);

    logger.info(`[gate] "${gate.name}" command finished`, {
      entityId: entity.id,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdoutLineCount: stdoutLines.length,
      stdoutLength: result.stdout.length,
      outputLength: result.output.length,
    });
    logger.debug(`[gate] "${gate.name}" last stdout line`, {
      entityId: entity.id,
      lastLine: lastLine ?? "(empty)",
    });

    // Parse structured JSON outcome from the last non-empty stdout line.
    // Gate scripts emit { outcome, message } as their final stdout line
    // to enable named outcome routing (e.g. "ci_failed" → toState: "fixing").
    if (lastLine?.startsWith("{")) {
      try {
        const parsed = JSON.parse(lastLine) as { outcome?: unknown; message?: unknown };
        if (typeof parsed.outcome === "string") {
          logger.info(`[gate] "${gate.name}" parsed outcome: ${String(parsed.outcome)}`, {
            entityId: entity.id,
            outcome: parsed.outcome,
            passed,
          });
          logger.debug(`[gate] "${gate.name}" outcome message`, {
            entityId: entity.id,
            message: parsed.message ?? "(none)",
          });
          const outcomeResult = {
            passed,
            timedOut,
            output: result.output,
            outcome: parsed.outcome,
            message: typeof parsed.message === "string" ? parsed.message : undefined,
          };
          await gateRepo.record(entity.id, gate.id, passed, result.output);
          return outcomeResult;
        }
        logger.warn(`[gate] "${gate.name}" JSON parsed but no outcome field`, { lastLine });
      } catch (err) {
        logger.warn(`[gate] "${gate.name}" last line looked like JSON but failed to parse`, {
          lastLine,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (gate.outcomes && Object.keys(gate.outcomes).length > 0) {
      // Only warn when the gate declares structured outcomes but no JSON was found
      logger.warn(`[gate] "${gate.name}" expected JSON outcome in stdout but none was found`, {
        entityId: entity.id,
        lastLine: lastLine ?? "(empty)",
      });
    }
  } else if (gate.type === "function") {
    try {
      if (!gate.functionRef) {
        const result = { passed: false, timedOut: false, output: "Gate functionRef is not configured" };
        await gateRepo.record(entity.id, gate.id, result.passed, result.output);
        return result;
      }
      const result = await runFunction(gate.functionRef, entity, gate, effectiveTimeout);
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
      // SSRF guard: resolve hostname and check against blocklist.
      // Wrap in try/catch so malformed URLs don't abort the gate without recording a result.
      let ssrfResult: Awaited<ReturnType<typeof checkSsrf>>;
      try {
        ssrfResult = await checkSsrf(url, process.env.SILO_GATE_ALLOWLIST);
      } catch (err) {
        passed = false;
        output = `SSRF_BLOCKED: ${err instanceof Error ? err.message : String(err)}`;
        await gateRepo.record(entity.id, gate.id, passed, output);
        return { passed, timedOut: false, output };
      }
      if (!ssrfResult.allowed) {
        passed = false;
        output = ssrfResult.reason ?? "SSRF_BLOCKED";
        await gateRepo.record(entity.id, gate.id, passed, output);
        return { passed, timedOut: false, output };
      }
      // Use pre-resolved IP for fetch to avoid DNS rebinding TOCTOU.
      // Replace hostname with the first resolved IP and set Host header to original hostname.
      const parsedUrl = new URL(url);
      const originalHostname = parsedUrl.hostname;
      const resolvedIp = ssrfResult.resolvedIps?.[0];
      const fetchUrl =
        resolvedIp && resolvedIp !== originalHostname
          ? (() => {
              parsedUrl.hostname = resolvedIp;
              return parsedUrl.toString();
            })()
          : url;
      const fetchHeaders: Record<string, string> =
        resolvedIp && resolvedIp !== originalHostname ? { Host: originalHostname } : {};
      const method = (gate.apiConfig.method as string) ?? "GET";
      const expectStatus = (gate.apiConfig.expectStatus as number) ?? 200;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
      try {
        const res = await fetch(fetchUrl, {
          method,
          signal: controller.signal,
          redirect: "manual",
          headers: fetchHeaders,
        });
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
    throw new GateError(`Unknown gate type: ${gate.type}`);
  }

  await gateRepo.record(entity.id, gate.id, passed, output);
  return { passed, timedOut, output };
}

/**
 * Evaluate a gate across all repos in the entity's artifacts.prs map.
 * Calls evaluateGate once per repo/PR pair and ANDs the results.
 * Falls back to a single evaluateGate call when no prs map exists.
 */
export async function evaluateGateForAllRepos(
  gate: Gate,
  entity: Entity,
  gateRepo: IGateRepository,
  flowGateTimeoutMs?: number | null,
  flow?: Flow | null,
  adapterRegistry?: AdapterRegistry | null,
  evalFn: (
    gate: Gate,
    entity: Entity,
    gateRepo: IGateRepository,
    timeout?: number | null,
    flow?: Flow | null,
    adapterRegistry?: AdapterRegistry | null,
  ) => Promise<GateEvalResult> = evaluateGate,
): Promise<GateEvalResult> {
  const prs = entity.artifacts?.prs;

  // No prs map — single evaluation (backwards compat, or non-PR gate like spec-posted)
  if (!prs || typeof prs !== "object" || Object.keys(prs as Record<string, unknown>).length === 0) {
    return evalFn(gate, entity, gateRepo, flowGateTimeoutMs, flow, adapterRegistry);
  }

  const entries = Object.entries(prs as Record<string, string>);
  const results: GateEvalResult[] = [];

  for (const [repoName, prUrl] of entries) {
    // Extract PR number from URL (e.g. https://github.com/org/repo/pull/123 → 123)
    const prNumber = prUrl.split("/").pop() ?? "";
    const fullRepo =
      (entity.artifacts?.repos as string[] | undefined)?.find((r: string) => r.split("/").pop() === repoName) ??
      repoName;

    // Create a per-repo entity view with repo-specific context for template rendering
    const repoEntity: Entity = {
      ...entity,
      artifacts: {
        ...entity.artifacts,
        _currentRepo: fullRepo,
        _currentRepoName: repoName,
        _currentPrNumber: prNumber,
        _currentPrUrl: prUrl,
      },
    };

    const result = await evalFn(gate, repoEntity, gateRepo, flowGateTimeoutMs, flow, adapterRegistry);
    results.push(result);

    // Short-circuit on first failure
    if (!result.passed) {
      return {
        passed: false,
        timedOut: result.timedOut,
        output: `[${repoName}] ${result.output}`,
        outcome: result.outcome,
        message: result.message,
      };
    }
  }

  // All passed — results is non-empty since we only reach here after iterating entries
  const lastResult = results[results.length - 1];
  return {
    passed: true,
    timedOut: false,
    output: results.map((r, i) => `[${entries[i][0]}] ${r.output}`).join("\n"),
    outcome: lastResult?.outcome,
    message: lastResult?.message,
  };
}

async function runFunction(
  functionRef: string,
  entity: Entity,
  gate: Gate,
  effectiveTimeout: number,
): Promise<{ passed: boolean; output: string; timedOut: boolean }> {
  const lastColon = functionRef.lastIndexOf(":");
  if (lastColon === -1) {
    throw new ValidationError(`Invalid functionRef "${functionRef}" — expected "path:exportName"`);
  }
  const modulePath = functionRef.slice(0, lastColon);
  const exportName = functionRef.slice(lastColon + 1);

  const absPath = resolve(PROJECT_ROOT, modulePath);
  // Reject paths that escape the gates/ directory
  let realPath: string;
  try {
    realPath = realpathSync(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    // File doesn't exist yet — use the unresolved path for the bounds check
    realPath = absPath;
  }
  if (!realPath.startsWith(GATES_DIR)) {
    throw new ValidationError("functionRef must resolve to a path inside the gates/ directory");
  }
  const moduleUrl = pathToFileURL(realPath).href;

  const mod = await import(moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== "function") {
    throw new NotFoundError(`Gate function "${exportName}" not found in ${modulePath}`);
  }

  const timeout = effectiveTimeout;
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
): Promise<{ exitCode: number; output: string; stdout: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? 1 : 0,
        output: (stdout + stderr).trim(),
        stdout: stdout.trim(),
        timedOut: error !== null && "killed" in error && error.killed === true,
      });
    });
  });
}
