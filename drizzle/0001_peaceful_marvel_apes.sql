PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entity_history` (
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
INSERT INTO `__new_entity_history`("id", "entity_id", "from_state", "to_state", "trigger", "invocation_id", "timestamp") SELECT "id", "entity_id", "from_state", "to_state", "trigger", "invocation_id", "timestamp" FROM `entity_history`;--> statement-breakpoint
DROP TABLE `entity_history`;--> statement-breakpoint
ALTER TABLE `__new_entity_history` RENAME TO `entity_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entity_history_entity_ts_idx` ON `entity_history` (`entity_id`,`timestamp`);