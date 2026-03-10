import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import Handlebars from "handlebars";
import { logger } from "../logger.js";
import type { IEntityActivityRepo } from "../radar-db/repos/entity-activity-repo.js";
import { processEvents } from "./process-events.js";
import { SdkEventEmitter } from "./sdk-event-emitter.js";
import type { DispatchOpts, INukeDispatcher, WorkerResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_AGENTS_DIR = join(homedir(), ".claude", "agents");

const MODEL_MAP: Record<DispatchOpts["modelTier"], string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

function loadAgentMd(agentsDir: string, agentRole: string): string | null {
  // Reject roles containing path separators or dots to prevent path traversal.
  if (!/^[\w-]+$/.test(agentRole)) {
    logger.warn(`[claude] agentRole "${agentRole}" contains invalid characters — skipping MD load`);
    return null;
  }
  const resolvedDir = resolve(agentsDir);
  const resolvedFile = resolve(join(resolvedDir, `${agentRole}.md`));
  const rel = relative(resolvedDir, resolvedFile);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    logger.warn(`[claude] agentRole path "${resolvedFile}" escapes agentsDir — skipping MD load`);
    return null;
  }
  try {
    return readFileSync(resolvedFile, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`[claude] failed to load agent MD "${resolvedFile}"`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

export class SdkDispatcher implements INukeDispatcher {
  private agentsDir: string;

  constructor(
    private activityRepo: IEntityActivityRepo,
    agentsDir?: string,
  ) {
    this.agentsDir = agentsDir ?? DEFAULT_AGENTS_DIR;
  }

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId: slotId, modelTier, agentRole, timeout = DEFAULT_TIMEOUT_MS, templateContext } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const rawAgentMd = agentRole ? loadAgentMd(this.agentsDir, agentRole) : null;
      let agentMd = rawAgentMd;
      if (rawAgentMd && templateContext) {
        try {
          agentMd = Handlebars.compile(rawAgentMd)(templateContext);
        } catch (err) {
          logger.warn(`[claude] failed to render agent MD template for "${agentRole}"`, {
            error: err instanceof Error ? err.message : String(err),
          });
          agentMd = rawAgentMd;
        }
      }
      // History injection is handled by the run-loop before calling dispatch().
      // SdkDispatcher dispatches with whatever prompt it receives.
      const fullPrompt = agentMd ? `${agentMd}\n\n---\n\n${prompt}` : prompt;

      logger.info(`[claude] [${slotId}] START`, {
        entity: entityId,
        model: MODEL_MAP[modelTier],
        ...(agentRole ? { agentRole } : {}),
      });
      try {
        await this.activityRepo.insert({ entityId, slotId, type: "start", data: {} });
      } catch (dbErr) {
        logger.error(`[claude] [${slotId}] activity insert error`, {
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }

      // Strip CLAUDECODE env var so the claude subprocess doesn't refuse to start
      // when radar itself is running inside a Claude Code session.
      const env = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      delete env.CLAUDECODE;

      const linearApiKey = env.LINEAR_API_KEY;
      // Linear's official MCP is a remote server; mcp-remote bridges it as stdio.
      // The Authorization header must be passed as a CLI arg — mcp-remote has no env-var
      // alternative for custom headers. The key is visible in /proc/<pid>/cmdline on Linux.
      const mcpServers = linearApiKey
        ? {
            "linear-server": {
              type: "stdio" as const,
              command: "npx",
              args: [
                "-y",
                "mcp-remote",
                "https://mcp.linear.app/mcp",
                "--header",
                `Authorization: Bearer ${linearApiKey}`,
              ],
              env,
            },
          }
        : undefined;

      const emitter = new SdkEventEmitter(fullPrompt, {
        abortController: controller,
        model: MODEL_MAP[modelTier],
        permissionMode: "bypassPermissions",
        ...(mcpServers ? { mcpServers } : {}),
        env,
        /* v8 ignore next */
        stderr: (line: string) => process.stderr.write(`[sdk] ${line}`),
      });

      return await processEvents(emitter, entityId, slotId, this.activityRepo);
    } catch (err) {
      if (controller.signal.aborted) {
        logger.warn(`[claude] [${slotId}] TIMEOUT`);
        return { signal: "timeout", artifacts: {}, exitCode: -1 };
      }
      logger.error(`[claude] [${slotId}] ERROR`, { error: err instanceof Error ? err.message : String(err) });
      return {
        signal: "crash",
        artifacts: { error: err instanceof Error ? err.message : String(err) },
        exitCode: -1,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
