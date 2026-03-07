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
import { resolveSessionId, verifySessionToken } from "../../src/execution/cli.js";

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

describe("CLI", () => {
  it("init --seed loads a seed file", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-db-${Date.now()}.db`);
    const output = run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    expect(output).toContain("flows: 1");
    expect(output).toContain("gates: 1");
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("init --seed --force drops existing data first", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-force-${Date.now()}.db`);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    const output = run(["init", "--seed", seedPath, "--force"], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    expect(output).toContain("flows: 1");
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("export outputs valid JSON to stdout", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-export-${Date.now()}.db`);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    const output = run(["export"], { AGENTIC_DB_PATH: dbPath });
    const parsed = JSON.parse(output);
    expect(parsed.flows).toHaveLength(1);
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("export --out writes to file", { timeout: 15000 }, () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-export-file-${Date.now()}.db`);
    const outPath = join(tmpdir(), `cli-export-${Date.now()}.json`);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    run(["export", "--out", outPath], { AGENTIC_DB_PATH: dbPath });
    const content = readFileSync(outPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.flows).toHaveLength(1);
    if (existsSync(dbPath)) rmSync(dbPath);
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
    expect(output).toContain("--db");
  });

  it("SSE server returns CORS headers for localhost origin", async () => {
    const dbPath = join(tmpdir(), `cli-cors-${Date.now()}.db`);
    const seedPath = writeSeedFile(validSeed);
    try {
      run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });

      // Use port 0 to let the OS pick an ephemeral port
      const child = execFile("npx", ["tsx", CLI, "serve", "--transport", "sse", "--port", "0", "--mcp-only", "--db", dbPath], {
        cwd: join(import.meta.dirname, "../.."),
        env: { ...process.env, AGENTIC_DB_PATH: dbPath, DEFCON_ADMIN_TOKEN: "test-token", DEFCON_WORKER_TOKEN: "test-worker-token" },
      });

      // Poll until server is ready instead of fixed sleep
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
      if (existsSync(dbPath)) rmSync(dbPath);
      if (existsSync(seedPath)) rmSync(seedPath);
    }
  }, 15000);

  it("status --help shows status options", () => {
    const output = run(["status", "--help"]);
    expect(output).toContain("--flow");
    expect(output).toContain("--state");
    expect(output).toContain("--json");
    expect(output).toContain("--db");
  });

  it("status prints table for initialized db", () => {
    const dbPath = join(tmpdir(), `cli-status-${Date.now()}.db`);
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    const output = run(["status"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toContain("pr-review");
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("status --json outputs valid JSON", { timeout: 15000 }, () => {
    const dbPath = join(tmpdir(), `cli-status-json-${Date.now()}.db`);
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath, DEFCON_SEED_ROOT: tmpdir() });
    const output = run(["status", "--json"], { AGENTIC_DB_PATH: dbPath });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("flows");
    if (existsSync(dbPath)) rmSync(dbPath);
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

describe("CLI validation", () => {
  it("serve rejects non-numeric --reaper-interval", () => {
    const dbPath = join(tmpdir(), `cli-serve-nan-${Date.now()}.db`);
    const output = runExpectFail(["serve", "--reaper-interval", "abc"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toMatch(/reaper-interval/i);
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("serve rejects --reaper-interval below 1000", () => {
    const dbPath = join(tmpdir(), `cli-serve-low-${Date.now()}.db`);
    const output = runExpectFail(["serve", "--reaper-interval", "500"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toMatch(/reaper-interval/i);
    if (existsSync(dbPath)) rmSync(dbPath);
  });

});
