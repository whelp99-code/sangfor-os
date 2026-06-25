-- Wave 3: document versions, knowledge chunks, PoC link on proposals

CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_versions" (
    "id" TEXT NOT NULL,
    "generated_document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "generated_documents" ADD COLUMN IF NOT EXISTS "poc_project_id" TEXT;

CREATE INDEX IF NOT EXISTS "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_generated_document_id_version_key"
  ON "document_versions"("generated_document_id", "version");

DO $$ BEGIN ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_generated_document_id_fkey"
  FOREIGN KEY ("generated_document_id") REFERENCES "generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_poc_project_id_fkey"
  FOREIGN KEY ("poc_project_id") REFERENCES "poc_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
