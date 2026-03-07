import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  CreateFlowInput,
  CreateStateInput,
  CreateTransitionInput,
  Flow,
  FlowVersion,
  IFlowRepository,
  Mode,
  State,
  Transition,
  UpdateFlowInput,
  UpdateStateInput,
  UpdateTransitionInput,
} from "../interfaces.js";
import type * as schema from "./schema.js";
import { flowDefinitions, flowVersions, stateDefinitions, transitionRules } from "./schema.js";

type Db = BetterSQLite3Database<typeof schema>;

function toDate(v: number | null | undefined): Date | null {
  return v != null ? new Date(v) : null;
}

function rowToState(r: typeof stateDefinitions.$inferSelect): State {
  return {
    id: r.id,
    flowId: r.flowId,
    name: r.name,
    agentRole: r.agentRole ?? null,
    modelTier: r.modelTier ?? null,
    mode: (r.mode ?? "passive") as Mode,
    promptTemplate: r.promptTemplate ?? null,
    constraints: r.constraints as Record<string, unknown> | null,
  };
}

function rowToTransition(r: typeof transitionRules.$inferSelect): Transition {
  return {
    id: r.id,
    flowId: r.flowId,
    fromState: r.fromState,
    toState: r.toState,
    trigger: r.trigger,
    gateId: r.gateId ?? null,
    condition: r.condition ?? null,
    priority: r.priority ?? 0,
    spawnFlow: r.spawnFlow ?? null,
    spawnTemplate: r.spawnTemplate ?? null,
    createdAt: toDate(r.createdAt),
  };
}

function rowToFlow(r: typeof flowDefinitions.$inferSelect, states: State[], transitions: Transition[]): Flow {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    entitySchema: r.entitySchema as Record<string, unknown> | null,
    initialState: r.initialState,
    maxConcurrent: r.maxConcurrent ?? 0,
    maxConcurrentPerRepo: r.maxConcurrentPerRepo ?? 0,
    affinityWindowMs: r.affinityWindowMs ?? 300000,
    version: r.version ?? 1,
    createdBy: r.createdBy ?? null,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    states,
    transitions,
  };
}

export class DrizzleFlowRepository implements IFlowRepository {
  constructor(private db: Db) {}

  private hydrateFlow(row: typeof flowDefinitions.$inferSelect): Flow {
    const states = this.db
      .select()
      .from(stateDefinitions)
      .where(eq(stateDefinitions.flowId, row.id))
      .all()
      .map(rowToState);
    const transitions = this.db
      .select()
      .from(transitionRules)
      .where(eq(transitionRules.flowId, row.id))
      .all()
      .map(rowToTransition);
    return rowToFlow(row, states, transitions);
  }

