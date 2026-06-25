CREATE TABLE IF NOT EXISTS "mail_insight_threads" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "thread_key" TEXT NOT NULL,
  "thread_title" TEXT NOT NULL,
  "source_provider" TEXT NOT NULL DEFAULT 'mail-intelligence',
  "account_id" TEXT,
  "account_email" TEXT,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "message_ids" JSONB,
  "latest_received_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'reference',
  "effective_status" TEXT,
  "ai_enhanced" BOOLEAN NOT NULL DEFAULT false,
  "summary" TEXT NOT NULL,
  "next_actions" JSONB,
  "evidence_items" JSONB,
  "revenue_ops_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "participant_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB,
  "knowledge_document_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mail_insight_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "policy_memories" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "memory_type" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value_json" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'seed',
  "confidence" INTEGER NOT NULL DEFAULT 100,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "policy_memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "policy_decision_logs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "decision_type" TEXT NOT NULL,
  "input_json" JSONB,
  "output_json" JSONB,
  "policy_version" TEXT NOT NULL DEFAULT 'mail-policy-v1',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "policy_decision_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "mail_derived_candidates"
  ADD COLUMN IF NOT EXISTS "mail_insight_thread_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "mail_insight_threads_project_id_thread_key_key"
  ON "mail_insight_threads"("project_id", "thread_key");

CREATE INDEX IF NOT EXISTS "mail_insight_threads_project_id_latest_received_at_idx"
  ON "mail_insight_threads"("project_id", "latest_received_at");

CREATE INDEX IF NOT EXISTS "mail_insight_threads_knowledge_document_id_idx"
  ON "mail_insight_threads"("knowledge_document_id");

CREATE UNIQUE INDEX IF NOT EXISTS "policy_memories_project_id_memory_type_key_key"
  ON "policy_memories"("project_id", "memory_type", "key");

CREATE INDEX IF NOT EXISTS "policy_memories_project_id_memory_type_status_idx"
  ON "policy_memories"("project_id", "memory_type", "status");

CREATE INDEX IF NOT EXISTS "policy_decision_logs_project_id_decision_type_created_at_idx"
  ON "policy_decision_logs"("project_id", "decision_type", "created_at");

CREATE INDEX IF NOT EXISTS "policy_decision_logs_entity_type_entity_id_idx"
  ON "policy_decision_logs"("entity_type", "entity_id");

CREATE UNIQUE INDEX IF NOT EXISTS "mail_derived_candidates_mail_insight_thread_id_candidate_type_key"
  ON "mail_derived_candidates"("mail_insight_thread_id", "candidate_type");

CREATE INDEX IF NOT EXISTS "mail_derived_candidates_mail_insight_thread_id_idx"
  ON "mail_derived_candidates"("mail_insight_thread_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mail_insight_threads_project_id_fkey'
  ) THEN
    ALTER TABLE "mail_insight_threads"
      ADD CONSTRAINT "mail_insight_threads_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mail_insight_threads_knowledge_document_id_fkey'
  ) THEN
    ALTER TABLE "mail_insight_threads"
      ADD CONSTRAINT "mail_insight_threads_knowledge_document_id_fkey"
      FOREIGN KEY ("knowledge_document_id") REFERENCES "knowledge_documents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mail_derived_candidates_knowledge_document_id_fkey'
  ) THEN
    ALTER TABLE "mail_derived_candidates"
      ADD CONSTRAINT "mail_derived_candidates_knowledge_document_id_fkey"
      FOREIGN KEY ("knowledge_document_id") REFERENCES "knowledge_documents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mail_derived_candidates_mail_insight_thread_id_fkey'
  ) THEN
    ALTER TABLE "mail_derived_candidates"
      ADD CONSTRAINT "mail_derived_candidates_mail_insight_thread_id_fkey"
      FOREIGN KEY ("mail_insight_thread_id") REFERENCES "mail_insight_threads"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'policy_memories_project_id_fkey'
  ) THEN
    ALTER TABLE "policy_memories"
      ADD CONSTRAINT "policy_memories_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'policy_decision_logs_project_id_fkey'
  ) THEN
    ALTER TABLE "policy_decision_logs"
      ADD CONSTRAINT "policy_decision_logs_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
