import { and, eq } from "drizzle-orm";
import { NotFoundError } from "../../errors.js";
import type {
  CreateFlowInput,
  CreateStateInput,
  CreateTransitionInput,
  Flow,
  FlowVersion,
  IFlowRepository,
  Mode,
  OnEnterConfig,
  OnExitConfig,
  State,
  Transition,
  UpdateFlowInput,
  UpdateStateInput,
  UpdateTransitionInput,
} from "../interfaces.js";
import { flowDefinitions, flowVersions, stateDefinitions, transitionRules } from "./schema.js";

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
    onEnter: (r.onEnter as OnEnterConfig | null) ?? null,
    onExit: (r.onExit as OnExitConfig | null) ?? null,
    retryAfterMs: r.retryAfterMs ?? null,
    meta: r.meta as Record<string, unknown> | null,
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
    claimRetryAfterMs: r.claimRetryAfterMs ?? null,
    gateTimeoutMs: r.gateTimeoutMs ?? null,
    version: r.version ?? 1,
    createdBy: r.createdBy ?? null,
    discipline: r.discipline ?? null,
    defaultModelTier: r.defaultModelTier ?? null,
    timeoutPrompt: r.timeoutPrompt ?? null,
    paused: !!r.paused,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    states,
    transitions,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat (PGlite, node-postgres, etc.)
type Db = any;

export class DrizzleFlowRepository implements IFlowRepository {
  constructor(
    private db: Db,
    private tenantId: string,
  ) {}

  private async hydrateFlow(row: typeof flowDefinitions.$inferSelect): Promise<Flow> {
    const stateRows = await this.db
      .select()
      .from(stateDefinitions)
      .where(and(eq(stateDefinitions.flowId, row.id), eq(stateDefinitions.tenantId, this.tenantId)));
    const transitionRows = await this.db
      .select()
      .from(transitionRules)
      .where(and(eq(transitionRules.flowId, row.id), eq(transitionRules.tenantId, this.tenantId)));
    return rowToFlow(row, stateRows.map(rowToState), transitionRows.map(rowToTransition));
  }

