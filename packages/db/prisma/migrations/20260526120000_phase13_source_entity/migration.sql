-- Phase 13 Sprint 1: optional portal entity linkage on command runs (additive)
ALTER TABLE "command_runs" ADD COLUMN "source_entity_type" TEXT;
ALTER TABLE "command_runs" ADD COLUMN "source_entity_id" TEXT;

CREATE INDEX "command_runs_source_entity_type_source_entity_id_idx"
  ON "command_runs" ("source_entity_type", "source_entity_id");
