// Repository interfaces — I*Repository contracts

/** External-system reference map keyed by adapter name */
export type Refs = Record<string, { adapter: string; id: string; [key: string]: unknown }>;

/** Freeform key-value artifact bag */
export type Artifacts = Record<string, unknown>;

/** Configuration for running a command when an entity enters a state */
export interface OnEnterConfig {
  command: string;
  artifacts: string[];
  timeout_ms?: number;
}

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
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  affinityWorkerId: string | null;
  affinityRole: string | null;
  affinityExpiresAt: Date | null;
}

/** A single agent invocation tied to an entity */
export interface Invocation {
  id: string;
  entityId: string;
  stage: string;
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

/**
 * Entity with pre-fetched related data for use in Handlebars template helpers.
 * The `invocations` and `gateResults` fields are populated by the engine before
 * rendering prompt templates; they are never present on raw DB rows.
 */
export interface EnrichedEntity extends Entity {
  invocations?: Invocation[];
  gateResults?: GateResult[];
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
  modelTier: string | null;
  mode: Mode;
  promptTemplate: string | null;
  constraints: Record<string, unknown> | null;
  onEnter: OnEnterConfig | null;
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
  timeoutMs: number | null;
  failurePrompt: string | null;
  timeoutPrompt: string | null;
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
  affinityWindowMs: number;
  gateTimeoutMs: number | null;
  version: number;
  createdBy: string | null;
  discipline: string | null;
  defaultModelTier: string | null;
  timeoutPrompt: string | null;
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
  affinityWindowMs?: number;
  gateTimeoutMs?: number;
  createdBy?: string;
  discipline?: string;
  defaultModelTier?: string;
  timeoutPrompt?: string;
}

/** Input for adding a state to a flow */
export interface CreateStateInput {
  name: string;
  modelTier?: string;
  mode?: Mode;
  promptTemplate?: string;
  constraints?: Record<string, unknown>;
  onEnter?: OnEnterConfig;
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
  failurePrompt?: string;
  timeoutPrompt?: string;
}

/** Data-access contract for entity lifecycle operations. */
export interface IEntityRepository {
  /** Create a new entity in the given flow's initial state. */
  create(flowId: string, initialState: string, refs?: Refs): Promise<Entity>;

  /** Get an entity by ID, or null if not found. */
  get(id: string): Promise<Entity | null>;

  /** Find all entities in a given flow and state. */
  findByFlowAndState(flowId: string, state: string): Promise<Entity[]>;

  /** Return true if at least one entity exists in the given flow across any of the given states. */
  hasAnyInFlowAndState(flowId: string, stateNames: string[]): Promise<boolean>;

  /** Transition an entity to a new state, recording the trigger and optional artifacts. */
  transition(id: string, toState: string, trigger: string, artifacts?: Partial<Artifacts>): Promise<Entity>;

  /** Merge partial artifacts into an entity's existing artifact bag. Performs a shallow merge
   *  ({ ...existing, ...artifacts }) — only the specified keys are updated; unspecified keys are preserved. */
  updateArtifacts(id: string, artifacts: Partial<Artifacts>): Promise<void>;

  /** Atomically claim one unclaimed entity in the given flow+state for the specified agent. Returns null if none available. Uses compare-and-swap (UPDATE WHERE claimedBy IS NULL). */
  claim(flowId: string, state: string, agentId: string): Promise<Entity | null>;

  /** Atomically claim a specific entity by ID for the specified agent. Returns null if already claimed. Uses compare-and-swap (UPDATE WHERE claimedBy IS NULL). */
  claimById(entityId: string, agentId: string): Promise<Entity | null>;

  /** Release a claimed entity, clearing claimedBy and claimedAt. */
  release(entityId: string, agentId: string): Promise<void>;

  /** Find entities whose claim has expired beyond ttlMs and release them. Returns the IDs of released entities. */
  reapExpired(ttlMs: number): Promise<string[]>;

  /** Set affinity metadata on an entity, recording the last worker that touched it. */
  setAffinity(entityId: string, workerId: string, role: string, expiresAt: Date): Promise<void>;

