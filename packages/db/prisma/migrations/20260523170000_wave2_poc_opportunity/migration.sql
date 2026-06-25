-- Wave 2: Sangfor PoC fields, requirements/events/reports, opportunity links, stage normalization

ALTER TABLE "poc_projects" ADD COLUMN IF NOT EXISTS "product_line" TEXT;
ALTER TABLE "poc_projects" ADD COLUMN IF NOT EXISTS "deployment_type" TEXT;
ALTER TABLE "poc_projects" ADD COLUMN IF NOT EXISTS "hw_spec" TEXT;
ALTER TABLE "poc_projects" ADD COLUMN IF NOT EXISTS "sw_spec" TEXT;
ALTER TABLE "poc_projects" ADD COLUMN IF NOT EXISTS "network_notes" TEXT;
ALTER TABLE "poc_projects" ADD COLUMN IF NOT EXISTS "schedule_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "poc_requirements" (
    "id" TEXT NOT NULL,
    "poc_project_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "details" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poc_requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "poc_events" (
    "id" TEXT NOT NULL,
    "poc_project_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poc_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "poc_result_reports" (
    "id" TEXT NOT NULL,
    "poc_project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poc_result_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "partner_id" TEXT;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "close_date" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "next_action" TEXT;

CREATE TABLE IF NOT EXISTS "opportunity_links" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL DEFAULT 'related',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunity_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "poc_requirements_poc_project_id_idx" ON "poc_requirements"("poc_project_id");
CREATE INDEX IF NOT EXISTS "poc_events_poc_project_id_idx" ON "poc_events"("poc_project_id");
CREATE INDEX IF NOT EXISTS "poc_result_reports_poc_project_id_idx" ON "poc_result_reports"("poc_project_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_links_opportunity_id_entity_type_entity_id_key"
  ON "opportunity_links"("opportunity_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "opportunity_links_entity_type_entity_id_idx"
  ON "opportunity_links"("entity_type", "entity_id");

DO $$ BEGIN ALTER TABLE "poc_requirements" ADD CONSTRAINT "poc_requirements_poc_project_id_fkey"
  FOREIGN KEY ("poc_project_id") REFERENCES "poc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "poc_events" ADD CONSTRAINT "poc_events_poc_project_id_fkey"
  FOREIGN KEY ("poc_project_id") REFERENCES "poc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "poc_result_reports" ADD CONSTRAINT "poc_result_reports_poc_project_id_fkey"
  FOREIGN KEY ("poc_project_id") REFERENCES "poc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "opportunity_links" ADD CONSTRAINT "opportunity_links_opportunity_id_fkey"
  FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Non-destructive stage compatibility normalization
UPDATE "opportunities" SET "stage" = 'lead' WHERE "stage" = 'discovery';
UPDATE "opportunities" SET "stage" = 'qualified' WHERE "stage" = 'qualification';

UPDATE "opportunity_stage_events" SET "from_stage" = 'lead' WHERE "from_stage" = 'discovery';
UPDATE "opportunity_stage_events" SET "from_stage" = 'qualified' WHERE "from_stage" = 'qualification';
UPDATE "opportunity_stage_events" SET "to_stage" = 'lead' WHERE "to_stage" = 'discovery';
UPDATE "opportunity_stage_events" SET "to_stage" = 'qualified' WHERE "to_stage" = 'qualification';
