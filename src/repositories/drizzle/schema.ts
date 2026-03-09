import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─── Definition Tables ───

export const flowDefinitions = sqliteTable("flow_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  entitySchema: text("entity_schema", { mode: "json" }),
  initialState: text("initial_state").notNull(),
  maxConcurrent: integer("max_concurrent").default(0),
  maxConcurrentPerRepo: integer("max_concurrent_per_repo").default(0),
  affinityWindowMs: integer("affinity_window_ms").default(300000),
  claimRetryAfterMs: integer("claim_retry_after_ms"),
  gateTimeoutMs: integer("gate_timeout_ms"),
  version: integer("version").default(1),
  createdBy: text("created_by"),
  discipline: text("discipline"),
  defaultModelTier: text("default_model_tier"),
  timeoutPrompt: text("timeout_prompt"),
  paused: integer("paused").default(0),
  createdAt: integer("created_at"),
  updatedAt: integer("updated_at"),
});

export const stateDefinitions = sqliteTable(
  "state_definitions",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    name: text("name").notNull(),
    agentRole: text("agent_role"),
    modelTier: text("model_tier"),
    mode: text("mode").default("passive"),
    promptTemplate: text("prompt_template"),
    constraints: text("constraints", { mode: "json" }),
    onEnter: text("on_enter", { mode: "json" }),
    retryAfterMs: integer("retry_after_ms"),
  },
  (table) => ({
    flowNameUnique: uniqueIndex("state_definitions_flow_name_unique").on(table.flowId, table.name),
  }),
);

export const gateDefinitions = sqliteTable("gate_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),
  command: text("command"),
  functionRef: text("function_ref"),
  apiConfig: text("api_config", { mode: "json" }),
  timeoutMs: integer("timeout_ms"),
  failurePrompt: text("failure_prompt"),
  timeoutPrompt: text("timeout_prompt"),
  outcomes: text("outcomes", { mode: "json" }),
});

export const transitionRules = sqliteTable("transition_rules", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => flowDefinitions.id),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  trigger: text("trigger").notNull(),
  gateId: text("gate_id").references(() => gateDefinitions.id),
  condition: text("condition"),
  priority: integer("priority").default(0),
  spawnFlow: text("spawn_flow"),
  spawnTemplate: text("spawn_template"),
  createdAt: integer("created_at"),
});

export const flowVersions = sqliteTable(
  "flow_versions",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    version: integer("version").notNull(),
    snapshot: text("snapshot", { mode: "json" }),
    changedBy: text("changed_by"),
    changeReason: text("change_reason"),
    createdAt: integer("created_at"),
  },
  (table) => ({
    flowVersionUnique: uniqueIndex("flow_versions_flow_version_unique").on(table.flowId, table.version),
  }),
);

// ─── Runtime Tables ───

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id")
      .notNull()
      .references(() => flowDefinitions.id),
    state: text("state").notNull(),
    refs: text("refs", { mode: "json" }),
    artifacts: text("artifacts", { mode: "json" }),
    claimedBy: text("claimed_by"),
    claimedAt: integer("claimed_at"),
    flowVersion: integer("flow_version"),
    priority: integer("priority").default(0),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
    affinityWorkerId: text("affinity_worker_id"),
    affinityRole: text("affinity_role"),
    affinityExpiresAt: integer("affinity_expires_at"),
  },
  (table) => ({
    flowStateIdx: index("entities_flow_state_idx").on(table.flowId, table.state),
    claimIdx: index("entities_claim_idx").on(table.flowId, table.state, table.claimedBy),
    affinityIdx: index("entities_affinity_idx").on(table.affinityWorkerId, table.affinityRole, table.affinityExpiresAt),
  }),
);

export const invocations = sqliteTable(
  "invocations",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    stage: text("stage").notNull(),
    agentRole: text("agent_role"),
    mode: text("mode").notNull(),
    prompt: text("prompt").notNull(),
    context: text("context", { mode: "json" }),
    claimedBy: text("claimed_by"),
    claimedAt: integer("claimed_at"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    failedAt: integer("failed_at"),
    signal: text("signal"),
    artifacts: text("artifacts", { mode: "json" }),
    error: text("error"),
    ttlMs: integer("ttl_ms").default(1800000),
    createdAt: integer("created_at"),
  },
  (table) => ({
    entityIdx: index("invocations_entity_idx").on(table.entityId),
  }),
);

export const gateResults = sqliteTable("gate_results", {
  id: text("id").primaryKey(),
  entityId: text("entity_id")
    .notNull()
    .references(() => entities.id),
  gateId: text("gate_id")
    .notNull()
    .references(() => gateDefinitions.id),
  passed: integer("passed").notNull(),
  output: text("output"),
  evaluatedAt: integer("evaluated_at"),
});

export const entityHistory = sqliteTable(
  "entity_history",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    trigger: text("trigger"),
    invocationId: text("invocation_id").references(() => invocations.id),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => ({
    entityTimestampIdx: index("entity_history_entity_ts_idx").on(table.entityId, table.timestamp),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    entityId: text("entity_id"),
    flowId: text("flow_id"),
    payload: text("payload", { mode: "json" }),
    emittedAt: integer("emitted_at").notNull(),
  },
  (table) => ({
    typeEmittedIdx: index("events_type_emitted_idx").on(table.type, table.emittedAt),
  }),
);
