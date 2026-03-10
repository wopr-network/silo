import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface LitestreamConfig {
  dbPath: string;
  replicaUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  region: string;
  retention: string;
  syncInterval: string;
}

export function isLitestreamEnabled(): boolean {
  return !!process.env.SILO_LITESTREAM_REPLICA_URL?.trim();
}

export function buildConfigFromEnv(dbPath: string): LitestreamConfig {
  const replicaUrl = process.env.SILO_LITESTREAM_REPLICA_URL ?? "";
  const accessKeyId = process.env.SILO_LITESTREAM_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SILO_LITESTREAM_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "SILO_LITESTREAM_ACCESS_KEY_ID and SILO_LITESTREAM_SECRET_ACCESS_KEY must be set when SILO_LITESTREAM_REPLICA_URL is configured",
    );
  }
  return {
    dbPath: resolve(dbPath),
    replicaUrl,
    accessKeyId,
    secretAccessKey,
    endpoint: process.env.SILO_LITESTREAM_ENDPOINT || undefined,
    region: process.env.SILO_LITESTREAM_REGION || "us-east-1",
    retention: process.env.SILO_LITESTREAM_RETENTION || "24h",
    syncInterval: process.env.SILO_LITESTREAM_SYNC_INTERVAL || "1s",
  };
}

export class LitestreamManager {
  private config: LitestreamConfig;
  private configPath: string;
  private child: ChildProcess | null = null;

  constructor(config: LitestreamConfig) {
    this.config = config;
    this.configPath = join(tmpdir(), `litestream-${process.pid}.yml`);
  }

  generateConfig(): string {
    const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
    const endpoint = this.config.endpoint ? `        endpoint: ${q(this.config.endpoint)}\n` : "";
    return `dbs:
  - path: ${q(this.config.dbPath)}
    replicas:
      - type: s3
        url: ${q(this.config.replicaUrl)}
${endpoint}        region: ${q(this.config.region)}
        retention: ${q(this.config.retention)}
        sync-interval: ${q(this.config.syncInterval)}
`;
  }

  restore(): void {
    if (existsSync(this.config.dbPath)) {
      process.stderr.write(`[litestream] DB exists at ${this.config.dbPath}, skipping restore\n`);
      return;
    }
    const dir = dirname(this.config.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.writeConfig();
    process.stderr.write(`[litestream] Restoring from ${this.config.replicaUrl}...\n`);
    const result = spawnSync("litestream", ["restore", "-config", this.configPath, this.config.dbPath], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      env: {
        ...process.env,
        LITESTREAM_ACCESS_KEY_ID: this.config.accessKeyId,
        LITESTREAM_SECRET_ACCESS_KEY: this.config.secretAccessKey,
      },
    });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? "";
      if (stderr.includes("no generations found")) {
        process.stderr.write(`[litestream] No replica found, starting fresh\n`);
      } else {
        throw new Error(`[litestream] Restore failed: ${stderr}`);
      }
    } else {
      process.stderr.write(`[litestream] Restore complete\n`);
    }
  }

  start(): void {
    this.writeConfig();
    process.stderr.write(`[litestream] Starting replication to ${this.config.replicaUrl}\n`);
    this.child = spawn("litestream", ["replicate", "-config", this.configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LITESTREAM_ACCESS_KEY_ID: this.config.accessKeyId,
        LITESTREAM_SECRET_ACCESS_KEY: this.config.secretAccessKey,
      },
    });
    this.child.stdout?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[litestream] ${chunk.toString()}`);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[litestream] ${chunk.toString()}`);
    });
    this.child.on("exit", (code) => {
      process.stderr.write(`[litestream] Process exited with code ${code}\n`);
      this.child = null;
    });
    this.child.on("error", (err) => {
      process.stderr.write(`[litestream] Process error: ${err.message}\n`);
      this.child = null;
    });
  }

  close(): Promise<void> {
    if (!this.child) {
      return Promise.resolve();
    }
    const child = this.child;
    return new Promise((resolve) => {
      process.stderr.write(`[litestream] Stopping replication\n`);
      child.once("exit", () => {
        this.child = null;
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private writeConfig(): void {
    writeFileSync(this.configPath, this.generateConfig());
  }
}
