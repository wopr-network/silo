import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeDispatcher } from "./claude-code-dispatcher.js";
import type { DispatchOpts } from "./types.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);

function makeFakeProcess(stdout: string, exitCode: number, delay = 0): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = Readable.from([stdout]);
  proc.stderr = Readable.from([""]);
  proc.kill = vi.fn().mockReturnValue(true);
  (proc as { pid: number }).pid = 12345;
  setTimeout(() => proc.emit("close", exitCode), delay);
  return proc;
}

const defaultOpts: DispatchOpts = {
  modelTier: "sonnet",
  workerId: "w-1",
  entityId: "e-1",
};

describe("ClaudeCodeDispatcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawns claude with correct args", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("Spec ready: WOP-100", 0));

    const dispatcher = new ClaudeCodeDispatcher();
    await dispatcher.dispatch("do stuff", defaultOpts);

    expect(mockedSpawn).toHaveBeenCalledWith(
      "claude",
      ["-p", "do stuff", "--model", "sonnet", "--allowedTools", "Edit,Read,Write,Bash,Glob,Grep"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "inherit"] }),
    );
  });

  it("returns parsed signal and exitCode 0 on success", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("Spec ready: WOP-1934", 0));

    const dispatcher = new ClaudeCodeDispatcher();
    const result = await dispatcher.dispatch("write spec", defaultOpts);

    expect(result).toEqual({
      signal: "spec_ready",
      artifacts: { issueKey: "WOP-1934" },
      exitCode: 0,
    });
  });

  it("returns pr_created with artifacts", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("PR created: https://github.com/wopr-network/radar/pull/99", 0));

    const dispatcher = new ClaudeCodeDispatcher();
    const result = await dispatcher.dispatch("create pr", defaultOpts);

    expect(result.signal).toBe("pr_created");
    expect(result.artifacts).toEqual({
      prUrl: "https://github.com/wopr-network/radar/pull/99",
      prNumber: 99,
    });
  });

  it("returns crash signal on non-zero exit with no recognized output", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("segfault", 1));

    const dispatcher = new ClaudeCodeDispatcher();
    const result = await dispatcher.dispatch("do stuff", defaultOpts);

    expect(result).toEqual({
      signal: "crash",
      artifacts: {},
      exitCode: 1,
    });
  });

  it("returns timeout signal when subprocess exceeds timeout", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("Spec ready: WOP-1", 0, 500));

    const dispatcher = new ClaudeCodeDispatcher();
    const result = await dispatcher.dispatch("slow task", {
      ...defaultOpts,
      timeout: 50,
    });

    expect(result.signal).toBe("timeout");
    expect(result.exitCode).toBe(-1);
  });

  it("uses custom claudePath when provided", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("Spec ready: WOP-1", 0));

    const dispatcher = new ClaudeCodeDispatcher("/usr/local/bin/claude");
    await dispatcher.dispatch("do stuff", defaultOpts);

    expect(mockedSpawn).toHaveBeenCalledWith("/usr/local/bin/claude", expect.any(Array), expect.any(Object));
  });

  it("uses opus model tier in args", async () => {
    mockedSpawn.mockReturnValue(makeFakeProcess("Spec ready: WOP-1", 0));

    const dispatcher = new ClaudeCodeDispatcher();
    await dispatcher.dispatch("do stuff", { ...defaultOpts, modelTier: "opus" });

    expect(mockedSpawn).toHaveBeenCalledWith("claude", expect.arrayContaining(["--model", "opus"]), expect.any(Object));
  });

  it("handles spawn error (ENOENT)", async () => {
    const proc = new EventEmitter() as ChildProcess;
    proc.stdout = Readable.from([""]);
    proc.stderr = Readable.from([""]);
    proc.kill = vi.fn().mockReturnValue(true);
    (proc as { pid: undefined }).pid = undefined;
    mockedSpawn.mockReturnValue(proc);
    setTimeout(() => proc.emit("error", new Error("spawn claude ENOENT")), 5);

    const dispatcher = new ClaudeCodeDispatcher();
    const result = await dispatcher.dispatch("do stuff", defaultOpts);

    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(-1);
    expect(result.artifacts).toHaveProperty("error");
  });
});
