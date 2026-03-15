// Repository interfaces — I*Repository contracts

/** External-system reference map keyed by adapter name */
export type Refs = Record<string, { adapter: string; id: string; [key: string]: unknown }>;

/** Freeform key-value artifact bag */
export type Artifacts = Record<string, unknown>;

/** Configuration for running a primitive op when an entity enters a state */
export interface OnEnterConfig {
  /** Primitive op identifier, e.g. "vcs.provision_worktree" or "issue_tracker.fetch_comment". */
  op: string;
  /** Handlebars-rendered params passed to the adapter op. */
  params?: Record<string, unknown>;
  /** Expected artifact keys extracted from the op result. */
  artifacts: string[];
  /** Optional map from op result keys to artifact names, e.g. { body: "architectSpec" }. */
  artifactMap?: Record<string, string>;
}

/** Configuration for running a primitive op when an entity exits a state */
export interface OnExitConfig {
  /** Primitive op identifier, e.g. "vcs.cleanup_worktree". */
  op: string;
  /** Handlebars-rendered params passed to the adapter op. */
  params?: Record<string, unknown>;
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
  parentEntityId: string | null;
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
  /** Agent type identifier — maps to an agent MD file (e.g. "wopr-architect" → ~/.claude/agents/wopr-architect.md). */
  agentRole: string | null;
  modelTier: string | null;
  mode: Mode;
  promptTemplate: string | null;
  constraints: Record<string, unknown> | null;
  onEnter: OnEnterConfig | null;
  onExit: OnExitConfig | null;
  /** Override check_back delay for workers claiming this state. Falls back to Flow.claimRetryAfterMs. */
  retryAfterMs: number | null;
  /** Opaque metadata passed through to consumers. Holyship stores but does not interpret. */
  meta: Record<string, unknown> | null;
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
  /** Named outcome map from structured gate output. Keys are outcome names; values declare
   *  where the entity goes. `proceed: true` means the original transition continues.
   *  `toState` redirects to a different state. */
  outcomes: Record<string, { proceed?: boolean; toState?: string }> | null;
  /** Primitive op identifier, e.g. "vcs.ci_status". Only present for type === "primitive". */
  primitiveOp: string | null;
  /** Handlebars-rendered params for the primitive op. */
  primitiveParams: Record<string, unknown> | null;
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
  /** Flow-level default check_back delay when no work is available. Falls back to RETRY_LONG_MS (300s) if null. */
  claimRetryAfterMs: number | null;
  gateTimeoutMs: number | null;
  version: number;
  createdBy: string | null;
  discipline: string | null;
  defaultModelTier: string | null;
  timeoutPrompt: string | null;
  paused: boolean;
  /** Max credits (nanodollars) that can be burned per entity before it's terminated. Null = no limit. */
  maxCreditsPerEntity: number | null;
  /** Max invocations per entity before it's terminated. Prevents infinite retry loops. Null = no limit. */
  maxInvocationsPerEntity: number | null;
  /** Integration scoping: which issue tracker this flow uses for primitive ops. */
  issueTrackerIntegrationId: string | null;
  /** Integration scoping: which VCS this flow uses for primitive ops. */
  vcsIntegrationId: string | null;
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
  claimRetryAfterMs?: number;
  gateTimeoutMs?: number;
  createdBy?: string;
  discipline?: string;
  defaultModelTier?: string;
  timeoutPrompt?: string;
  paused?: boolean;
  maxCreditsPerEntity?: number;
  maxInvocationsPerEntity?: number;
  issueTrackerIntegrationId?: string;
  vcsIntegrationId?: string;
}

/** Input for adding a state to a flow */
export interface CreateStateInput {
  name: string;
  agentRole?: string;
  modelTier?: string;
  mode?: Mode;
  promptTemplate?: string;
  constraints?: Record<string, unknown>;
  onEnter?: OnEnterConfig;
  onExit?: OnExitConfig;
  retryAfterMs?: number;
  meta?: Record<string, unknown>;
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
  primitiveOp?: string;
  primitiveParams?: Record<string, unknown>;
  timeoutMs?: number;
  failurePrompt?: string;
  timeoutPrompt?: string;
  outcomes?: Record<string, { proceed?: boolean; toState?: string }>;
}

/** Data-access contract for entity lifecycle operations. */
export interface IEntityRepository {
  /** Create a new entity in the given flow's initial state. */
  create(
    flowId: string,
    initialState: string,
    refs?: Refs,
    flowVersion?: number,
    parentEntityId?: string,
  ): Promise<Entity>;

  /** Get an entity by ID, or null if not found. */
  get(id: string): Promise<Entity | null>;

