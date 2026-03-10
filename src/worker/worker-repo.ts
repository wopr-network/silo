import { randomUUID } from "node:crypto";
import type { Worker } from "./types.js";

function generateWorkerId(): string {
  return `wkr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function generateWorkerName(): string {
  return `auto-${randomUUID().slice(0, 8)}`;
}

export interface IWorkerRepo {
  create(opts: { type?: string; discipline?: string }): Worker;
  get(id: string): Worker | undefined;
  touch(id: string): void;
  list(): Worker[];
}

export class InMemoryWorkerRepo implements IWorkerRepo {
  private workers: Map<string, Worker> = new Map();

  create(opts: { type?: string; discipline?: string }): Worker {
    const now = new Date();
    const worker: Worker = {
      id: generateWorkerId(),
      name: generateWorkerName(),
      type: opts.type ?? "unknown",
      discipline: opts.discipline ?? null,
      status: "idle",
      createdAt: now,
      lastActivityAt: now,
    };
    this.workers.set(worker.id, worker);
    return worker;
  }

  get(id: string): Worker | undefined {
    return this.workers.get(id);
  }

  touch(id: string): void {
    const worker = this.workers.get(id);
    if (worker) {
      worker.lastActivityAt = new Date();
    }
  }

  list(): Worker[] {
    return Array.from(this.workers.values());
  }
}
