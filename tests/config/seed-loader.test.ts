import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import { loadSeed } from "../../src/config/seed-loader.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";

const TEST_TENANT = "test-tenant";

function writeSeedFile(seed: unknown): string {
  const dir = join(tmpdir(), `seed-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "seed.json");
  writeFileSync(path, JSON.stringify(seed));
  return path;
}

const validSeed = {
  flows: [{ name: "pr-review", initialState: "open", discipline: "engineering" }],
  states: [
    { name: "open", flowName: "pr-review", mode: "passive", promptTemplate: "Review this PR" },
    { name: "reviewing", flowName: "pr-review" },
  ],
  gates: [{ name: "lint-pass", type: "command", command: "gates/blocking-graph.ts" }],
  transitions: [
    {
      flowName: "pr-review",
      fromState: "open",
      toState: "reviewing",
      trigger: "claim",
      gateName: "lint-pass",
    },
  ],
};

const tmpRoot = realpathSync(tmpdir());

describe("loadSeed", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let flowRepo: DrizzleFlowRepository;
  let gateRepo: DrizzleGateRepository;

  beforeEach(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;
    flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
    gateRepo = new DrizzleGateRepository(db, TEST_TENANT);
  });

  afterEach(async () => {
    await close();
  });

  it("loads a valid seed file and creates all records", async () => {
    const seedPath = writeSeedFile(validSeed);

    const result = await loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot });

    expect(result).toEqual({ flows: 1, gates: 1 });

    const flow = await flowRepo.getByName("pr-review");
    expect(flow).not.toBeNull();
    expect(flow?.states).toHaveLength(2);
    expect(flow?.transitions).toHaveLength(1);
    expect(flow?.initialState).toBe("open");

    const gate = await gateRepo.getByName("lint-pass");
    expect(gate).not.toBeNull();
    expect(gate?.type).toBe("command");

    expect(flow?.transitions[0].gateId).toBe(gate?.id);
  });

  it("rejects invalid seed file with Zod errors", async () => {
    const seedPath = writeSeedFile({ flows: [], states: [], transitions: [] });

    await expect(loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot })).rejects.toThrow();
  });

  it("rejects non-existent file", async () => {
    await expect(loadSeed(join(tmpRoot, "nonexistent-seed.json"), flowRepo, gateRepo, { allowedRoot: tmpRoot })).rejects.toThrow();
  });

  it("loads seed without gates", async () => {
    const seed = {
      flows: [{ name: "simple", initialState: "start", discipline: "engineering" }],
      states: [{ name: "start", flowName: "simple" }],
      transitions: [{ flowName: "simple", fromState: "start", toState: "start", trigger: "loop" }],
    };
    const seedPath = writeSeedFile(seed);

    const result = await loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot });
    expect(result).toEqual({ flows: 1, gates: 0 });
  });

  it("throws a descriptive error when a transition references an unknown gate", async () => {
    const seed = {
      flows: [{ name: "broken", initialState: "start", discipline: "engineering" }],
      states: [{ name: "start", flowName: "broken" }, { name: "end", flowName: "broken" }],
      gates: [],
      transitions: [
        { flowName: "broken", fromState: "start", toState: "end", trigger: "go", gateName: "nonexistent-gate" },
      ],
    };
    const seedPath = writeSeedFile(seed);

    // The Zod schema validates gate references and throws with a descriptive message
    await expect(loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot })).rejects.toThrow(
      "nonexistent-gate",
    );
  });

  it("rejects a seed path outside the allowed root", async () => {
    await expect(
      loadSeed("/etc/passwd", flowRepo, gateRepo, { allowedRoot: "/home/fake" }),
    ).rejects.toThrow("Seed path escapes allowed root");
  });

  it("rejects path traversal via relative segments", async () => {
    const cwd = process.cwd();

    await expect(
      loadSeed("../../etc/passwd", flowRepo, gateRepo, { allowedRoot: cwd }),
    ).rejects.toThrow("Seed path escapes allowed root");
  });

  it("rejects symlink escape", async () => {
    const dir = join(tmpRoot, `seed-symlink-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const link = join(dir, "evil.json");
    try {
      symlinkSync("/etc/hostname", link);
    } catch {
      return;
    }

    await expect(
      loadSeed(link, flowRepo, gateRepo, { allowedRoot: dir }),
    ).rejects.toThrow("Seed path escapes allowed root");
  });

  it("rejects a path whose prefix matches root but is not a child", async () => {
    // startsWith("/tmp/foo/") would allow /tmp/foobar — relative() check prevents this
    const dir = join(tmpRoot, `seed-prefix-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const adjacentDir = dir + "-other";
    mkdirSync(adjacentDir, { recursive: true });
    const seedPath = join(adjacentDir, "seed.json");
    writeFileSync(seedPath, JSON.stringify(validSeed));

    await expect(
      loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: dir }),
    ).rejects.toThrow("Seed path escapes allowed root");
  });

  it("throws a friendly error on malformed JSON", async () => {
    const dir = join(tmpRoot, `seed-malformed-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const seedPath = join(dir, "bad.json");
    writeFileSync(seedPath, "{ not valid json !!");

    await expect(
      loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot }),
    ).rejects.toThrow(/Invalid JSON in seed file/);
  });

  it("preserves SyntaxError cause on malformed JSON", async () => {
    const dir = join(tmpRoot, `seed-cause-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const seedPath = join(dir, "bad.json");
    writeFileSync(seedPath, "{ not valid json !!");

    let thrown: unknown;
    try {
      await loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error & { cause?: unknown }).cause).toBeInstanceOf(SyntaxError);
  });

  it("accepts a seed path within the allowed root", async () => {
    const seedPath = writeSeedFile(validSeed);

    const result = await loadSeed(seedPath, flowRepo, gateRepo, { allowedRoot: tmpRoot });
    expect(result).toEqual({ flows: 1, gates: 1 });
  });
});
