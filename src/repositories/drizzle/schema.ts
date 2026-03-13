import {
  bigint,
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Integration Tables ───

/**
 * Tenant-owned integrations: one row per connected provider instance.
 * A tenant may have multiple integrations of the same category (e.g. two GitHub orgs).
 * Credentials are AES-256-GCM encrypted at rest (SILO_ENCRYPTION_KEY).
 */
export const integrations = pgTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    /** Human-readable label, unique per tenant (e.g. "acme-github", "acme-linear"). */
    name: text("name").notNull(),
    /** "issue_tracker" | "vcs" */
    category: text("category").notNull(),
    /** "linear" | "jira" | "github_issues" | "github" | "gitlab" */
    provider: text("provider").notNull(),
    /** Encrypted JSON: { accessToken, refreshToken?, expiresAt?, ... } */
    credentials: text("credentials").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_integration_tenant_name").on(table.tenantId, table.name),
    index("idx_integrations_tenant").on(table.tenantId),
    index("idx_integrations_tenant_category").on(table.tenantId, table.category),
  ],
);

// ─── Definition Tables ───

export const flowDefinitions = pgTable(
  "flow_definitions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    entitySchema: jsonb("entity_schema"),
    initialState: text("initial_state").notNull(),
    maxConcurrent: bigint("max_concurrent", { mode: "number" }).default(0),
    maxConcurrentPerRepo: bigint("max_concurrent_per_repo", { mode: "number" }).default(0),
    affinityWindowMs: bigint("affinity_window_ms", { mode: "number" }).default(300000),
    claimRetryAfterMs: bigint("claim_retry_after_ms", { mode: "number" }),
    gateTimeoutMs: bigint("gate_timeout_ms", { mode: "number" }),
    version: bigint("version", { mode: "number" }).default(1),
    createdBy: text("created_by"),
    discipline: text("discipline"),
    defaultModelTier: text("default_model_tier"),
    timeoutPrompt: text("timeout_prompt"),
    paused: boolean("paused").default(false),
    /** Integration scoping: which issue tracker and VCS this flow uses for primitive ops. */
    issueTrackerIntegrationId: text("issue_tracker_integration_id").references(() => integrations.id),
    vcsIntegrationId: text("vcs_integration_id").references(() => integrations.id),
    createdAt: bigint("created_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("uq_flow_tenant_name").on(table.tenantId, table.name),
    index("idx_flow_definitions_tenant").on(table.tenantId),
    index("idx_flow_definitions_issue_tracker").on(table.issueTrackerIntegrationId),
    index("idx_flow_definitions_vcs").on(table.vcsIntegrationId),
  ],
);

export const stateDefinitions = pgTable(
  "state_definitions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    name: text("name").notNull(),
    agentRole: text("agent_role"),
    modelTier: text("model_tier"),
    mode: text("mode").default("passive"),
    promptTemplate: text("prompt_template"),
    constraints: jsonb("constraints"),
    onEnter: jsonb("on_enter"),
    onExit: jsonb("on_exit"),
    retryAfterMs: bigint("retry_after_ms", { mode: "number" }),
    /** Opaque metadata passed through to consumers. Silo stores but does not interpret. */
    meta: jsonb("meta"),
  },
  (table) => [uniqueIndex("uq_state_tenant_flow_name").on(table.tenantId, table.flowId, table.name)],
);

export const gateDefinitions = pgTable(
  "gate_definitions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    command: text("command"),
    functionRef: text("function_ref"),
    apiConfig: jsonb("api_config"),
    /** Primitive op identifier, e.g. "vcs.ci_status" or "issue_tracker.comment_exists". */
    primitiveOp: text("primitive_op"),
    /** Handlebars-rendered params passed to the adapter op. */
    primitiveParams: jsonb("primitive_params"),
    timeoutMs: bigint("timeout_ms", { mode: "number" }),
    failurePrompt: text("failure_prompt"),
    timeoutPrompt: text("timeout_prompt"),
    outcomes: jsonb("outcomes"),
  },
  (table) => [
    uniqueIndex("uq_gate_tenant_name").on(table.tenantId, table.name),
    index("idx_gate_definitions_tenant").on(table.tenantId),
  ],
);

