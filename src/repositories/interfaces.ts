// Repository interfaces — I*Repository contracts

/** External-system reference map keyed by adapter name */
export type Refs = Record<string, { adapter: string; id: string; [key: string]: unknown }>;

/** Freeform key-value artifact bag */
export type Artifacts = Record<string, unknown>;

/** Invocation execution mode */
export type Mode = "active" | "passive";

/** Runtime entity tracked through a flow */
export interface Entity {
  id: string;
  flowId: string;
  state: string;
  refs: Refs | null;
  artifacts: Artifacts | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  flowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A single agent invocation tied to an entity */
export interface Invocation {
  id: string;
  entityId: string;
  stage: string;
  agentRole: string | null;
  mode: Mode;
  prompt: string;
  context: Record<string, unknown> | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  signal: string | null;
  artifacts: Artifacts | null;
  error: string | null;
  ttlMs: number;
}

/** Result of evaluating a gate against an entity */
export interface GateResult {
  id: string;
  entityId: string;
  gateId: string;
  passed: boolean;
  output: string | null;
  evaluatedAt: Date | null;
}

/** Audit-log entry for an entity state transition */
export interface TransitionLog {
  id: string;
  entityId: string;
  fromState: string | null;
  toState: string;
  trigger: string | null;
  invocationId: string | null;
  timestamp: Date;
}

/** A state within a flow definition */
export interface State {
  id: string;
  flowId: string;
  name: string;
  agentRole: string | null;
  modelTier: string | null;
  mode: Mode;
  promptTemplate: string | null;
  constraints: Record<string, unknown> | null;
}

/** A transition rule between two states */
export interface Transition {
  id: string;
  flowId: string;
  fromState: string;
  toState: string;
  trigger: string;
  gateId: string | null;
  condition: string | null;
  priority: number;
  spawnFlow: string | null;
  spawnTemplate: string | null;
  createdAt: Date | null;
}

/** A gate definition (quality check) */
export interface Gate {
  id: string;
  name: string;
  type: string;
  command: string | null;
  functionRef: string | null;
  apiConfig: Record<string, unknown> | null;
  timeoutMs: number;
}

/** A complete flow definition with its states and transitions */
export interface Flow {
  id: string;
  name: string;
  description: string | null;
  entitySchema: Record<string, unknown> | null;
  initialState: string;
  maxConcurrent: number;
  maxConcurrentPerRepo: number;
  version: number;
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  states: State[];
  transitions: Transition[];
}

/** A versioned snapshot of a flow */
export interface FlowVersion {
  id: string;
  flowId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeReason: string | null;
  createdAt: Date | null;
}

/** Input for creating a new flow */
export interface CreateFlowInput {
  name: string;
  description?: string;
  entitySchema?: Record<string, unknown>;
  initialState: string;
  maxConcurrent?: number;
  maxConcurrentPerRepo?: number;
  createdBy?: string;
}

/** Input for adding a state to a flow */
export interface CreateStateInput {
  name: string;
  agentRole?: string;
  modelTier?: string;
  mode?: Mode;
  promptTemplate?: string;
  constraints?: Record<string, unknown>;
}

/** Input for adding a transition rule */
export interface CreateTransitionInput {
  fromState: string;
  toState: string;
  trigger: string;
  gateId?: string;
  condition?: string;
  priority?: number;
  spawnFlow?: string;
  spawnTemplate?: string;
}

/** Input for creating a gate definition */
export interface CreateGateInput {
  name: string;
  type: string;
  command?: string;
  functionRef?: string;
  apiConfig?: Record<string, unknown>;
  timeoutMs?: number;
}

/** Data-access contract for entity lifecycle operations. */
export interface IEntityRepository {
  /** Create a new entity in the given flow's initial state. */
  create(flowId: string, initialState: string, refs?: Refs): Promise<Entity>;

  /** Get an entity by ID, or null if not found. */
  get(id: string): Promise<Entity | null>;

  /** Find all entities in a given flow and state. */
  findByFlowAndState(flowId: string, state: string): Promise<Entity[]>;

  /** Transition an entity to a new state, recording the trigger and optional artifacts. */
  transition(id: string, toState: string, trigger: string, artifacts?: Partial<Artifacts>): Promise<Entity>;

  /** Merge partial artifacts into an entity's existing artifact bag. */
  updateArtifacts(id: string, artifacts: Partial<Artifacts>): Promise<void>;

  /** Atomically claim one unclaimed entity in the given flow+state for the specified agent. Returns null if none available. Uses compare-and-swap (UPDATE WHERE claimedBy IS NULL). */
  claim(flowId: string, state: string, agentId: string): Promise<Entity | null>;

