import { spawn } from "node:child_process";
import { parseArtifacts, parseSignal } from "./parse-signal.js";
import type { Dispatcher, DispatchOpts, WorkerResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SCAN_LINES = 200;

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const buffers: Buffer[] = [];
  for await (const chunk of stream) {
    buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf-8"));
  }
  return Buffer.concat(buffers).toString("utf-8");
}

export class ClaudeCodeDispatcher implements Dispatcher {
  private claudePath: string;

  constructor(claudePath = "claude") {
    this.claudePath = claudePath;
  }

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT_MS;

    const args = ["-p", prompt, "--model", opts.modelTier, "--allowedTools", "Edit,Read,Write,Bash,Glob,Grep"];

    return new Promise<WorkerResult>((resolve, reject) => {
      const proc = spawn(this.claudePath, args, {
        stdio: ["ignore", "pipe", "inherit"],
      });

      let settled = false;

      const settle = (result: WorkerResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        settle({ signal: "timeout", artifacts: {}, exitCode: -1 });
      }, timeoutMs);

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        settle({
          signal: "crash",
          artifacts: { error: err.message },
          exitCode: -1,
        });
      });

      const stdoutPromise = proc.stdout ? readStream(proc.stdout) : Promise.resolve("");

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        const exitCode = code ?? -1;

        stdoutPromise
          .then((stdout) => {
            const lines = stdout.split("\n");
            const tail = lines.length > MAX_SCAN_LINES ? lines.slice(-MAX_SCAN_LINES).join("\n") : stdout;

            const { signal, artifacts: signalArtifacts } = parseSignal(tail);
            const blockArtifacts = parseArtifacts(tail);
            const artifacts = { ...blockArtifacts, ...signalArtifacts };

            if (signal === "unknown" && exitCode !== 0) {
              settle({ signal: "crash", artifacts: {}, exitCode });
              return;
            }

            settle({ signal, artifacts, exitCode });
          })
          .catch(reject);
      });
    });
  }
}