export const transitionRules = pgTable(
  "transition_rules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    trigger: text("trigger").notNull(),
    gateId: text("gate_id").references(() => gateDefinitions.id),
    condition: text("condition"),
    priority: bigint("priority", { mode: "number" }).default(0),
    spawnFlow: text("spawn_flow"),
    spawnTemplate: text("spawn_template"),
    createdAt: bigint("created_at", { mode: "number" }),
  },
  (table) => [
    index("transition_rules_flow_id_idx").on(table.flowId),
    index("transition_rules_gate_id_idx").on(table.gateId),
    index("idx_transition_rules_tenant").on(table.tenantId),
  ],
);

export const flowVersions = pgTable(
  "flow_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    version: bigint("version", { mode: "number" }).notNull(),
    snapshot: jsonb("snapshot"),
    changedBy: text("changed_by"),
    changeReason: text("change_reason"),
    createdAt: bigint("created_at", { mode: "number" }),
  },
  (table) => [uniqueIndex("uq_flow_version_tenant_flow_ver").on(table.tenantId, table.flowId, table.version)],
);

// ─── Runtime Tables ───

export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    state: text("state").notNull(),
    refs: jsonb("refs"),
    artifacts: jsonb("artifacts"),
    claimedBy: text("claimed_by"),
    claimedAt: bigint("claimed_at", { mode: "number" }),
    flowVersion: bigint("flow_version", { mode: "number" }),
    priority: bigint("priority", { mode: "number" }).default(0),
    createdAt: bigint("created_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }),
    affinityWorkerId: text("affinity_worker_id"),
    affinityRole: text("affinity_role"),
    affinityExpiresAt: bigint("affinity_expires_at", { mode: "number" }),
    parentEntityId: text("parent_entity_id"),
  },
  (table) => [
    index("entities_flow_state_idx").on(table.flowId, table.state),
    index("entities_claim_idx").on(table.flowId, table.state, table.claimedBy),
    index("entities_affinity_idx").on(table.affinityWorkerId, table.affinityRole, table.affinityExpiresAt),
    index("entities_parent_idx").on(table.parentEntityId),
    index("idx_entities_tenant_state").on(table.tenantId, table.state),
    index("idx_entities_tenant_flow").on(table.tenantId, table.flowId),
  ],
);

export const invocations = pgTable(
  "invocations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    stage: text("stage").notNull(),
    agentRole: text("agent_role"),
    mode: text("mode").notNull(),
    prompt: text("prompt").notNull(),
    context: jsonb("context"),
    claimedBy: text("claimed_by"),
    claimedAt: bigint("claimed_at", { mode: "number" }),
    startedAt: bigint("started_at", { mode: "number" }),
    completedAt: bigint("completed_at", { mode: "number" }),
    failedAt: bigint("failed_at", { mode: "number" }),
    signal: text("signal"),
    artifacts: jsonb("artifacts"),
    error: text("error"),
    ttlMs: bigint("ttl_ms", { mode: "number" }).default(1800000),
    createdAt: bigint("created_at", { mode: "number" }),
  },
  (table) => [index("invocations_entity_idx").on(table.entityId), index("idx_invocations_tenant").on(table.tenantId)],
);

export const gateResults = pgTable(
  "gate_results",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    seq: serial("seq"),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    gateId: text("gate_id")
      .notNull()
      .references(() => gateDefinitions.id),
    passed: boolean("passed").notNull(),
    output: text("output"),
    evaluatedAt: bigint("evaluated_at", { mode: "number" }),
  },
  (table) => [
    index("gate_results_entity_id_idx").on(table.entityId),
    index("gate_results_gate_id_idx").on(table.gateId),
  ],
);

