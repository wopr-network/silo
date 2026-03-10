import { describe, expect, it, vi } from "vitest";
import type { IEntityActivityRepo } from "../radar-db/repos/entity-activity-repo.js";
import { processEvents } from "./process-events.js";
import type { INukeEventEmitter, NukeEvent } from "./types.js";

function makeRepo(): IEntityActivityRepo {
  return {
    insert: vi
      .fn()
      .mockResolvedValue({ id: "x", entityId: "e1", slotId: "s1", seq: 0, type: "start", data: {}, createdAt: 0 }),
    getByEntity: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue(""),
    deleteByEntity: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEmitter(events: NukeEvent[]): INukeEventEmitter {
  return {
    async *events() {
      for (const e of events) yield e;
    },
  };
}

describe("processEvents", () => {
  it("inserts tool_use activity row", async () => {
    const repo = makeRepo();
    await processEvents(
      makeEmitter([
        { type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } },
        { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0.001 },
      ]),
      "e1",
      "s1",
      repo,
    );
    const calls = vi.mocked(repo.insert).mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.type === "tool_use" && (c.data as { name: string }).name === "Read")).toBe(true);
  });

  it("inserts text activity row and accumulates for signal parsing", async () => {
    const repo = makeRepo();
    const result = await processEvents(
      makeEmitter([
        { type: "text", text: "PR created: https://github.com/wopr-network/radar/pull/42" },
        { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0 },
      ]),
      "e1",
      "s1",
      repo,
    );
    const calls = vi.mocked(repo.insert).mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.type === "text")).toBe(true);
    expect(result.signal).toBe("pr_created");
    expect(result.exitCode).toBe(0);
  });

  it("returns crash when result isError=true", async () => {
    const result = await processEvents(
      makeEmitter([{ type: "result", subtype: "error_max_turns", isError: true, stopReason: "max_turns", costUsd: 0 }]),
      "e1",
      "s1",
      makeRepo(),
    );
    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(1);
  });

  it("returns crash when stream ends without result event", async () => {
    const result = await processEvents(makeEmitter([{ type: "system", subtype: "init" }]), "e1", "s1", makeRepo());
    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(-1);
  });

  it("merges artifacts from ARTIFACTS HTML comment into result", async () => {
    const repo = makeRepo();
    const result = await processEvents(
      makeEmitter([
        { type: "text", text: '<!-- ARTIFACTS: {"reviewCommentId":"cmt-99"} -->' },
        { type: "text", text: "ISSUES: https://github.com/org/repo/pull/7 — stale import; missing test" },
        { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0 },
      ]),
      "e1",
      "s1",
      repo,
    );
    expect(result.signal).toBe("issues");
    expect(result.artifacts.url).toBe("https://github.com/org/repo/pull/7");
    expect(result.artifacts.reviewFindings).toEqual(["stale import", "missing test"]);
    expect(result.artifacts.reviewCommentId).toBe("cmt-99");
  });

  it("continues processing after repo insert failure", async () => {
    const repo = makeRepo();
    vi.mocked(repo.insert).mockRejectedValueOnce(new Error("db down"));
    const result = await processEvents(
      makeEmitter([
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
        { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0 },
      ]),
      "e1",
      "s1",
      repo,
    );
    expect(result.signal).not.toBe(undefined);
    expect(result.exitCode).toBe(0);
  });
});
