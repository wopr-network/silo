import { logger } from "../logger.js";
import type { IEntityActivityRepo } from "../radar-db/repos/entity-activity-repo.js";
import { parseArtifacts, parseSignal } from "./parse-signal.js";
import type { INukeEventEmitter, WorkerResult } from "./types.js";

async function safeInsert(
  repo: IEntityActivityRepo,
  input: Parameters<IEntityActivityRepo["insert"]>[0],
  tag: string,
): Promise<void> {
  try {
    await repo.insert(input);
  } catch (dbErr) {
    logger.error(`[claude] [${tag}] activity insert error`, {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }
}

export async function processEvents(
  emitter: INukeEventEmitter,
  entityId: string,
  slotId: string,
  activityRepo: IEntityActivityRepo,
): Promise<WorkerResult> {
  const allTextBlocks: string[] = [];

  for await (const event of emitter.events()) {
    if (event.type === "system") {
      logger.info(`[claude] [${slotId}] system`, { subtype: event.subtype });
    } else if (event.type === "tool_use") {
      logger.info(`[claude] [${slotId}] tool_use`, {
        tool: event.name,
        input: JSON.stringify(event.input).slice(0, 120),
      });
      await safeInsert(
        activityRepo,
        { entityId, slotId, type: "tool_use", data: { name: event.name, input: event.input } },
        slotId,
      );
    } else if (event.type === "text") {
      allTextBlocks.push(event.text);
      logger.info(`[claude] [${slotId}] text`, {
        preview: event.text.slice(0, 200).replace(/\n/g, " "),
      });
      await safeInsert(activityRepo, { entityId, slotId, type: "text", data: { text: event.text } }, slotId);
    } else if (event.type === "result") {
      logger.info(`[claude] [${slotId}] RESULT`, {
        subtype: event.subtype,
        is_error: event.isError,
        stop_reason: event.stopReason,
        cost_usd: event.costUsd?.toFixed(4) ?? "?",
      });
      await safeInsert(
        activityRepo,
        {
          entityId,
          slotId,
          type: "result",
          data: { subtype: event.subtype, cost_usd: event.costUsd, stop_reason: event.stopReason },
        },
        slotId,
      );

      if (event.isError) {
        return { signal: "crash", artifacts: {}, exitCode: 1 };
      }

      const fullOutput = allTextBlocks.join("\n");
      const { signal, artifacts: signalArtifacts } = parseSignal(fullOutput);
      const blockArtifacts = parseArtifacts(fullOutput);
      const artifacts = { ...blockArtifacts, ...signalArtifacts };
      logger.info(`[claude] [${slotId}] parsed signal`, { signal });
      return { signal, artifacts, exitCode: 0 };
    }
  }

  logger.warn(`[claude] [${slotId}] stream ended without result`);
  return { signal: "crash", artifacts: {}, exitCode: -1 };
}
