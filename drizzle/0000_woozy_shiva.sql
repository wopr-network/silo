CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text NOT NULL,
	`sequence` integer NOT NULL,
	`emitted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_events_entity_seq_idx` ON `domain_events` (`entity_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `domain_events_type_idx` ON `domain_events` (`type`,`emitted_at`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`state` text NOT NULL,
	`refs` text,
	`artifacts` text,
	`claimed_by` text,
	`claimed_at` integer,
	`flow_version` integer,
	`priority` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	`affinity_worker_id` text,
	`affinity_role` text,
	`affinity_expires_at` integer,
	`parent_entity_id` text,
	FOREIGN KEY (`flow_id`) REFERENCES `flow_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entities_flow_state_idx` ON `entities` (`flow_id`,`state`);--> statement-breakpoint
CREATE INDEX `entities_claim_idx` ON `entities` (`flow_id`,`state`,`claimed_by`);--> statement-breakpoint
CREATE INDEX `entities_affinity_idx` ON `entities` (`affinity_worker_id`,`affinity_role`,`affinity_expires_at`);--> statement-breakpoint
CREATE INDEX `entities_parent_idx` ON `entities` (`parent_entity_id`);--> statement-breakpoint
CREATE TABLE `entity_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entity_activity_entity_id_idx` ON `entity_activity` (`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_activity_entity_seq_uniq` ON `entity_activity` (`entity_id`,`seq`);--> statement-breakpoint
CREATE TABLE `entity_history` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`trigger` text,
	`invocation_id` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invocation_id`) REFERENCES `invocations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_history_entity_ts_idx` ON `entity_history` (`entity_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `entity_history_invocation_id_idx` ON `entity_history` (`invocation_id`);--> statement-breakpoint
CREATE TABLE `entity_map` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_map_source_external_uniq` ON `entity_map` (`source_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `entity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`state` text NOT NULL,
	`flow_id` text NOT NULL,
	`refs` text,
	`artifacts` text,
	`claimed_by` text,
	`claimed_at` integer,
	`flow_version` integer,
	`priority` integer DEFAULT 0,
	`affinity_worker_id` text,
	`affinity_role` text,
	`affinity_expires_at` integer,
	`created_at` integer,
	`updated_at` integer,
	`snapshot_at` integer NOT NULL,
	`parent_entity_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_snapshots_entity_seq_idx` ON `entity_snapshots` (`entity_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `entity_snapshots_entity_latest_idx` ON `entity_snapshots` (`entity_id`,`snapshot_at`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`watch_id` text,
	`raw_event` text NOT NULL,
	`action_taken` text,
	`silo_response` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_log_source_id_idx` ON `event_log` (`source_id`);--> statement-breakpoint
CREATE INDEX `event_log_watch_id_idx` ON `event_log` (`watch_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`entity_id` text,
	`flow_id` text,
	`payload` text,
	`emitted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type_emitted_idx` ON `events` (`type`,`emitted_at`);--> statement-breakpoint
CREATE INDEX `events_entity_id_idx` ON `events` (`entity_id`);--> statement-breakpoint
CREATE INDEX `events_emitted_at_idx` ON `events` (`emitted_at`);--> statement-breakpoint
CREATE TABLE `flow_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`entity_schema` text,
	`initial_state` text NOT NULL,
	`max_concurrent` integer DEFAULT 0,
	`max_concurrent_per_repo` integer DEFAULT 0,
	`affinity_window_ms` integer DEFAULT 300000,
	`claim_retry_after_ms` integer,
	`gate_timeout_ms` integer,
	`version` integer DEFAULT 1,
	`created_by` text,
	`discipline` text,
	`default_model_tier` text,
	`timeout_prompt` text,
	`paused` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flow_definitions_name_unique` ON `flow_definitions` (`name`);--> statement-breakpoint
CREATE TABLE `flow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot` text,
	`changed_by` text,
	`change_reason` text,
	`created_at` integer,
	FOREIGN KEY (`flow_id`) REFERENCES `flow_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flow_versions_flow_version_unique` ON `flow_versions` (`flow_id`,`version`);--> statement-breakpoint
CREATE TABLE `gate_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`command` text,
	`function_ref` text,
	`api_config` text,
	`timeout_ms` integer,
	`failure_prompt` text,
	`timeout_prompt` text,
	`outcomes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gate_definitions_name_unique` ON `gate_definitions` (`name`);--> statement-breakpoint
CREATE TABLE `gate_results` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`gate_id` text NOT NULL,
	`passed` integer NOT NULL,
	`output` text,
	`evaluated_at` integer,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gate_id`) REFERENCES `gate_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gate_results_entity_id_idx` ON `gate_results` (`entity_id`);--> statement-breakpoint
CREATE INDEX `gate_results_gate_id_idx` ON `gate_results` (`gate_id`);--> statement-breakpoint
CREATE TABLE `invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`stage` text NOT NULL,
	`agent_role` text,
	`mode` text NOT NULL,
	`prompt` text NOT NULL,
	`context` text,
	`claimed_by` text,
	`claimed_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`failed_at` integer,
	`signal` text,
	`artifacts` text,
	`error` text,
	`ttl_ms` integer DEFAULT 1800000,
	`created_at` integer,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invocations_entity_idx` ON `invocations` (`entity_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_name_unique` ON `sources` (`name`);--> statement-breakpoint
CREATE TABLE `state_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`name` text NOT NULL,
	`agent_role` text,
	`model_tier` text,
	`mode` text DEFAULT 'passive',
	`prompt_template` text,
	`constraints` text,
	`on_enter` text,
	`on_exit` text,
	`retry_after_ms` integer,
	`meta` text,
	FOREIGN KEY (`flow_id`) REFERENCES `flow_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `state_definitions_flow_name_unique` ON `state_definitions` (`flow_id`,`name`);--> statement-breakpoint
CREATE TABLE `throughput_events` (
	`id` text PRIMARY KEY NOT NULL,
	`outcome` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `throughput_events_created_at_idx` ON `throughput_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `transition_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`trigger` text NOT NULL,
	`gate_id` text,
	`condition` text,
	`priority` integer DEFAULT 0,
	`spawn_flow` text,
	`spawn_template` text,
	`created_at` integer,
	FOREIGN KEY (`flow_id`) REFERENCES `flow_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gate_id`) REFERENCES `gate_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transition_rules_flow_id_idx` ON `transition_rules` (`flow_id`);--> statement-breakpoint
CREATE INDEX `transition_rules_gate_id_idx` ON `transition_rules` (`gate_id`);--> statement-breakpoint
CREATE TABLE `watches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`filter` text NOT NULL,
	`action` text NOT NULL,
	`action_config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `watches_source_id_idx` ON `watches` (`source_id`);--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`discipline` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`config` text,
	`last_heartbeat` integer NOT NULL,
	`created_at` integer NOT NULL
);