  /** Find entities whose claim has expired beyond ttlMs and release them. Returns the IDs of released entities. */
  reapExpired(ttlMs: number): Promise<string[]>;
}

/** Fields that can be updated on a flow's top-level definition */
export type UpdateFlowInput = Partial<Omit<Flow, "id" | "states" | "transitions" | "createdAt" | "updatedAt">>;

/** Fields that can be updated on a state definition */
export type UpdateStateInput = Partial<Omit<State, "id" | "flowId">>;

/** Fields that can be updated on a transition rule */
export type UpdateTransitionInput = Partial<Omit<Transition, "id" | "flowId">>;

/** Data-access contract for flow definition CRUD and versioning. */
export interface IFlowRepository {
  /** Create a new flow definition. */
  create(flow: CreateFlowInput): Promise<Flow>;

  /** List all flow definitions. */
  list(): Promise<Flow[]>;

  /** Get a flow by ID, including its states and transitions. Returns null if not found. */
  get(id: string): Promise<Flow | null>;

  /** Get a flow by unique name. Returns null if not found. */
  getByName(name: string): Promise<Flow | null>;

  /** Update a flow's top-level fields. */
  update(id: string, changes: UpdateFlowInput): Promise<Flow>;

  /** Add a state definition to a flow. */
  addState(flowId: string, state: CreateStateInput): Promise<State>;

  /** Update an existing state definition. */
  updateState(stateId: string, changes: UpdateStateInput): Promise<State>;

  /** Add a transition rule to a flow. */
  addTransition(flowId: string, transition: CreateTransitionInput): Promise<Transition>;

  /** Update an existing transition rule. */
  updateTransition(transitionId: string, changes: UpdateTransitionInput): Promise<Transition>;

  /** Create a versioned snapshot of the current flow definition. */
  snapshot(flowId: string): Promise<FlowVersion>;

  /** Restore a flow definition to a previous version. */
  restore(flowId: string, version: number): Promise<void>;

  /** List all flow definitions. */
  listAll(): Promise<Flow[]>;
}

/** Data-access contract for invocation lifecycle and claiming. */
export interface IInvocationRepository {
  /** Create a new invocation for an entity at a given stage. */
  create(
    entityId: string,
    stage: string,
    prompt: string,
    mode: Mode,
    agentRole?: string,
    ttlMs?: number,
  ): Promise<Invocation>;

  /** Get an invocation by ID, or null if not found. */
  get(id: string): Promise<Invocation | null>;

  /** Atomically claim an unclaimed invocation for the specified agent. Uses compare-and-swap (UPDATE WHERE claimedBy IS NULL). Returns null if already claimed. */
  claim(invocationId: string, agentId: string): Promise<Invocation | null>;

  /** Mark an invocation as completed with a signal and optional artifacts. */
  complete(id: string, signal: string, artifacts?: Artifacts): Promise<Invocation>;

  /** Mark an invocation as failed with an error message. */
  fail(id: string, error: string): Promise<Invocation>;

  /** Find all invocations for a given entity. */
  findByEntity(entityId: string): Promise<Invocation[]>;

  /** Find unclaimed invocations for a given flow and agent role. */
  findUnclaimed(flowId: string, role: string): Promise<Invocation[]>;

  /** Find all invocations for a given flow (across all entities). */
  findByFlow(flowId: string): Promise<Invocation[]>;

  /** Find and mark expired invocations (where now - claimedAt > row's ttlMs). Returns the expired invocations. */
  reapExpired(): Promise<Invocation[]>;
}

/** Data-access contract for entity state-transition audit trails. */
export interface ITransitionLogRepository {
  /** Record a state transition for an entity. */
  record(log: Omit<TransitionLog, "id">): Promise<TransitionLog>;

  /** Get full transition history for an entity, ordered by timestamp. */
  historyFor(entityId: string): Promise<TransitionLog[]>;
}

/** Data-access contract for gate definitions and result recording. */
export interface IGateRepository {
  /** Create a new gate definition. */
  create(gate: CreateGateInput): Promise<Gate>;

  /** Get a gate by ID, or null if not found. */
  get(id: string): Promise<Gate | null>;

  /** Get a gate by unique name, or null if not found. */
  getByName(name: string): Promise<Gate | null>;

  /** Record the result of evaluating a gate against an entity. */
  record(entityId: string, gateId: string, passed: boolean, output: string): Promise<GateResult>;

  /** Get all gate results for a given entity. */
  resultsFor(entityId: string): Promise<GateResult[]>;
}
