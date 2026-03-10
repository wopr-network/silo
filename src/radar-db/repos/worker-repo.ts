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
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async register(input: RegisterWorkerInput): Promise<WorkerRow> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.db.insert(workers).values({
      id,
      tenantId: this.tenantId,
      name: input.name,
      type: input.type,
      discipline: input.discipline,
      status: "idle",
      config: input.config ? JSON.stringify(input.config) : null,
      lastHeartbeat: now,
      createdAt: now,
    });
    const [row] = await this.db.select().from(workers).where(eq(workers.id, id));
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  async deregister(id: string): Promise<void> {
    await this.db.delete(workers).where(and(eq(workers.id, id), eq(workers.tenantId, this.tenantId)));
  }

  async heartbeat(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const cond = and(eq(workers.id, id), eq(workers.tenantId, this.tenantId));
    const [row] = await this.db.select().from(workers).where(cond);
    if (!row) throw new Error(`Unknown worker: ${id}`);
    await this.db.update(workers).set({ lastHeartbeat: now }).where(cond);
  }

  async setStatus(id: string, status: string): Promise<void> {
    const cond = and(eq(workers.id, id), eq(workers.tenantId, this.tenantId));
    const [row] = await this.db.select().from(workers).where(cond);
    if (!row) throw new Error(`Worker ${id} not found`);
    await this.db.update(workers).set({ status }).where(cond);
  }

  async getById(id: string): Promise<WorkerRow | undefined> {
    const [row] = await this.db
      .select()
      .from(workers)
      .where(and(eq(workers.id, id), eq(workers.tenantId, this.tenantId)));
    return row ? toRow(row) : undefined;
  }

  async list(): Promise<WorkerRow[]> {
    const rows = await this.db.select().from(workers).where(eq(workers.tenantId, this.tenantId));
    return rows.map(toRow);
  }

  async listByStatus(status: string): Promise<WorkerRow[]> {
    const rows = await this.db
      .select()
      .from(workers)
      .where(and(eq(workers.status, status), eq(workers.tenantId, this.tenantId)));
    return rows.map(toRow);
  }

  async findStale(cutoffEpochSec: number): Promise<WorkerRow[]> {
    const rows = await this.db
      .select()
      .from(workers)
      .where(
        and(
          lt(workers.lastHeartbeat, cutoffEpochSec),
          ne(workers.status, "offline"),
          eq(workers.tenantId, this.tenantId),
        ),
      );
    return rows.map(toRow);
  }
}
