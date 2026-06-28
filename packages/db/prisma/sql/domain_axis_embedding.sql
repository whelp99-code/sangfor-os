-- V2 additive-only: add embedding column for semantic recall. Safe to re-run.
ALTER TABLE "domain_memories"
  ADD COLUMN IF NOT EXISTS "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT '{}';