  /** Clear expired affinity records. Returns the IDs of entities whose affinity was cleared. */
  clearExpiredAffinity(): Promise<string[]>;

  /** Atomically append a spawned child entry to the parent entity's artifacts.spawnedChildren array.
   *  Reads the current array and writes back in a single transaction to prevent TOCTOU races. */
  appendSpawnedChild(parentId: string, entry: { childId: string; childFlow: string; spawnedAt: string }): Promise<void>;
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
    ttlMs?: number,
    context?: Record<string, unknown>,
  ): Promise<Invocation>;

  /** Get an invocation by ID, or null if not found. */
  get(id: string): Promise<Invocation | null>;

  /** Atomically claim an unclaimed invocation for the specified agent. Uses compare-and-swap (UPDATE WHERE claimedBy IS NULL). Returns null if already claimed. */
  claim(invocationId: string, agentId: string): Promise<Invocation | null>;

  /** Mark an invocation as completed with a signal and optional artifacts. */
  complete(id: string, signal: string, artifacts?: Artifacts): Promise<Invocation>;

  /** Mark an invocation as failed with an error message. */
  fail(id: string, error: string): Promise<Invocation>;

  /** Release a claim on an invocation, making it available for another worker to claim. */
  releaseClaim(id: string): Promise<void>;

  /** Find all invocations for a given entity. */
  findByEntity(entityId: string): Promise<Invocation[]>;

  /** Find unclaimed invocations where the entity has unexpired affinity for the given worker and role. */
  findUnclaimedWithAffinity(flowId: string, role: string, workerId: string): Promise<Invocation[]>;

  /** Find all unclaimed invocations in a flow, regardless of agentRole. For discipline-based claiming. */
  findUnclaimedByFlow(flowId: string): Promise<Invocation[]>;

  /** Find all invocations for a given flow (across all entities). */
  findByFlow(flowId: string): Promise<Invocation[]>;

  /** Find and mark expired invocations (where now - claimedAt > row's ttlMs). Returns the expired invocations. */
  reapExpired(): Promise<Invocation[]>;

  /** Find unclaimed active-mode invocations, optionally filtered by flow. */
  findUnclaimedActive(flowId?: string): Promise<Invocation[]>;

  /** Count active invocations (claimed, not completed/failed) for a flow. */
  countActiveByFlow(flowId: string): Promise<number>;

  /** Count pending invocations (unclaimed, not completed/failed) for a flow. */
  countPendingByFlow(flowId: string): Promise<number>;
}

/** Data-access contract for entity state-transition audit trails. */
export interface ITransitionLogRepository {
  /** Record a state transition for an entity. */
  record(log: Omit<TransitionLog, "id">): Promise<TransitionLog>;

  /** Get full transition history for an entity, ordered by timestamp. */
  historyFor(entityId: string): Promise<TransitionLog[]>;
}

/** Data-access contract for emitting definition-change events. */
export interface IEventRepository {
  /** Emit a definition change event for a tool action. */
  emitDefinitionChanged(flowId: string | null, tool: string, payload: Record<string, unknown>): Promise<void>;
}

/** Data-access contract for gate definitions and result recording. */
export interface IGateRepository {
  /** Create a new gate definition. */
  create(gate: CreateGateInput): Promise<Gate>;

  /** Get a gate by ID, or null if not found. */
  get(id: string): Promise<Gate | null>;

  /** Get a gate by unique name, or null if not found. */
  getByName(name: string): Promise<Gate | null>;

  /** List all gate definitions. */
  listAll(): Promise<Gate[]>;

  /** Record the result of evaluating a gate against an entity. */
  record(entityId: string, gateId: string, passed: boolean, output: string): Promise<GateResult>;

  /** Get all gate results for a given entity. */
  resultsFor(entityId: string): Promise<GateResult[]>;

  /** Update mutable fields on a gate definition. */
  update(
    id: string,
    changes: Partial<
      Pick<Gate, "command" | "functionRef" | "apiConfig" | "timeoutMs" | "failurePrompt" | "timeoutPrompt">
    >,
  ): Promise<Gate>;
}
