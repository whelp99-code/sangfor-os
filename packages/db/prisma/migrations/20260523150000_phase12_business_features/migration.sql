-- Phase 12 PoC, Opportunity, Knowledge, Proposal

CREATE TABLE IF NOT EXISTS "poc_projects" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "partner_id" TEXT,
    "title" TEXT NOT NULL,
    "product_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "requirements" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "poc_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "poc_checklist_items" (
    "id" TEXT NOT NULL,
    "poc_project_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poc_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "poc_issues" (
    "id" TEXT NOT NULL,
    "poc_project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poc_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "opportunities" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'discovery',
    "amount" DECIMAL(12,2),
    "probability" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "opportunity_stage_events" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunity_stage_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "knowledge_documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "generated_documents" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "poc_projects_project_id_status_idx" ON "poc_projects"("project_id", "status");
CREATE INDEX IF NOT EXISTS "poc_checklist_items_poc_project_id_idx" ON "poc_checklist_items"("poc_project_id");
CREATE INDEX IF NOT EXISTS "poc_issues_poc_project_id_idx" ON "poc_issues"("poc_project_id");
CREATE INDEX IF NOT EXISTS "opportunities_project_id_stage_idx" ON "opportunities"("project_id", "stage");
CREATE INDEX IF NOT EXISTS "opportunity_stage_events_opportunity_id_idx" ON "opportunity_stage_events"("opportunity_id");
CREATE INDEX IF NOT EXISTS "knowledge_documents_project_id_idx" ON "knowledge_documents"("project_id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_project_id_template_key_key" ON "document_templates"("project_id", "template_key");
CREATE INDEX IF NOT EXISTS "generated_documents_template_id_idx" ON "generated_documents"("template_id");

DO $$ BEGIN ALTER TABLE "poc_projects" ADD CONSTRAINT "poc_projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "poc_projects" ADD CONSTRAINT "poc_projects_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "poc_checklist_items" ADD CONSTRAINT "poc_checklist_items_poc_project_id_fkey" FOREIGN KEY ("poc_project_id") REFERENCES "poc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "poc_issues" ADD CONSTRAINT "poc_issues_poc_project_id_fkey" FOREIGN KEY ("poc_project_id") REFERENCES "poc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "opportunity_stage_events" ADD CONSTRAINT "opportunity_stage_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
