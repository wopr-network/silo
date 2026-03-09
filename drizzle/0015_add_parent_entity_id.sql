ALTER TABLE `entities` ADD `parent_entity_id` text;--> statement-breakpoint
CREATE INDEX `entities_parent_idx` ON `entities` (`parent_entity_id`);