  async create(input: CreateFlowInput): Promise<Flow> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      name: input.name,
      description: input.description ?? null,
      entitySchema: (input.entitySchema ?? null) as Record<string, unknown> | null,
      initialState: input.initialState,
      maxConcurrent: input.maxConcurrent ?? 0,
      maxConcurrentPerRepo: input.maxConcurrentPerRepo ?? 0,
      affinityWindowMs: input.affinityWindowMs ?? 300000,
      version: 1,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(flowDefinitions).values(row).run();
    return rowToFlow(row, [], []);
  }

  async get(id: string): Promise<Flow | null> {
    const rows = this.db.select().from(flowDefinitions).where(eq(flowDefinitions.id, id)).all();
    if (rows.length === 0) return null;
    return this.hydrateFlow(rows[0]);
  }

  async getByName(name: string): Promise<Flow | null> {
    const rows = this.db.select().from(flowDefinitions).where(eq(flowDefinitions.name, name)).all();
    if (rows.length === 0) return null;
    return this.hydrateFlow(rows[0]);
  }

  async list(): Promise<Flow[]> {
    const rows = this.db.select().from(flowDefinitions).all();
    return rows.map((row) => this.hydrateFlow(row));
  }

  async listAll(): Promise<Flow[]> {
    return this.list();
  }

  async update(id: string, changes: UpdateFlowInput): Promise<Flow> {
    const now = Date.now();
    const current = this.db.select().from(flowDefinitions).where(eq(flowDefinitions.id, id)).all();
    if (current.length === 0) throw new Error(`Flow not found: ${id}`);

    const updateValues: Record<string, unknown> = { updatedAt: now };
    if (changes.name !== undefined) updateValues.name = changes.name;
    if (changes.description !== undefined) updateValues.description = changes.description;
    if (changes.entitySchema !== undefined) updateValues.entitySchema = changes.entitySchema;
    if (changes.initialState !== undefined) updateValues.initialState = changes.initialState;
    if (changes.maxConcurrent !== undefined) updateValues.maxConcurrent = changes.maxConcurrent;
    if (changes.maxConcurrentPerRepo !== undefined) updateValues.maxConcurrentPerRepo = changes.maxConcurrentPerRepo;
    if (changes.affinityWindowMs !== undefined) updateValues.affinityWindowMs = changes.affinityWindowMs;
    if (changes.version !== undefined) updateValues.version = changes.version;
    if (changes.createdBy !== undefined) updateValues.createdBy = changes.createdBy;

    this.db.update(flowDefinitions).set(updateValues).where(eq(flowDefinitions.id, id)).run();

    const updated = this.db.select().from(flowDefinitions).where(eq(flowDefinitions.id, id)).all();
    return this.hydrateFlow(updated[0]);
  }

  async addState(flowId: string, state: CreateStateInput): Promise<State> {
    const id = crypto.randomUUID();
    const row = {
      id,
      flowId,
      name: state.name,
      agentRole: state.agentRole ?? null,
      modelTier: state.modelTier ?? null,
      mode: state.mode ?? "passive",
      promptTemplate: state.promptTemplate ?? null,
      constraints: (state.constraints ?? null) as Record<string, unknown> | null,
    };
    this.db.transaction((tx) => {
      tx.insert(stateDefinitions).values(row).run();
      tx.update(flowDefinitions).set({ updatedAt: Date.now() }).where(eq(flowDefinitions.id, flowId)).run();
    });
    return rowToState(row);
  }

  async updateState(stateId: string, changes: UpdateStateInput): Promise<State> {
    const existing = this.db.select().from(stateDefinitions).where(eq(stateDefinitions.id, stateId)).all();
    if (existing.length === 0) throw new Error(`State not found: ${stateId}`);

    const updateValues: Record<string, unknown> = {};
    if (changes.name !== undefined) updateValues.name = changes.name;
    if (changes.agentRole !== undefined) updateValues.agentRole = changes.agentRole;
    if (changes.modelTier !== undefined) updateValues.modelTier = changes.modelTier;
    if (changes.mode !== undefined) updateValues.mode = changes.mode;
    if (changes.promptTemplate !== undefined) updateValues.promptTemplate = changes.promptTemplate;
    if (changes.constraints !== undefined) updateValues.constraints = changes.constraints;

    if (Object.keys(updateValues).length > 0) {
      this.db.update(stateDefinitions).set(updateValues).where(eq(stateDefinitions.id, stateId)).run();
    }

    const rows = this.db.select().from(stateDefinitions).where(eq(stateDefinitions.id, stateId)).all();
    this.db.update(flowDefinitions).set({ updatedAt: Date.now() }).where(eq(flowDefinitions.id, rows[0].flowId)).run();

    return rowToState(rows[0]);
  }

  async addTransition(flowId: string, transition: CreateTransitionInput): Promise<Transition> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      flowId,
      fromState: transition.fromState,
      toState: transition.toState,
      trigger: transition.trigger,
      gateId: transition.gateId ?? null,
      condition: transition.condition ?? null,
      priority: transition.priority ?? 0,
      spawnFlow: transition.spawnFlow ?? null,
      spawnTemplate: transition.spawnTemplate ?? null,
      createdAt: now,
    };
    this.db.transaction((tx) => {
      tx.insert(transitionRules).values(row).run();
      tx.update(flowDefinitions).set({ updatedAt: now }).where(eq(flowDefinitions.id, flowId)).run();
    });
    return rowToTransition(row);
  }

  async updateTransition(transitionId: string, changes: UpdateTransitionInput): Promise<Transition> {
    const existing = this.db.select().from(transitionRules).where(eq(transitionRules.id, transitionId)).all();
    if (existing.length === 0) throw new Error(`Transition not found: ${transitionId}`);

    const updateValues: Record<string, unknown> = {};
    if (changes.fromState !== undefined) updateValues.fromState = changes.fromState;
    if (changes.toState !== undefined) updateValues.toState = changes.toState;
    if (changes.trigger !== undefined) updateValues.trigger = changes.trigger;
    if (changes.gateId !== undefined) updateValues.gateId = changes.gateId;
    if (changes.condition !== undefined) updateValues.condition = changes.condition;
    if (changes.priority !== undefined) updateValues.priority = changes.priority;
    if (changes.spawnFlow !== undefined) updateValues.spawnFlow = changes.spawnFlow;
    if (changes.spawnTemplate !== undefined) updateValues.spawnTemplate = changes.spawnTemplate;

    if (Object.keys(updateValues).length > 0) {
      this.db.update(transitionRules).set(updateValues).where(eq(transitionRules.id, transitionId)).run();
    }

    const rows = this.db.select().from(transitionRules).where(eq(transitionRules.id, transitionId)).all();
    this.db.update(flowDefinitions).set({ updatedAt: Date.now() }).where(eq(flowDefinitions.id, rows[0].flowId)).run();

    return rowToTransition(rows[0]);
  }

  async snapshot(flowId: string): Promise<FlowVersion> {
    const flow = await this.get(flowId);
    if (!flow) throw new Error(`Flow not found: ${flowId}`);

    const now = Date.now();
    const id = crypto.randomUUID();
    const snapshotData = {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      entitySchema: flow.entitySchema,
      initialState: flow.initialState,
      maxConcurrent: flow.maxConcurrent,
      maxConcurrentPerRepo: flow.maxConcurrentPerRepo,
      affinityWindowMs: flow.affinityWindowMs,
      version: flow.version,
      createdBy: flow.createdBy,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      states: flow.states,
      transitions: flow.transitions,
    };

    const nextVersion = this.db.transaction((tx) => {
      const existing = tx.select().from(flowVersions).where(eq(flowVersions.flowId, flowId)).all();
      const maxVersion = existing.reduce((max, r) => Math.max(max, r.version), 0);
      const version = maxVersion + 1;

      tx.insert(flowVersions)
        .values({
          id,
          flowId,
          version,
          snapshot: snapshotData as Record<string, unknown>,
          changedBy: null,
          changeReason: null,
          createdAt: now,
        })
        .run();

      return version;
    });

    return {
      id,
      flowId,
      version: nextVersion,
      snapshot: snapshotData as Record<string, unknown>,
      changedBy: null,
      changeReason: null,
      createdAt: new Date(now),
    };
  }

  async restore(flowId: string, version: number): Promise<void> {
    const versionRows = this.db
      .select()
      .from(flowVersions)
      .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.version, version)))
      .all();
    if (versionRows.length === 0) throw new Error(`Version ${version} not found for flow ${flowId}`);

    const snap = versionRows[0].snapshot as {
      name: string;
      description: string | null;
      entitySchema: Record<string, unknown> | null;
      initialState: string;
      maxConcurrent: number;
      maxConcurrentPerRepo: number;
      affinityWindowMs: number;
      version: number;
      createdBy: string | null;
      states: State[];
      transitions: Transition[];
    };

    this.db.transaction((tx) => {
      tx.delete(transitionRules).where(eq(transitionRules.flowId, flowId)).run();
      tx.delete(stateDefinitions).where(eq(stateDefinitions.flowId, flowId)).run();

      for (const s of snap.states) {
        tx.insert(stateDefinitions)
          .values({
            id: s.id,
            flowId,
            name: s.name,
            agentRole: s.agentRole,
            modelTier: s.modelTier,
            mode: s.mode ?? "passive",
            promptTemplate: s.promptTemplate,
            constraints: s.constraints as Record<string, unknown> | null,
          })
          .run();
      }

      for (const t of snap.transitions) {
        tx.insert(transitionRules)
          .values({
            id: t.id,
            flowId,
            fromState: t.fromState,
            toState: t.toState,
            trigger: t.trigger,
            gateId: t.gateId,
            condition: t.condition,
            priority: t.priority ?? 0,
            spawnFlow: t.spawnFlow,
            spawnTemplate: t.spawnTemplate,
            createdAt: t.createdAt ? new Date(t.createdAt).getTime() : null,
          })
          .run();
      }

      tx.update(flowDefinitions)
        .set({
          name: snap.name,
          description: snap.description,
          entitySchema: snap.entitySchema,
          initialState: snap.initialState,
          maxConcurrent: snap.maxConcurrent,
          maxConcurrentPerRepo: snap.maxConcurrentPerRepo,
          affinityWindowMs: snap.affinityWindowMs,
          version: snap.version,
          createdBy: snap.createdBy,
          updatedAt: Date.now(),
        })
        .where(eq(flowDefinitions.id, flowId))
        .run();
    });
  }
}
