import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "../dispatcher/types.js";
import { Pool } from "../pool/pool.js";
import type { IWorkerRepo, WorkerRow } from "../radar-db/types.js";
import { RunLoop } from "./run-loop.js";
import type { RunLoopConfig } from "./types.js";

function makeWorkerRow(overrides: Partial<WorkerRow> = {}): WorkerRow {
  return {
    id: "worker-1",
    name: "test-worker",
    type: "wopr",
    discipline: "engineering",
    status: "idle",
    config: null,
    lastHeartbeat: 1000,
    createdAt: 1000,
    ...overrides,
  };
}

function makeWorkerRepo(id = "worker-1"): IWorkerRepo {
  const row = makeWorkerRow({ id });
  return {
    register: vi.fn().mockResolvedValue(row),
    deregister: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(row),
    list: vi.fn().mockResolvedValue([row]),
    listByStatus: vi.fn().mockResolvedValue([]),
  } as unknown as IWorkerRepo;
}

function makeDefcon(responses: object[]) {
  const iter = responses[Symbol.iterator]();
  return {
    claim: vi.fn().mockImplementation(() => {
      const { value, done } = iter.next();
      if (done) return Promise.resolve({ retry_after_ms: 50 });
      return Promise.resolve(value);
    }),
    report: vi.fn().mockResolvedValue({ next_action: "waiting" }),
  } as unknown as import("../engine/flow-engine-interface.js").IFlowEngine;
}

function makeDispatcher(): Dispatcher {
  return { dispatch: vi.fn().mockResolvedValue({ signal: "pr_created", artifacts: {}, exitCode: 0 }) };
}

function makeConfig(overrides: Partial<RunLoopConfig> = {}): RunLoopConfig {
  return {
    pool: new Pool(1),
    engine: makeDefcon([{ retry_after_ms: 50 }]),
    dispatcher: makeDispatcher(),
    roles: [{ discipline: "engineering", count: 1 }],
    pollIntervalMs: 5,
    ...overrides,
  };
}

describe("RunLoop — worker registration lifecycle", () => {
  it("calls workerRepo.register on start when workerRepo is provided", async () => {
    const workerRepo = makeWorkerRepo();
    const loop = new RunLoop(
      makeConfig({
        workerRepo,
        workerType: "wopr",
        workerDiscipline: "engineering",
        workerIdPrefix: "wkr",
      }),
    );
    await loop.start();
    await loop.stop();
    expect(workerRepo.register).toHaveBeenCalledOnce();
    const call = (workerRepo.register as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.type).toBe("wopr");
    expect(call.discipline).toBe("engineering");
  });

  it("does not call workerRepo.register when workerRepo is absent", async () => {
    const loop = new RunLoop(makeConfig());
    await loop.start();
    await loop.stop();
    // no error — just testing no crash
  });

  it("calls workerRepo.deregister on stop using the registered id", async () => {
    const workerRepo = makeWorkerRepo("w-abc");
    const loop = new RunLoop(makeConfig({ workerRepo }));
    await loop.start();
    await loop.stop();
    expect(workerRepo.deregister).toHaveBeenCalledWith("w-abc");
  });

  it("calls workerRepo.heartbeat on the heartbeat interval", async () => {
    vi.useFakeTimers();
    const workerRepo = makeWorkerRepo("w-hb");
    const loop = new RunLoop(makeConfig({ workerRepo, pollIntervalMs: 100 }));
    await loop.start();

    // Advance past one heartbeat interval
    await vi.advanceTimersByTimeAsync(110);

    expect(workerRepo.heartbeat).toHaveBeenCalledWith("w-hb");

    vi.useRealTimers();
    await loop.stop();
  });

  it("does not crash if workerRepo.deregister throws on stop", async () => {
    const workerRepo = makeWorkerRepo();
    (workerRepo.deregister as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db error"));
    const loop = new RunLoop(makeConfig({ workerRepo }));
    await loop.start();
    await expect(loop.stop()).resolves.toBeUndefined();
  });

  it("does not crash if workerRepo.heartbeat throws", async () => {
    vi.useFakeTimers();
    const workerRepo = makeWorkerRepo("w-hb2");
    (workerRepo.heartbeat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("heartbeat error"));

    const loop = new RunLoop(makeConfig({ workerRepo, pollIntervalMs: 100 }));
    await loop.start();

    // Advance past one heartbeat interval — should not throw
    await vi.advanceTimersByTimeAsync(110);

    vi.useRealTimers();
    await loop.stop();
  });
});
