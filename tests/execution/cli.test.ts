import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
import { resolveSessionId, verifySessionToken, extractBearerToken, validateAdminToken, validateWorkerToken } from "../../src/execution/cli.js";

const CLI = join(import.meta.dirname, "../../src/execution/cli.ts");

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    cwd: join(import.meta.dirname, "../.."),
    encoding: "utf-8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
}

function runExpectFail(args: string[], env: Record<string, string> = {}): string {
  try {
    execFileSync("npx", ["tsx", CLI, ...args], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf-8",
      env: { ...process.env, ...env },
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    throw new Error("Expected process to exit with non-zero code");
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return e.stderr ?? e.stdout ?? e.message ?? "";
  }
}

function writeSeedFile(seed: unknown): string {
  const dir = join(tmpdir(), `cli-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "seed.json");
  writeFileSync(path, JSON.stringify(seed));
  return path;
}

const validSeed = {
  flows: [{ name: "pr-review", initialState: "open", discipline: "engineering" }],
  states: [
    { name: "open", flowName: "pr-review" },
    { name: "reviewing", flowName: "pr-review" },
  ],
  gates: [{ name: "lint-pass", type: "command", command: "gates/blocking-graph.ts" }],
  transitions: [
    { flowName: "pr-review", fromState: "open", toState: "reviewing", trigger: "claim", gateName: "lint-pass" },
  ],
};

// CLI subprocess tests that require a running Postgres instance are skipped
// in unit-test mode. They run in integration-test mode with SILO_DB_URL set.
const hasPostgres = !!process.env.SILO_DB_URL;

describe("CLI", () => {
  it.skipIf(!hasPostgres)("init --seed loads a seed file", () => {
    const seedPath = writeSeedFile(validSeed);
    const output = run(["init", "--seed", seedPath, "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    expect(output).toContain("flows: 1");
    expect(output).toContain("gates: 1");
  });

  it.skipIf(!hasPostgres)("init --seed --force drops existing data first", () => {
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath, "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    const output = run(["init", "--seed", seedPath, "--force", "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    expect(output).toContain("flows: 1");
  });

  it.skipIf(!hasPostgres)("export outputs valid JSON to stdout", () => {
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath, "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    const output = run(["export", "--db-url", process.env.SILO_DB_URL!]);
    const parsed = JSON.parse(output);
    expect(parsed.flows).toHaveLength(1);
  });

  it.skipIf(!hasPostgres)("export --out writes to file", { timeout: 15000 }, () => {
    const seedPath = writeSeedFile(validSeed);
    const outPath = join(tmpdir(), `cli-export-${Date.now()}.json`);
    run(["init", "--seed", seedPath, "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    run(["export", "--out", outPath, "--db-url", process.env.SILO_DB_URL!]);
    const content = readFileSync(outPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.flows).toHaveLength(1);
    if (existsSync(outPath)) rmSync(outPath);
  }, 15000);

  it("init without --seed prints usage", () => {
    const output = run(["init"]);
    expect(output).toContain("--seed");
  });

  it("serve --help shows serve options", () => {
    const output = run(["serve", "--help"]);
    expect(output).toContain("--transport");
    expect(output).toContain("--port");
    expect(output).toContain("--host");
    expect(output).toContain("--db-url");
  });

  it.skipIf(!hasPostgres)("SSE server returns CORS headers for localhost origin", async () => {
    const seedPath = writeSeedFile(validSeed);
    const dbUrl = process.env.SILO_DB_URL!;
    try {
      run(["init", "--seed", seedPath, "--db-url", dbUrl], { SILO_SEED_ROOT: tmpdir() });

      const child = execFile("npx", ["tsx", CLI, "serve", "--transport", "sse", "--port", "0", "--mcp-only", "--db-url", dbUrl], {
        cwd: join(import.meta.dirname, "../.."),
        env: { ...process.env, SILO_DB_URL: dbUrl, SILO_ADMIN_TOKEN: "test-token", SILO_WORKER_TOKEN: "test-worker-token" },
      });

      let port: number | undefined;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server did not start in time")), 10000);
        child.stdout?.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          const match = text.match(/listening on [^:]+:(\d+)/);
          if (match) {
            port = parseInt(match[1], 10);
            clearTimeout(timeout);
            resolve();
          }
        });
        child.on("error", reject);
      });

      if (!port) throw new Error("Could not determine server port");

      try {
        const localhostRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request(
            { hostname: "127.0.0.1", port, path: "/sse", method: "GET", headers: { Origin: "http://localhost:3000" } },
            resolve,
          );
          req.on("error", reject);
          req.end();
        });
        expect(localhostRes.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

        const evilRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request(
            { hostname: "127.0.0.1", port, path: "/sse", method: "GET", headers: { Origin: "http://evil.example.com" } },
            resolve,
          );
          req.on("error", reject);
          req.end();
        });
        expect(evilRes.headers["access-control-allow-origin"]).toBeUndefined();
      } finally {
        child.kill("SIGTERM");
      }
    } finally {
      if (existsSync(seedPath)) rmSync(seedPath);
    }
  }, 15000);

  it("status --help shows status options", () => {
    const output = run(["status", "--help"]);
    expect(output).toContain("--flow");
    expect(output).toContain("--state");
    expect(output).toContain("--json");
    expect(output).toContain("--db-url");
  });

  it.skipIf(!hasPostgres)("status prints table for initialized db", () => {
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath, "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    const output = run(["status", "--db-url", process.env.SILO_DB_URL!]);
    expect(output).toContain("pr-review");
  });

  it.skipIf(!hasPostgres)("status --json outputs valid JSON", { timeout: 15000 }, () => {
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath, "--db-url", process.env.SILO_DB_URL!], { SILO_SEED_ROOT: tmpdir() });
    const output = run(["status", "--json", "--db-url", process.env.SILO_DB_URL!]);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("flows");
  }, 15000);

});

describe("resolveSessionId", () => {
  it("returns sessionId from X-Session-Id header when present", () => {
    const params = new URLSearchParams("sessionId=query-id");
    const result = resolveSessionId({ "x-session-id": "header-id" }, params);
    expect(result).toBe("header-id");
  });

  it("falls back to query param when X-Session-Id header is absent", () => {
    const params = new URLSearchParams("sessionId=query-id");
    const result = resolveSessionId({}, params);
    expect(result).toBe("query-id");
  });

  it("returns empty string when neither header nor query param is present", () => {
    const params = new URLSearchParams();
    const result = resolveSessionId({}, params);
    expect(result).toBe("");
  });

  it("uses first value when X-Session-Id header is an array", () => {
    const params = new URLSearchParams();
    const result = resolveSessionId({ "x-session-id": ["first-id", "second-id"] }, params);
    expect(result).toBe("first-id");
  });
});

describe("verifySessionToken", () => {
  it("returns true when stored token matches incoming token", () => {
    expect(verifySessionToken(hashToken("secret-token"), "secret-token")).toBe(true);
  });

  it("returns false when incoming token does not match stored token", () => {
    expect(verifySessionToken(hashToken("secret-token"), "wrong-token")).toBe(false);
  });

  it("returns false when incoming token is absent but stored token exists", () => {
    expect(verifySessionToken(hashToken("secret-token"), undefined)).toBe(false);
  });

  it("returns true when no token was stored at handshake (unauthenticated session)", () => {
    expect(verifySessionToken(undefined, undefined)).toBe(true);
    expect(verifySessionToken(undefined, "any-token")).toBe(true);
  });
});

describe("extractBearerToken", () => {
  it("extracts token from valid Bearer header", () => {
    expect(extractBearerToken("Bearer my-secret-token")).toBe("my-secret-token");
  });

  it("is case-insensitive for Bearer prefix", () => {
    expect(extractBearerToken("bearer my-token")).toBe("my-token");
    expect(extractBearerToken("BEARER my-token")).toBe("my-token");
  });

  it("trims whitespace from extracted token", () => {
    expect(extractBearerToken("Bearer   spaced-token  ")).toBe("spaced-token");
  });

  it("returns undefined for missing header", () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it("returns undefined for non-Bearer header", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeUndefined();
  });

  it("returns undefined for Bearer with no token", () => {
    expect(extractBearerToken("Bearer ")).toBeUndefined();
    expect(extractBearerToken("Bearer")).toBeUndefined();
  });
});

describe("validateAdminToken", () => {
  it("throws when HTTP is active and no admin token", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: true, transport: "stdio" }),
    ).toThrow("SILO_ADMIN_TOKEN must be set");
  });

  it("throws when SSE transport and no admin token", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: false, transport: "sse" }),
    ).toThrow("SILO_ADMIN_TOKEN must be set");
  });

  it("throws when token is whitespace-only with HTTP active", () => {
    expect(() =>
      validateAdminToken({ adminToken: "   ", startHttp: true, transport: "stdio" }),
    ).toThrow("SILO_ADMIN_TOKEN must be set");
  });

  it("does not throw for stdio-only without token", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: false, transport: "stdio" }),
    ).not.toThrow();
  });

  it("does not throw when token is provided with HTTP", () => {
    expect(() =>
      validateAdminToken({ adminToken: "real-token", startHttp: true, transport: "stdio" }),
    ).not.toThrow();
  });

  it("does not throw when token is provided with SSE", () => {
    expect(() =>
      validateAdminToken({ adminToken: "real-token", startHttp: false, transport: "sse" }),
    ).not.toThrow();
  });

  it("handles transport with mixed case and whitespace", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: false, transport: "  SSE  " }),
    ).toThrow("SILO_ADMIN_TOKEN must be set");
  });
});

describe("validateWorkerToken", () => {
  it("throws when HTTP is active and no worker token", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: true, transport: "stdio" }),
    ).toThrow("SILO_WORKER_TOKEN must be set");
  });

  it("throws when SSE transport and no worker token", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: false, transport: "sse" }),
    ).toThrow("SILO_WORKER_TOKEN must be set");
  });

  it("throws when token is whitespace-only with HTTP active", () => {
    expect(() =>
      validateWorkerToken({ workerToken: "   ", startHttp: true, transport: "stdio" }),
    ).toThrow("SILO_WORKER_TOKEN must be set");
  });

  it("does not throw for stdio-only without token", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: false, transport: "stdio" }),
    ).not.toThrow();
  });

  it("does not throw when token is provided with HTTP", () => {
    expect(() =>
      validateWorkerToken({ workerToken: "real-token", startHttp: true, transport: "stdio" }),
    ).not.toThrow();
  });

  it("handles transport with mixed case and whitespace", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: false, transport: "  SSE  " }),
    ).toThrow("SILO_WORKER_TOKEN must be set");
  });
});

describe("CLI validation", () => {
  it.skipIf(!hasPostgres)("serve rejects non-numeric --reaper-interval", () => {
    const output = runExpectFail(["serve", "--reaper-interval", "abc", "--db-url", process.env.SILO_DB_URL!]);
    expect(output).toMatch(/reaper-interval/i);
  });

  it.skipIf(!hasPostgres)("serve rejects --reaper-interval below 1000", () => {
    const output = runExpectFail(["serve", "--reaper-interval", "500", "--db-url", process.env.SILO_DB_URL!]);
    expect(output).toMatch(/reaper-interval/i);
  });

  it.skipIf(!hasPostgres)("serve rejects non-numeric --claim-ttl", () => {
    const output = runExpectFail(["serve", "--claim-ttl", "abc", "--db-url", process.env.SILO_DB_URL!]);
    expect(output).toMatch(/claim-ttl/i);
  });

  it.skipIf(!hasPostgres)("serve rejects --claim-ttl below 5000", () => {
    const output = runExpectFail(["serve", "--claim-ttl", "1000", "--db-url", process.env.SILO_DB_URL!]);
    expect(output).toMatch(/claim-ttl/i);
  });

  it.skipIf(!hasPostgres)("serve rejects --http-only and --mcp-only together", () => {
    const output = runExpectFail(["serve", "--http-only", "--mcp-only", "--db-url", process.env.SILO_DB_URL!]);
    expect(output).toMatch(/http-only.*mcp-only|Cannot use/i);
  });

});