  /** Find entities in a given flow and state, up to an optional limit. */
  findByFlowAndState(flowId: string, state: string, limit?: number): Promise<Entity[]>;

  /** Return true if at least one entity exists in the given flow across any of the given states. */
  hasAnyInFlowAndState(flowId: string, stateNames: string[]): Promise<boolean>;

  /** Transition an entity to a new state, recording the trigger and optional artifacts. */
  transition(id: string, toState: string, trigger: string, artifacts?: Partial<Artifacts>): Promise<Entity>;

  /** Merge partial artifacts into an entity's existing artifact bag. Performs a shallow merge
   *  ({ ...existing, ...artifacts }) — only the specified keys are updated; unspecified keys are preserved. */
  updateArtifacts(id: string, artifacts: Partial<Artifacts>): Promise<void>;

  /** Remove specific keys from an entity's artifact bag. Keys that don't exist are ignored. */
  removeArtifactKeys(id: string, keys: string[]): Promise<void>;

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

  /** Find all direct children of a parent entity. */
  findByParentId(parentEntityId: string): Promise<Entity[]>;

  /** Move entity to 'cancelled' terminal state and clear claimedBy/claimedAt. */
  cancelEntity(entityId: string): Promise<void>;

  /** Move entity to targetState and clear claimedBy/claimedAt. Returns the updated entity. */
  resetEntity(entityId: string, targetState: string): Promise<Entity>;

  /** Update an entity's pinned flow version. */
  updateFlowVersion(entityId: string, version: number): Promise<void>;
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

  /** Load a flow definition at a specific version. Returns the snapshot if version < current, or live flow if version === current. */
  getAtVersion(flowId: string, version: number): Promise<Flow | null>;

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
    ttlMs: number | undefined,
    context: Record<string, unknown> | undefined,
    agentRole: string | null,
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

/** A raw row from the events table. */
export interface EventRow {
  id: string;
  type: string;
  entityId: string | null;
  flowId: string | null;
  payload: Record<string, unknown> | null;
  emittedAt: number;
}

/** Data-access contract for emitting definition-change events. */
export interface IEventRepository {
  /** Emit a definition change event for a tool action. */
  emitDefinitionChanged(flowId: string | null, tool: string, payload: Record<string, unknown>): Promise<void>;
  /** Get events for a specific entity, ordered by emittedAt descending. */
  findByEntity(entityId: string, limit?: number): Promise<EventRow[]>;
  /** Get the most recent events across all entities, ordered by emittedAt descending. */
  findRecent(limit?: number): Promise<EventRow[]>;
}

/** A persisted domain event from the append-only audit log. */
export interface DomainEvent {
  id: string;
  type: string;
  entityId: string;
  payload: Record<string, unknown>;
  sequence: number;
  emittedAt: number;
}

/** Data-access contract for the append-only domain_events table. */
export interface IDomainEventRepository {
  /** Append a domain event. Sequence is computed as max(sequence)+1 for the entity. */
  append(type: string, entityId: string, payload: Record<string, unknown>): Promise<DomainEvent>;

  /** List domain events for an entity, optionally filtered by type, ordered by sequence ascending. */
  list(entityId: string, opts?: { type?: string; limit?: number; minSequence?: number }): Promise<DomainEvent[]>;

  /** Get the current max sequence number for an entity (0 if no events exist). */
  getLastSequence(entityId: string): Promise<number>;

  /** Append a domain event with optimistic concurrency control.
   *  - When expectedSequence is provided: acts as a CAS check — only appends if the entity's
   *    current max sequence equals expectedSequence; returns null if another writer has advanced it.
   *  - When expectedSequence is undefined: auto-reads the current sequence inside the transaction
   *    and writes at seq+1; sequential callers each succeed with incrementing sequences.
   *  Returns the event on success, or null if another writer won (unique constraint violation). */
  appendCas(
    type: string,
    entityId: string,
    payload: Record<string, unknown>,
    expectedSequence?: number,
  ): Promise<DomainEvent | null>;
}

/** Data-access contract for entity state snapshots (event-sourcing optimization). */
export interface IEntitySnapshotRepository {
  /** Save a snapshot of entity state at a given event sequence number. Ignores duplicates. */
  save(entityId: string, sequence: number, state: Entity): Promise<void>;

  /** Load the latest snapshot for an entity. Returns null if none exists. */
  loadLatest(entityId: string): Promise<{ sequence: number; state: Entity } | null>;
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
      Pick<Gate, "command" | "functionRef" | "apiConfig" | "timeoutMs" | "failurePrompt" | "timeoutPrompt" | "outcomes">
    >,
  ): Promise<Gate>;

  /** Delete the gate result for a specific entity+gate combination. */
  clearResult(entityId: string, gateId: string): Promise<void>;
}
