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
	`snapshot_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_snapshots_entity_seq_idx` ON `entity_snapshots` (`entity_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `entity_snapshots_entity_latest_idx` ON `entity_snapshots` (`entity_id`,`snapshot_at`);