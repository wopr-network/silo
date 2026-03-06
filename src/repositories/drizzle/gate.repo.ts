import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { CreateGateInput, Gate, GateResult, IGateRepository } from "../interfaces.js";
import type * as schema from "./schema.js";
import { gateDefinitions, gateResults } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

function toGate(row: typeof gateDefinitions.$inferSelect): Gate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    command: row.command,
    functionRef: row.functionRef,
    apiConfig: row.apiConfig as Record<string, unknown> | null,
    timeoutMs: row.timeoutMs ?? 30000,
  };
}

function toGateResult(row: typeof gateResults.$inferSelect): GateResult {
  return {
    id: row.id,
    entityId: row.entityId,
    gateId: row.gateId,
    passed: !!row.passed,
    output: row.output,
    evaluatedAt: row.evaluatedAt != null ? new Date(row.evaluatedAt) : null,
  };
}

export class DrizzleGateRepository implements IGateRepository {
  constructor(private db: Db) {}

  async create(gate: CreateGateInput): Promise<Gate> {
    const id = randomUUID();
    const values: typeof gateDefinitions.$inferInsert = {
      id,
      name: gate.name,
      type: gate.type,
      command: gate.command ?? null,
      functionRef: gate.functionRef ?? null,
      apiConfig: gate.apiConfig ?? null,
      ...(gate.timeoutMs != null ? { timeoutMs: gate.timeoutMs } : {}),
    };
    this.db.insert(gateDefinitions).values(values).run();
    const row = this.db.select().from(gateDefinitions).where(eq(gateDefinitions.id, id)).get();
    if (!row) throw new Error(`Gate ${id} not found after insert`);
    return toGate(row);
  }

  async get(id: string): Promise<Gate | null> {
    const row = this.db.select().from(gateDefinitions).where(eq(gateDefinitions.id, id)).get();
    return row ? toGate(row) : null;
  }

  async getByName(name: string): Promise<Gate | null> {
    const row = this.db.select().from(gateDefinitions).where(eq(gateDefinitions.name, name)).get();
    return row ? toGate(row) : null;
  }

  async record(entityId: string, gateId: string, passed: boolean, output: string): Promise<GateResult> {
    const id = randomUUID();
    const evaluatedAt = Date.now();
    this.db
      .insert(gateResults)
      .values({
        id,
        entityId,
        gateId,
        passed: passed ? 1 : 0,
        output,
        evaluatedAt,
      })
      .run();
    const row = this.db.select().from(gateResults).where(eq(gateResults.id, id)).get();
    if (!row) throw new Error(`GateResult ${id} not found after insert`);
    return toGateResult(row);
  }

  async resultsFor(entityId: string): Promise<GateResult[]> {
    const rows = this.db
      .select()
      .from(gateResults)
      .where(eq(gateResults.entityId, entityId))
      .orderBy(asc(gateResults.evaluatedAt), sql`rowid`)
      .all();
    return rows.map(toGateResult);
  }
}
