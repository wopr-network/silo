import type { IEntityActivityRepo } from "../radar-db/repos/entity-activity-repo.js";
import type { Dispatcher, DispatchOpts, WorkerResult } from "./types.js";

const DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Dummy dispatcher for local testing — no Claude API calls.
 * Emits a realistic sequence of activity events, then returns spec_ready.
 */
export class DummyDispatcher implements Dispatcher {
  constructor(private activityRepo: IEntityActivityRepo) {}

  async dispatch(_prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId: slotId } = opts;

    await this.activityRepo.insert({ entityId, slotId, type: "start", data: {} });
    await sleep(DELAY_MS);

    await this.activityRepo.insert({
      entityId,
      slotId,
      type: "tool_use",
      data: { name: "Read", input: { file_path: "/data/worktrees/stub/CLAUDE.md" } },
    });
    await sleep(DELAY_MS);

    await this.activityRepo.insert({
      entityId,
      slotId,
      type: "tool_use",
      data: { name: "Glob", input: { pattern: "src/**/*.ts" } },
    });
    await sleep(DELAY_MS);

    await this.activityRepo.insert({
      entityId,
      slotId,
      type: "text",
      data: {
        text: "I've read the codebase. Here is my implementation spec:\n\n1. Modify the relevant file\n2. Add tests\n3. Commit\n\nSpec ready: STUB-001",
      },
    });
    await sleep(DELAY_MS);

    await this.activityRepo.insert({
      entityId,
      slotId,
      type: "result",
      data: { subtype: "end_turn", cost_usd: 0, stop_reason: "end_turn" },
    });

    return { signal: "spec_ready", artifacts: {}, exitCode: 0 };
  }
}
