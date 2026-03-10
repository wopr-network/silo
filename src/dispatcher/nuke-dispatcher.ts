import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import type { IEntityActivityRepo } from "../radar-db/repos/i-entity-activity-repo.js";
import type { Dispatcher, DispatchOpts, WorkerResult } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_NUKE_PORT = 8080;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface ContainerHandle {
  containerId: string;
  hostPort: number;
  sessionId: string | null;
}

interface NukeSseEvent {
  type: string;
  [key: string]: unknown;
}

export interface NukeDispatcherOpts {
  image?: string;
  claudeCredentialsPath?: string;
  ghTokenPath?: string;
  network?: string;
}

export class NukeDispatcher implements Dispatcher {
  private image: string;
  private claudeCredentialsPath?: string;
  private ghTokenPath?: string;
  private network?: string;
  private containers = new Map<string, ContainerHandle>();
  private inFlight = new Map<string, Promise<ContainerHandle>>();

  constructor(
    private activityRepo: IEntityActivityRepo,
    opts: NukeDispatcherOpts = {},
  ) {
    this.image = opts.image ?? process.env.NUKE_IMAGE ?? "wopr-nuke-coder";
    this.claudeCredentialsPath = opts.claudeCredentialsPath ?? process.env.CLAUDE_CREDENTIALS_PATH;
    this.ghTokenPath = opts.ghTokenPath ?? process.env.GH_TOKEN_PATH;
    this.network = opts.network ?? process.env.NUKE_NETWORK;
  }

  private async launchContainer(
    entityId: string,
    image: string,
    opts: {
      claudeCredentialsPath?: string;
      ghTokenPath?: string;
      network?: string;
      agentsDir?: string;
      linearApiKey?: string;
    },
  ): Promise<ContainerHandle> {
    const containerPort = DEFAULT_NUKE_PORT;
    const name = `nuke-${entityId.slice(0, 12)}-${randomUUID().slice(0, 6)}`;

    const args = [
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `0:${containerPort}`, // random host port
      "--label",
      `nuke.entity=${entityId}`,
    ];

    if (opts.network) {
      args.push("--network", opts.network);
    }
    if (opts.claudeCredentialsPath) {
      args.push("-v", `${opts.claudeCredentialsPath}:/run/secrets/claude-credentials:ro`);
    }
    if (opts.ghTokenPath) {
      args.push("-v", `${opts.ghTokenPath}:/run/secrets/gh-token:ro`);
    }
    if (opts.agentsDir) {
      args.push("-v", `${opts.agentsDir}:/run/agents:ro`);
    }
    if (opts.linearApiKey) {
      args.push("-e", "LINEAR_API_KEY");
    }

    args.push(image);

    const { stdout: runOut } = await execFileAsync("docker", args);
    const containerId = runOut.trim();

    // Wait for the host port to be assigned; clean up on any failure
    const maxWait = 15_000;
    const start = Date.now();
    let hostPort: number | null = null;

    try {
      while (Date.now() - start < maxWait) {
        try {
          const { stdout: inspectOut } = await execFileAsync("docker", ["inspect", containerId]);
          const inspect = JSON.parse(inspectOut) as Array<{
            NetworkSettings?: {
              Ports?: Record<string, Array<{ HostPort?: string }>>;
            };
          }>;
          const portMap = inspect[0]?.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
          if (portMap?.[0]?.HostPort) {
            hostPort = Number(portMap[0].HostPort);
            break;
          }
        } catch {
          // retry
        }
        await new Promise<void>((r) => setTimeout(r, 500));
      }

      if (!hostPort) {
        throw new Error(`Container ${containerId} did not expose port within ${maxWait}ms`);
      }

      // Wait for /health — throw if container never becomes healthy
      const healthStart = Date.now();
      let healthy = false;
      while (Date.now() - healthStart < maxWait) {
        try {
          const res = await fetch(`http://127.0.0.1:${hostPort}/health`);
          if (res.ok) {
            healthy = true;
            break;
          }
        } catch {
          // retry
        }
        await new Promise<void>((r) => setTimeout(r, 500));
      }

      if (!healthy) {
        throw new Error(`Container ${containerId} did not become healthy within ${maxWait}ms`);
      }
    } catch (err) {
      // Orphan cleanup: container was started but post-launch setup failed
      try {
        await execFileAsync("docker", ["rm", "-f", containerId]);
      } catch {
        // best effort
      }
      throw err;
    }

    const handle: ContainerHandle = { containerId, hostPort, sessionId: null };
    this.containers.set(entityId, handle);

    logger.info(`[nuke] container launched`, {
      entityId,
      containerId: containerId.slice(0, 12),
      hostPort,
      image,
    });

    return handle;
  }

