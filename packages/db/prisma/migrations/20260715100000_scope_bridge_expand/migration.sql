-- Additive: nullable Project -> Company correlation bridge (U010).
-- No changes to existing columns, enums, other tables, or existing row data.
-- Project.company_id is a correlation-only bridge (backfill/NOT NULL is a later unit's
-- responsibility); every existing projects row's company_id stays NULL after this migration.

ALTER TABLE "projects" ADD COLUMN     "company_id" TEXT;

CREATE INDEX "projects_company_id_idx" ON "projects"("company_id");

ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