  async create(input: CreateFlowInput): Promise<Flow> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      tenantId: this.tenantId,
      name: input.name,
      description: input.description ?? null,
      entitySchema: (input.entitySchema ?? null) as Record<string, unknown> | null,
      initialState: input.initialState,
      maxConcurrent: input.maxConcurrent ?? 0,
      maxConcurrentPerRepo: input.maxConcurrentPerRepo ?? 0,
      affinityWindowMs: input.affinityWindowMs ?? 300000,
      claimRetryAfterMs: input.claimRetryAfterMs ?? null,
      gateTimeoutMs: input.gateTimeoutMs ?? null,
      version: 1,
      createdBy: input.createdBy ?? null,
      discipline: input.discipline ?? null,
      defaultModelTier: input.defaultModelTier ?? null,
      timeoutPrompt: input.timeoutPrompt ?? null,
      paused: input.paused ?? false,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(flowDefinitions).values(row);
    return rowToFlow(row, [], []);
  }

  async get(id: string): Promise<Flow | null> {
    const rows = await this.db
      .select()
      .from(flowDefinitions)
      .where(and(eq(flowDefinitions.id, id), eq(flowDefinitions.tenantId, this.tenantId)));
    if (rows.length === 0) return null;
    return this.hydrateFlow(rows[0]);
  }

  async getByName(name: string): Promise<Flow | null> {
    const rows = await this.db
      .select()
      .from(flowDefinitions)
      .where(and(eq(flowDefinitions.name, name), eq(flowDefinitions.tenantId, this.tenantId)));
    if (rows.length === 0) return null;
    return this.hydrateFlow(rows[0]);
  }

  async getAtVersion(flowId: string, version: number): Promise<Flow | null> {
    const current = await this.get(flowId);
    if (!current) return null;
    if (current.version === version) return current;

    const rows = await this.db
      .select()
      .from(flowVersions)
      .where(
        and(
          eq(flowVersions.flowId, flowId),
          eq(flowVersions.version, version),
          eq(flowVersions.tenantId, this.tenantId),
        ),
      );
    if (rows.length === 0) return null;

    const snap = rows[0].snapshot as {
      name: string;
      description: string | null;
      entitySchema: Record<string, unknown> | null;
      initialState: string;
      maxConcurrent: number;
      maxConcurrentPerRepo: number;
      affinityWindowMs: number;
      gateTimeoutMs: number | null;
      claimRetryAfterMs: number | null;
      version: number;
      createdBy: string | null;
      discipline: string | null;
      defaultModelTier: string | null;
      timeoutPrompt: string | null;
      createdAt: number | null;
      updatedAt: number | null;
      states: State[];
      transitions: Transition[];
    };
    return {
      id: flowId,
      name: snap.name ?? current.name,
      description: snap.description ?? null,
      entitySchema: snap.entitySchema ?? null,
      initialState: snap.initialState ?? current.initialState,
      maxConcurrent: snap.maxConcurrent ?? 0,
      maxConcurrentPerRepo: snap.maxConcurrentPerRepo ?? 0,
      affinityWindowMs: snap.affinityWindowMs ?? 300000,
      claimRetryAfterMs: snap.claimRetryAfterMs ?? null,
      gateTimeoutMs: snap.gateTimeoutMs ?? null,
      version,
      createdBy: snap.createdBy ?? null,
      discipline: snap.discipline ?? null,
      defaultModelTier: snap.defaultModelTier ?? null,
      timeoutPrompt: snap.timeoutPrompt ?? null,
      paused: current.paused,
      createdAt: snap.createdAt ? new Date(snap.createdAt) : null,
      updatedAt: snap.updatedAt ? new Date(snap.updatedAt) : null,
      states: (snap.states ?? []).map((s) => ({
        id: s.id,
        flowId,
        name: s.name,
        agentRole: s.agentRole ?? null,
        modelTier: s.modelTier ?? null,
        mode: s.mode ?? "passive",
        promptTemplate: s.promptTemplate ?? null,
        constraints: s.constraints ?? null,
        onEnter: s.onEnter ?? null,
        onExit: s.onExit ?? null,
        retryAfterMs: s.retryAfterMs ?? null,
        meta: s.meta ?? null,
      })),
      transitions: (snap.transitions ?? []).map((t) => ({
        id: t.id,
        flowId,
        fromState: t.fromState,
        toState: t.toState,
        trigger: t.trigger,
        gateId: t.gateId ?? null,
        condition: t.condition ?? null,
        priority: t.priority ?? 0,
        spawnFlow: t.spawnFlow ?? null,
        spawnTemplate: t.spawnTemplate ?? null,
        createdAt: t.createdAt ? new Date(t.createdAt) : null,
      })),
    };
  }

  async list(): Promise<Flow[]> {
    const rows = await this.db.select().from(flowDefinitions).where(eq(flowDefinitions.tenantId, this.tenantId));
    const results: Flow[] = [];
    for (const row of rows) {
      results.push(await this.hydrateFlow(row));
    }
    return results;
  }

  async listAll(): Promise<Flow[]> {
    return this.list();
  }

  async update(id: string, changes: UpdateFlowInput): Promise<Flow> {
    const now = Date.now();
    const current = await this.db
      .select()
      .from(flowDefinitions)
      .where(and(eq(flowDefinitions.id, id), eq(flowDefinitions.tenantId, this.tenantId)));
    if (current.length === 0) throw new NotFoundError(`Flow not found: ${id}`);

    const updateValues: Record<string, unknown> = { updatedAt: now };
    if (changes.name !== undefined) updateValues.name = changes.name;
    if (changes.description !== undefined) updateValues.description = changes.description;
    if (changes.entitySchema !== undefined) updateValues.entitySchema = changes.entitySchema;
    if (changes.initialState !== undefined) updateValues.initialState = changes.initialState;
    if (changes.maxConcurrent !== undefined) updateValues.maxConcurrent = changes.maxConcurrent;
    if (changes.maxConcurrentPerRepo !== undefined) updateValues.maxConcurrentPerRepo = changes.maxConcurrentPerRepo;
    if (changes.affinityWindowMs !== undefined) updateValues.affinityWindowMs = changes.affinityWindowMs;
    if (changes.claimRetryAfterMs !== undefined) updateValues.claimRetryAfterMs = changes.claimRetryAfterMs;
    if (changes.gateTimeoutMs !== undefined) updateValues.gateTimeoutMs = changes.gateTimeoutMs;
    if (changes.version !== undefined) updateValues.version = changes.version;
    if (changes.createdBy !== undefined) updateValues.createdBy = changes.createdBy;
    if (changes.discipline !== undefined) updateValues.discipline = changes.discipline;
    if (changes.defaultModelTier !== undefined) updateValues.defaultModelTier = changes.defaultModelTier;
    if (changes.timeoutPrompt !== undefined) updateValues.timeoutPrompt = changes.timeoutPrompt;
    if (changes.paused !== undefined) updateValues.paused = changes.paused;

    await this.db
      .update(flowDefinitions)
      .set(updateValues)
      .where(and(eq(flowDefinitions.id, id), eq(flowDefinitions.tenantId, this.tenantId)));

    const updated = await this.db
      .select()
      .from(flowDefinitions)
      .where(and(eq(flowDefinitions.id, id), eq(flowDefinitions.tenantId, this.tenantId)));
    return this.hydrateFlow(updated[0]);
  }

  async addState(flowId: string, state: CreateStateInput): Promise<State> {
    const id = crypto.randomUUID();
    const row = {
      id,
      tenantId: this.tenantId,
      flowId,
      name: state.name,
      agentRole: state.agentRole || null,
      modelTier: state.modelTier ?? null,
      mode: state.mode ?? "passive",
      promptTemplate: state.promptTemplate ?? null,
      constraints: (state.constraints ?? null) as Record<string, unknown> | null,
      onEnter: (state.onEnter ?? null) as OnEnterConfig | null,
      onExit: (state.onExit ?? null) as OnExitConfig | null,
      retryAfterMs: state.retryAfterMs ?? null,
      meta: (state.meta ?? null) as Record<string, unknown> | null,
    };
    await this.db.transaction(async (tx: Db) => {
      await tx.insert(stateDefinitions).values(row);
      await tx.update(flowDefinitions).set({ updatedAt: Date.now() }).where(eq(flowDefinitions.id, flowId));
    });
    return rowToState(row);
  }

  async updateState(stateId: string, changes: UpdateStateInput): Promise<State> {
    const cond = and(eq(stateDefinitions.id, stateId), eq(stateDefinitions.tenantId, this.tenantId));
    const existing = await this.db.select().from(stateDefinitions).where(cond);
    if (existing.length === 0) throw new NotFoundError(`State not found: ${stateId}`);

    const updateValues: Record<string, unknown> = {};
    if (changes.name !== undefined) updateValues.name = changes.name;
    if (changes.agentRole !== undefined) updateValues.agentRole = changes.agentRole;
    if (changes.modelTier !== undefined) updateValues.modelTier = changes.modelTier;
    if (changes.mode !== undefined) updateValues.mode = changes.mode;
    if (changes.promptTemplate !== undefined) updateValues.promptTemplate = changes.promptTemplate;
    if (changes.constraints !== undefined) updateValues.constraints = changes.constraints;
    if (changes.onEnter !== undefined) updateValues.onEnter = changes.onEnter;
    if (changes.onExit !== undefined) updateValues.onExit = changes.onExit;
    if (changes.retryAfterMs !== undefined) updateValues.retryAfterMs = changes.retryAfterMs;
    if (changes.meta !== undefined) updateValues.meta = changes.meta;

    if (Object.keys(updateValues).length > 0) {
      await this.db.update(stateDefinitions).set(updateValues).where(cond);
    }

    const rows = await this.db.select().from(stateDefinitions).where(cond);
    await this.db.update(flowDefinitions).set({ updatedAt: Date.now() }).where(eq(flowDefinitions.id, rows[0].flowId));

    return rowToState(rows[0]);
  }

  async addTransition(flowId: string, transition: CreateTransitionInput): Promise<Transition> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const row = {
      id,
      tenantId: this.tenantId,
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
    await this.db.transaction(async (tx: Db) => {
      await tx.insert(transitionRules).values(row);
      await tx.update(flowDefinitions).set({ updatedAt: now }).where(eq(flowDefinitions.id, flowId));
    });
    return rowToTransition(row);
  }

  async updateTransition(transitionId: string, changes: UpdateTransitionInput): Promise<Transition> {
    const cond = and(eq(transitionRules.id, transitionId), eq(transitionRules.tenantId, this.tenantId));
    const existing = await this.db.select().from(transitionRules).where(cond);
    if (existing.length === 0) throw new NotFoundError(`Transition not found: ${transitionId}`);

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
      await this.db.update(transitionRules).set(updateValues).where(cond);
    }

    const rows = await this.db.select().from(transitionRules).where(cond);
    await this.db.update(flowDefinitions).set({ updatedAt: Date.now() }).where(eq(flowDefinitions.id, rows[0].flowId));

    return rowToTransition(rows[0]);
  }

  async snapshot(flowId: string): Promise<FlowVersion> {
    const flow = await this.get(flowId);
    if (!flow) throw new NotFoundError(`Flow not found: ${flowId}`);

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
      gateTimeoutMs: flow.gateTimeoutMs,
      version: flow.version,
      createdBy: flow.createdBy,
      timeoutPrompt: flow.timeoutPrompt,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      discipline: flow.discipline,
      defaultModelTier: flow.defaultModelTier,
      claimRetryAfterMs: flow.claimRetryAfterMs,
      states: flow.states,
      transitions: flow.transitions,
    };

    const nextVersion = await this.db.transaction(async (tx: Db) => {
      const existing = await tx
        .select()
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.tenantId, this.tenantId)));
      const maxVersion = existing.reduce((max: number, r: { version: number }) => Math.max(max, r.version), 0);
      const version = maxVersion + 1;

      await tx.insert(flowVersions).values({
        id,
        tenantId: this.tenantId,
        flowId,
        version,
        snapshot: snapshotData as Record<string, unknown>,
        changedBy: null,
        changeReason: null,
        createdAt: now,
      });

      await tx
        .update(flowDefinitions)
        .set({ version: version + 1, updatedAt: now })
        .where(eq(flowDefinitions.id, flowId));

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
    const versionRows = await this.db
      .select()
      .from(flowVersions)
      .where(
        and(
          eq(flowVersions.flowId, flowId),
          eq(flowVersions.version, version),
          eq(flowVersions.tenantId, this.tenantId),
        ),
      );
    if (versionRows.length === 0) throw new NotFoundError(`Version ${version} not found for flow ${flowId}`);

    const snap = versionRows[0].snapshot as {
      name: string;
      description: string | null;
      entitySchema: Record<string, unknown> | null;
      initialState: string;
      maxConcurrent: number;
      maxConcurrentPerRepo: number;
      affinityWindowMs: number;
      gateTimeoutMs: number | null;
      version: number;
      createdBy: string | null;
      discipline: string | null;
      defaultModelTier: string | null;
      claimRetryAfterMs: number | null;
      timeoutPrompt: string | null;
      states: State[];
      transitions: Transition[];
    };

    await this.db.transaction(async (tx: Db) => {
      await tx
        .delete(transitionRules)
        .where(and(eq(transitionRules.flowId, flowId), eq(transitionRules.tenantId, this.tenantId)));
      await tx
        .delete(stateDefinitions)
        .where(and(eq(stateDefinitions.flowId, flowId), eq(stateDefinitions.tenantId, this.tenantId)));

      for (const s of snap.states) {
        await tx.insert(stateDefinitions).values({
          id: s.id,
          tenantId: this.tenantId,
          flowId,
          name: s.name,
          agentRole: s.agentRole || null,
          modelTier: s.modelTier,
          mode: s.mode ?? "passive",
          promptTemplate: s.promptTemplate,
          constraints: s.constraints as Record<string, unknown> | null,
          onEnter: (s.onEnter ?? null) as OnEnterConfig | null,
          onExit: (s.onExit ?? null) as OnExitConfig | null,
          retryAfterMs: s.retryAfterMs ?? null,
        });
      }

      for (const t of snap.transitions) {
        await tx.insert(transitionRules).values({
          id: t.id,
          tenantId: this.tenantId,
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
        });
      }

      await tx
        .update(flowDefinitions)
        .set({
          name: snap.name,
          description: snap.description,
          entitySchema: snap.entitySchema,
          initialState: snap.initialState,
          maxConcurrent: snap.maxConcurrent,
          maxConcurrentPerRepo: snap.maxConcurrentPerRepo,
          affinityWindowMs: snap.affinityWindowMs,
          gateTimeoutMs: snap.gateTimeoutMs ?? null,
          version: snap.version,
          createdBy: snap.createdBy,
          discipline: snap.discipline,
          defaultModelTier: snap.defaultModelTier ?? null,
          claimRetryAfterMs: snap.claimRetryAfterMs ?? null,
          timeoutPrompt: snap.timeoutPrompt,
          updatedAt: Date.now(),
        })
        .where(eq(flowDefinitions.id, flowId));
    });
  }
}
