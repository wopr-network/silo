CREATE TABLE "domain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sequence" bigint NOT NULL,
	"emitted_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"state" text NOT NULL,
	"refs" jsonb,
	"artifacts" jsonb,
	"claimed_by" text,
	"claimed_at" bigint,
	"flow_version" bigint,
	"priority" bigint DEFAULT 0,
	"created_at" bigint,
	"updated_at" bigint,
	"affinity_worker_id" text,
	"affinity_role" text,
	"affinity_expires_at" bigint,
	"parent_entity_id" text
);
--> statement-breakpoint
CREATE TABLE "entity_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"seq" serial NOT NULL,
	"entity_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"trigger" text,
	"invocation_id" text,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"state" text NOT NULL,
	"flow_id" text NOT NULL,
	"refs" jsonb,
	"artifacts" jsonb,
	"claimed_by" text,
	"claimed_at" bigint,
	"flow_version" bigint,
	"priority" bigint DEFAULT 0,
	"affinity_worker_id" text,
	"affinity_role" text,
	"affinity_expires_at" bigint,
	"created_at" bigint,
	"updated_at" bigint,
	"snapshot_at" bigint NOT NULL,
	"parent_entity_id" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_id" text,
	"flow_id" text,
	"payload" jsonb,
	"emitted_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entity_schema" jsonb,
	"initial_state" text NOT NULL,
	"max_concurrent" bigint DEFAULT 0,
	"max_concurrent_per_repo" bigint DEFAULT 0,
	"affinity_window_ms" bigint DEFAULT 300000,
	"claim_retry_after_ms" bigint,
	"gate_timeout_ms" bigint,
	"version" bigint DEFAULT 1,
	"created_by" text,
	"discipline" text,
	"default_model_tier" text,
	"timeout_prompt" text,
	"paused" boolean DEFAULT false,
	"issue_tracker_integration_id" text,
	"vcs_integration_id" text,
	"max_credits_per_entity" bigint,
	"max_invocations_per_entity" bigint,
	"created_at" bigint,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "flow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"version" bigint NOT NULL,
	"snapshot" jsonb,
	"changed_by" text,
	"change_reason" text,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "gate_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"command" text,
	"function_ref" text,
	"api_config" jsonb,
	"primitive_op" text,
	"primitive_params" jsonb,
	"timeout_ms" bigint,
	"failure_prompt" text,
	"timeout_prompt" text,
	"outcomes" jsonb
);
--> statement-breakpoint
CREATE TABLE "gate_results" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"seq" serial NOT NULL,
	"entity_id" text NOT NULL,
	"gate_id" text NOT NULL,
	"passed" boolean NOT NULL,
	"output" text,
	"evaluated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"access_token" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holyshipper_containers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"container_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provisioned_at" timestamp with time zone,
	"torn_down_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"stage" text NOT NULL,
	"agent_role" text,
	"mode" text NOT NULL,
	"prompt" text NOT NULL,
	"context" jsonb,
	"claimed_by" text,
	"claimed_at" bigint,
	"started_at" bigint,
	"completed_at" bigint,
	"failed_at" bigint,
	"signal" text,
	"artifacts" jsonb,
	"error" text,
	"ttl_ms" bigint DEFAULT 1800000,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "state_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"name" text NOT NULL,
	"agent_role" text,
	"model_tier" text,
	"mode" text DEFAULT 'passive',
	"prompt_template" text,
	"constraints" jsonb,
	"on_enter" jsonb,
	"on_exit" jsonb,
	"retry_after_ms" bigint,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "transition_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"flow_id" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"trigger" text NOT NULL,
	"gate_id" text,
	"condition" text,
	"priority" bigint DEFAULT 0,
	"spawn_flow" text,
	"spawn_template" text,
	"created_at" bigint
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_flow_id_flow_definitions_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_history" ADD CONSTRAINT "entity_history_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_history" ADD CONSTRAINT "entity_history_invocation_id_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_flow_definitions_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_results" ADD CONSTRAINT "gate_results_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_results" ADD CONSTRAINT "gate_results_gate_id_gate_definitions_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gate_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holyshipper_containers" ADD CONSTRAINT "holyshipper_containers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invocations" ADD CONSTRAINT "invocations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_definitions" ADD CONSTRAINT "state_definitions_flow_id_flow_definitions_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rules" ADD CONSTRAINT "transition_rules_flow_id_flow_definitions_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transition_rules" ADD CONSTRAINT "transition_rules_gate_id_gate_definitions_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gate_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_entity_seq_idx" ON "domain_events" USING btree ("entity_id","sequence");--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("type","emitted_at");--> statement-breakpoint
CREATE INDEX "entities_flow_state_idx" ON "entities" USING btree ("flow_id","state");--> statement-breakpoint
CREATE INDEX "entities_claim_idx" ON "entities" USING btree ("flow_id","state","claimed_by");--> statement-breakpoint
CREATE INDEX "entities_affinity_idx" ON "entities" USING btree ("affinity_worker_id","affinity_role","affinity_expires_at");--> statement-breakpoint
CREATE INDEX "entities_parent_idx" ON "entities" USING btree ("parent_entity_id");--> statement-breakpoint
CREATE INDEX "idx_entities_tenant_state" ON "entities" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "idx_entities_tenant_flow" ON "entities" USING btree ("tenant_id","flow_id");--> statement-breakpoint
CREATE INDEX "entity_history_entity_ts_idx" ON "entity_history" USING btree ("entity_id","timestamp");--> statement-breakpoint
CREATE INDEX "entity_history_invocation_id_idx" ON "entity_history" USING btree ("invocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_snapshots_entity_seq_idx" ON "entity_snapshots" USING btree ("entity_id","sequence");--> statement-breakpoint
CREATE INDEX "entity_snapshots_entity_latest_idx" ON "entity_snapshots" USING btree ("entity_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "events_type_emitted_idx" ON "events" USING btree ("type","emitted_at");--> statement-breakpoint
CREATE INDEX "events_entity_id_idx" ON "events" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "events_emitted_at_idx" ON "events" USING btree ("emitted_at");--> statement-breakpoint
CREATE INDEX "idx_events_tenant" ON "events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flow_tenant_name" ON "flow_definitions" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_flow_definitions_tenant" ON "flow_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_flow_definitions_issue_tracker" ON "flow_definitions" USING btree ("issue_tracker_integration_id");--> statement-breakpoint
CREATE INDEX "idx_flow_definitions_vcs" ON "flow_definitions" USING btree ("vcs_integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flow_version_tenant_flow_ver" ON "flow_versions" USING btree ("tenant_id","flow_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gate_tenant_name" ON "gate_definitions" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_gate_definitions_tenant" ON "gate_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "gate_results_entity_id_idx" ON "gate_results" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "gate_results_gate_id_idx" ON "gate_results" USING btree ("gate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gh_install_tenant_installation" ON "github_installations" USING btree ("tenant_id","installation_id");--> statement-breakpoint
CREATE INDEX "idx_gh_install_tenant" ON "github_installations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_holyshipper_entity" ON "holyshipper_containers" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_holyshipper_tenant" ON "holyshipper_containers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invocations_entity_idx" ON "invocations" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_invocations_tenant" ON "invocations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_state_tenant_flow_name" ON "state_definitions" USING btree ("tenant_id","flow_id","name");--> statement-breakpoint
CREATE INDEX "transition_rules_flow_id_idx" ON "transition_rules" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "transition_rules_gate_id_idx" ON "transition_rules" USING btree ("gate_id");--> statement-breakpoint
CREATE INDEX "idx_transition_rules_tenant" ON "transition_rules" USING btree ("tenant_id");