import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { InternalError } from "../../errors.js";
import type { CreateGateInput, Gate, GateResult, IGateRepository } from "../interfaces.js";
import { gateDefinitions, gateResults } from "./schema.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat (postgres-js + PGlite)
type Db = any;

function toGate(row: typeof gateDefinitions.$inferSelect): Gate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    command: row.command,
    functionRef: row.functionRef,
    apiConfig: row.apiConfig as Record<string, unknown> | null,
    timeoutMs: row.timeoutMs ?? null,
    failurePrompt: row.failurePrompt ?? null,
    timeoutPrompt: row.timeoutPrompt ?? null,
    outcomes: (row.outcomes as Record<string, { proceed?: boolean; toState?: string }> | null) ?? null,
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
  constructor(
    private db: Db,
    private tenantId: string,
  ) {}

  async create(gate: CreateGateInput): Promise<Gate> {
    const id = randomUUID();
    const values: typeof gateDefinitions.$inferInsert = {
      id,
      tenantId: this.tenantId,
      name: gate.name,
      type: gate.type,
      command: gate.command ?? null,
      functionRef: gate.functionRef ?? null,
      apiConfig: gate.apiConfig ?? null,
      ...(gate.timeoutMs != null ? { timeoutMs: gate.timeoutMs } : {}),
      failurePrompt: gate.failurePrompt ?? null,
      timeoutPrompt: gate.timeoutPrompt ?? null,
      outcomes: gate.outcomes ?? null,
    };
    await this.db.insert(gateDefinitions).values(values);
    const [row] = await this.db.select().from(gateDefinitions).where(eq(gateDefinitions.id, id)).limit(1);
    if (!row) throw new InternalError(`Gate ${id} not found after insert`);
    return toGate(row);
  }

  async get(id: string): Promise<Gate | null> {
    const [row] = await this.db.select().from(gateDefinitions).where(eq(gateDefinitions.id, id)).limit(1);
    return row ? toGate(row) : null;
  }

  async getByName(name: string): Promise<Gate | null> {
    const [row] = await this.db
      .select()
      .from(gateDefinitions)
      .where(and(eq(gateDefinitions.tenantId, this.tenantId), eq(gateDefinitions.name, name)))
      .limit(1);
    return row ? toGate(row) : null;
  }

  async listAll(): Promise<Gate[]> {
    const rows = await this.db.select().from(gateDefinitions).where(eq(gateDefinitions.tenantId, this.tenantId));
    return rows.map(toGate);
  }

  async record(entityId: string, gateId: string, passed: boolean, output: string): Promise<GateResult> {
    const id = randomUUID();
    const evaluatedAt = Date.now();
    await this.db.insert(gateResults).values({
      id,
      tenantId: this.tenantId,
      entityId,
      gateId,
      passed,
      output,
      evaluatedAt,
    });
    const [row] = await this.db.select().from(gateResults).where(eq(gateResults.id, id)).limit(1);
    if (!row) throw new InternalError(`GateResult ${id} not found after insert`);
    return toGateResult(row);
  }

  async update(
    id: string,
    changes: Partial<
      Pick<Gate, "command" | "functionRef" | "apiConfig" | "timeoutMs" | "failurePrompt" | "timeoutPrompt">
    >,
  ): Promise<Gate> {
    await this.db.update(gateDefinitions).set(changes).where(eq(gateDefinitions.id, id));
    const [row] = await this.db.select().from(gateDefinitions).where(eq(gateDefinitions.id, id)).limit(1);
    if (!row) throw new InternalError(`Gate ${id} not found after update`);
    return toGate(row);
  }

  async resultsFor(entityId: string): Promise<GateResult[]> {
    const rows = await this.db
      .select()
      .from(gateResults)
      .where(eq(gateResults.entityId, entityId))
      .orderBy(asc(gateResults.evaluatedAt), asc(gateResults.seq));
    return rows.map(toGateResult);
  }

  async clearResult(entityId: string, gateId: string): Promise<void> {
    await this.db.delete(gateResults).where(and(eq(gateResults.entityId, entityId), eq(gateResults.gateId, gateId)));
  }
}
