import { and, eq, lt, ne } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { workers } from "../schema.js";
import type { IWorkerRepo } from "../types.js";

export interface RegisterWorkerInput {
  name: string;
  type: string;
  discipline: string;
  config?: Record<string, unknown>;
}

export interface WorkerRow {
  id: string;
  name: string;
  type: string;
  discipline: string;
  status: string;
  config: Record<string, unknown> | null;
  lastHeartbeat: number;
  createdAt: number;
}

function toRow(raw: typeof workers.$inferSelect): WorkerRow {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    discipline: raw.discipline,
    status: raw.status,
    config: raw.config ? (JSON.parse(raw.config) as Record<string, unknown>) : null,
    lastHeartbeat: raw.lastHeartbeat,
    createdAt: raw.createdAt,
  };
}

export class WorkerRepo implements IWorkerRepo {
  constructor(private db: RadarDb) {}

  async register(input: RegisterWorkerInput): Promise<WorkerRow> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.db
      .insert(workers)
      .values({
        id,
        name: input.name,
        type: input.type,
        discipline: input.discipline,
        status: "idle",
        config: input.config ? JSON.stringify(input.config) : null,
        lastHeartbeat: now,
        createdAt: now,
      })
      .run();
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  async deregister(id: string): Promise<void> {
    this.db.delete(workers).where(eq(workers.id, id)).run();
  }

  async heartbeat(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    if (!row) throw new Error(`Unknown worker: ${id}`);
    this.db.update(workers).set({ lastHeartbeat: now }).where(eq(workers.id, id)).run();
  }

  async setStatus(id: string, status: string): Promise<void> {
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    if (!row) throw new Error(`Worker ${id} not found`);
    this.db.update(workers).set({ status }).where(eq(workers.id, id)).run();
  }

  async getById(id: string): Promise<WorkerRow | undefined> {
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    return row ? toRow(row) : undefined;
  }

  async list(): Promise<WorkerRow[]> {
    return this.db.select().from(workers).all().map(toRow);
  }

  async listByStatus(status: string): Promise<WorkerRow[]> {
    return this.db.select().from(workers).where(eq(workers.status, status)).all().map(toRow);
  }

  async findStale(cutoffEpochSec: number): Promise<WorkerRow[]> {
    return this.db
      .select()
      .from(workers)
      .where(and(lt(workers.lastHeartbeat, cutoffEpochSec), ne(workers.status, "offline")))
      .all()
      .map(toRow);
  }
}
