CREATE TABLE IF NOT EXISTS "mail_derived_candidates" (
  "id" TEXT NOT NULL,
  "knowledge_document_id" TEXT,
  "candidate_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "source_title" TEXT,
  "source_sender" TEXT,
  "source_received_at" TIMESTAMP(3),
  "confidence" INTEGER NOT NULL DEFAULT 60,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "created_entity_type" TEXT,
  "created_entity_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mail_derived_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mail_derived_candidates_knowledge_document_id_candidate_type_key"
  ON "mail_derived_candidates"("knowledge_document_id", "candidate_type");

CREATE INDEX IF NOT EXISTS "mail_derived_candidates_status_candidate_type_created_at_idx"
  ON "mail_derived_candidates"("status", "candidate_type", "created_at");

CREATE INDEX IF NOT EXISTS "mail_derived_candidates_knowledge_document_id_idx"
  ON "mail_derived_candidates"("knowledge_document_id");
