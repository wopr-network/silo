DROP INDEX "entity_activity_entity_seq_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "entity_activity_entity_seq_uniq" ON "entity_activity" USING btree ("tenant_id","entity_id","seq");