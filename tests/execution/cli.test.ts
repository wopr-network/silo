import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  flows: [{ name: "pr-review", initialState: "open" }],
  states: [
    { name: "open", flowName: "pr-review" },
    { name: "reviewing", flowName: "pr-review" },
  ],
  gates: [{ name: "lint-pass", type: "command", command: "pnpm lint" }],
  transitions: [
    { flowName: "pr-review", fromState: "open", toState: "reviewing", trigger: "claim", gateName: "lint-pass" },
  ],
};

describe("CLI", () => {
  it("init --seed loads a seed file", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-db-${Date.now()}.db`);
    const output = run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath });
    expect(output).toContain("flows: 1");
    expect(output).toContain("gates: 1");
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("init --seed --force drops existing data first", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-force-${Date.now()}.db`);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath });
    const output = run(["init", "--seed", seedPath, "--force"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toContain("flows: 1");
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("export outputs valid JSON to stdout", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-export-${Date.now()}.db`);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath });
    const output = run(["export"], { AGENTIC_DB_PATH: dbPath });
    const parsed = JSON.parse(output);
    expect(parsed.flows).toHaveLength(1);
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("export --out writes to file", () => {
    const seedPath = writeSeedFile(validSeed);
    const dbPath = join(tmpdir(), `cli-export-file-${Date.now()}.db`);
    const outPath = join(tmpdir(), `cli-export-${Date.now()}.json`);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath });
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
    expect(output).toContain("--db");
  });

  it("run --help shows run options", () => {
    const output = run(["run", "--help"]);
    expect(output).toContain("--flow");
    expect(output).toContain("--once");
    expect(output).toContain("--poll-interval");
    expect(output).toContain("--db");
  });

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
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath });
    const output = run(["status"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toContain("pr-review");
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("status --json outputs valid JSON", { timeout: 15000 }, () => {
    const dbPath = join(tmpdir(), `cli-status-json-${Date.now()}.db`);
    const seedPath = writeSeedFile(validSeed);
    run(["init", "--seed", seedPath], { AGENTIC_DB_PATH: dbPath });
    const output = run(["status", "--json"], { AGENTIC_DB_PATH: dbPath });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("flows");
    if (existsSync(dbPath)) rmSync(dbPath);
  }, 15000);

  it("ingest --help shows ingest options", () => {
    const output = run(["ingest", "--help"]);
    expect(output).toContain("--from");
    expect(output).toContain("--flow");
    expect(output).toContain("--filter");
    expect(output).toContain("--dry-run");
  });

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

  it("run rejects non-numeric --reaper-interval", () => {
    const dbPath = join(tmpdir(), `cli-run-nan-${Date.now()}.db`);
    const output = runExpectFail(["run", "--reaper-interval", "abc"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toMatch(/reaper-interval/i);
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it("run rejects --claim-ttl below 5000", () => {
    const dbPath = join(tmpdir(), `cli-run-ttl-${Date.now()}.db`);
    const output = runExpectFail(["run", "--claim-ttl", "100"], { AGENTIC_DB_PATH: dbPath });
    expect(output).toMatch(/claim-ttl/i);
    if (existsSync(dbPath)) rmSync(dbPath);
  });
});