export const entityHistory = pgTable(
  "entity_history",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    seq: serial("seq"),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    trigger: text("trigger"),
    invocationId: text("invocation_id").references(() => invocations.id),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  },
  (table) => [
    index("entity_history_entity_ts_idx").on(table.entityId, table.timestamp),
    index("entity_history_invocation_id_idx").on(table.invocationId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    type: text("type").notNull(),
    entityId: text("entity_id"),
    flowId: text("flow_id"),
    payload: jsonb("payload"),
    emittedAt: bigint("emitted_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("events_type_emitted_idx").on(table.type, table.emittedAt),
    index("events_entity_id_idx").on(table.entityId),
    index("events_emitted_at_idx").on(table.emittedAt),
    index("idx_events_tenant").on(table.tenantId),
  ],
);

export const domainEvents = pgTable(
  "domain_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    type: text("type").notNull(),
    entityId: text("entity_id").notNull(),
    payload: jsonb("payload").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    emittedAt: bigint("emitted_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("domain_events_entity_seq_idx").on(table.entityId, table.sequence),
    index("domain_events_type_idx").on(table.type, table.emittedAt),
  ],
);

export const entitySnapshots = pgTable(
  "entity_snapshots",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityId: text("entity_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    flowId: text("flow_id").notNull(),
    refs: jsonb("refs"),
    artifacts: jsonb("artifacts"),
    claimedBy: text("claimed_by"),
    claimedAt: bigint("claimed_at", { mode: "number" }),
    flowVersion: bigint("flow_version", { mode: "number" }),
    priority: bigint("priority", { mode: "number" }).default(0),
    affinityWorkerId: text("affinity_worker_id"),
    affinityRole: text("affinity_role"),
    affinityExpiresAt: bigint("affinity_expires_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }),
    snapshotAt: bigint("snapshot_at", { mode: "number" }).notNull(),
    parentEntityId: text("parent_entity_id"),
  },
  (table) => [
    uniqueIndex("entity_snapshots_entity_seq_idx").on(table.entityId, table.sequence),
    index("entity_snapshots_entity_latest_idx").on(table.entityId, table.snapshotAt),
  ],
);

// ─── Worker Pool Tables (merged from radar-db) ───

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("uq_source_tenant_name").on(table.tenantId, table.name)],
);

export const watches = pgTable(
  "watches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: text("filter").notNull(),
    action: text("action").notNull(),
    actionConfig: text("action_config").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("watches_source_id_idx").on(table.sourceId)],
);

export const eventLog = pgTable(
  "event_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    watchId: text("watch_id").references(() => watches.id, { onDelete: "cascade" }),
    rawEvent: text("raw_event").notNull(),
    actionTaken: text("action_taken"),
    siloResponse: text("silo_response"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("event_log_source_id_idx").on(table.sourceId), index("event_log_watch_id_idx").on(table.watchId)],
);

export const workers = pgTable("workers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  discipline: text("discipline").notNull(),
  status: text("status").notNull().default("idle"),
  config: text("config"),
  lastHeartbeat: bigint("last_heartbeat", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const entityActivity = pgTable(
  "entity_activity",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityId: text("entity_id").notNull(),
    slotId: text("slot_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    data: text("data").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("entity_activity_entity_id_idx").on(t.entityId),
    uniqueIndex("entity_activity_entity_seq_uniq").on(t.tenantId, t.entityId, t.seq),
  ],
);

export const throughputEvents = pgTable(
  "throughput_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    outcome: text("outcome").notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("throughput_events_created_at_idx").on(t.createdAt)],
);

export const entityMap = pgTable(
  "entity_map",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("entity_map_source_external_uniq").on(t.tenantId, t.sourceId, t.externalId),
    // Separate index on sourceId for efficient FK cascade deletes from sources table.
    index("entity_map_source_id_idx").on(t.sourceId),
  ],
);

// ─── Rate Limiting Table ───

/**
 * Persistent token-bucket state for rate limiting.
 * Key format: "<limiter_name>:<ip>" — one row per (limiter, client IP).
 * Replaces in-memory Maps to satisfy the "no in-memory stores" codebase convention.
 */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  lastRefill: bigint("last_refill", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
