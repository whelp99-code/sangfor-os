-- Additive: assignee + engagement link on work_tasks.
-- No changes to existing columns, enums, or other tables.

ALTER TABLE "work_tasks" ADD COLUMN     "assignee_name" TEXT;
ALTER TABLE "work_tasks" ADD COLUMN     "engagement_id" TEXT;

CREATE INDEX "work_tasks_engagement_id_idx" ON "work_tasks"("engagement_id");