  private async stopContainer(entityId: string): Promise<void> {
    const handle = this.containers.get(entityId);
    if (!handle) return;
    this.containers.delete(entityId);
    try {
      await execFileAsync("docker", ["rm", "-f", handle.containerId]);
      logger.info(`[nuke] container stopped`, { entityId, containerId: handle.containerId.slice(0, 12) });
    } catch {
      // best effort
    }
  }

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId, modelTier, timeout = DEFAULT_TIMEOUT_MS } = opts;

    // Get or launch container; use in-flight map to prevent duplicate launches
    let handle = this.containers.get(entityId);
    if (!handle) {
      let launch = this.inFlight.get(entityId);
      if (!launch) {
        launch = this.launchContainer(entityId, this.image, {
          claudeCredentialsPath: this.claudeCredentialsPath,
          ghTokenPath: this.ghTokenPath,
          network: this.network,
          agentsDir: process.env.RADAR_AGENTS_DIR,
          linearApiKey: process.env.LINEAR_API_KEY,
        }).finally(() => {
          this.inFlight.delete(entityId);
        });
        this.inFlight.set(entityId, launch);
      }
      try {
        handle = await launch;
      } catch (err) {
        logger.error(`[nuke] failed to launch container`, {
          entityId,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          signal: "crash",
          artifacts: { error: err instanceof Error ? err.message : String(err) },
          exitCode: -1,
        };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`http://127.0.0.1:${handle.hostPort}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          modelTier,
          ...(handle.sessionId ? { sessionId: handle.sessionId } : { newSession: true }),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`nuke /dispatch returned ${res.status}`);
      }

      // Parse SSE stream
      let signal = "crash";
      let artifacts: Record<string, unknown> = {};
      let exitCode = -1;

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("nuke /dispatch response has no body");
      }
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: NukeSseEvent;
          try {
            event = JSON.parse(line.slice(6)) as NukeSseEvent;
          } catch {
            continue;
          }

          if (event.type === "session") {
            handle.sessionId = event.sessionId as string;
          } else if (event.type === "tool_use") {
            await this.safeInsert(entityId, workerId, "tool_use", {
              name: event.name,
              input: event.input,
            });
          } else if (event.type === "text") {
            await this.safeInsert(entityId, workerId, "text", { text: event.text });
          } else if (event.type === "result") {
            signal = (event.signal as string) ?? "crash";
            artifacts = (event.artifacts as Record<string, unknown>) ?? {};
            exitCode = event.isError ? 1 : 0;
            await this.safeInsert(entityId, workerId, "result", {
              subtype: event.subtype,
              cost_usd: event.costUsd,
              stop_reason: event.stopReason,
              signal,
            });
          } else if (event.type === "error") {
            logger.error(`[nuke] container error`, { entityId, message: event.message });
            signal = "crash";
            artifacts = { error: event.message };
            exitCode = -1;
          }
        }
      }

      // Drain remaining buffer after stream ends
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as NukeSseEvent;
            if (event.type === "result") {
              signal = (event.signal as string) ?? "crash";
              artifacts = (event.artifacts as Record<string, unknown>) ?? {};
              exitCode = event.isError ? 1 : 0;
            }
          } catch {
            // malformed final line
          }
        }
      }

      logger.info(`[nuke] dispatch complete`, { entityId, signal, exitCode });
      return { signal, artifacts, exitCode };
    } catch (err) {
      if (controller.signal.aborted) {
        logger.warn(`[nuke] dispatch timeout`, { entityId });
        return { signal: "timeout", artifacts: {}, exitCode: -1 };
      }
      logger.error(`[nuke] dispatch error`, {
        entityId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Container may have crashed — remove so next dispatch gets a fresh one
      await this.stopContainer(entityId);
      return {
        signal: "crash",
        artifacts: { error: err instanceof Error ? err.message : String(err) },
        exitCode: -1,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stop and remove the container for an entity (called on flow complete). */
  async stopEntity(entityId: string): Promise<void> {
    await this.stopContainer(entityId);
  }

  /** Stop all running containers (shutdown hook). */
  async stopAll(): Promise<void> {
    // Drain in-flight launches first to avoid orphaning containers
    await Promise.allSettled([...this.inFlight.values()]);
    const ids = [...this.containers.keys()];
    await Promise.all(ids.map((id) => this.stopContainer(id)));
  }

  private async safeInsert(
    entityId: string,
    slotId: string,
    type: "tool_use" | "text" | "result",
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.activityRepo.insert({ entityId, slotId, type, data });
    } catch (err) {
      logger.error(`[nuke] activity insert error`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
