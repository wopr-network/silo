PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gate_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`command` text,
	`function_ref` text,
	`api_config` text,
	`timeout_ms` integer,
	`failure_prompt` text,
	`timeout_prompt` text
);
--> statement-breakpoint
INSERT INTO `__new_gate_definitions`("id", "name", "type", "command", "function_ref", "api_config", "timeout_ms", "failure_prompt", "timeout_prompt") SELECT "id", "name", "type", "command", "function_ref", "api_config", "timeout_ms", "failure_prompt", "timeout_prompt" FROM `gate_definitions`;--> statement-breakpoint
DROP TABLE `gate_definitions`;--> statement-breakpoint
ALTER TABLE `__new_gate_definitions` RENAME TO `gate_definitions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `gate_definitions_name_unique` ON `gate_definitions` (`name`);--> statement-breakpoint
ALTER TABLE `flow_definitions` ADD `paused` integer DEFAULT 0;