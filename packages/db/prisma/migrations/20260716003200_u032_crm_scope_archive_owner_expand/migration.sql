-- U032: CRM archive state and canonical operational-owner expansion only.
-- Legacy ownerId/assigneeName remain compatibility history; no row is backfilled or reassigned.

ALTER TABLE "customers" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "owner_assignment_id" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_tasks" ADD COLUMN "owner_assignment_id" TEXT;
ALTER TABLE "work_tasks" ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_assignment_id_fkey"
  FOREIGN KEY ("owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_owner_assignment_id_fkey"
  FOREIGN KEY ("owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "customers_project_id_archived_at_updated_at_id_idx" ON "customers"("project_id", "archived_at", "updated_at", "id");
CREATE INDEX "opportunities_project_id_archived_at_updated_at_id_idx" ON "opportunities"("project_id", "archived_at", "updated_at", "id");
CREATE INDEX "work_tasks_project_id_archived_at_updated_at_id_idx" ON "work_tasks"("project_id", "archived_at", "updated_at", "id");
CREATE INDEX "opportunities_owner_assignment_id_ownership_revision_idx" ON "opportunities"("owner_assignment_id", "ownership_revision");
CREATE INDEX "work_tasks_owner_assignment_id_ownership_revision_idx" ON "work_tasks"("owner_assignment_id", "ownership_revision");

CREATE OR REPLACE FUNCTION public.opportunities_owner_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  project_company_id text;
  assignment_company_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_assignment_id IS DISTINCT FROM OLD.owner_assignment_id THEN
      IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision + 1 THEN
        RAISE EXCEPTION 'opportunities owner_assignment_id change requires ownership_revision increment by exactly one'
          USING ERRCODE = '22023';
      END IF;
      IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        RAISE EXCEPTION 'opportunities legacy owner_id is immutable during canonical owner mutation'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
      RAISE EXCEPTION 'opportunities ownership_revision changed without a corresponding owner_assignment_id change'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.owner_assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project.company_id INTO project_company_id FROM projects AS project WHERE project.id = NEW.project_id;
  SELECT role.company_id INTO assignment_company_id
    FROM user_company_roles AS role
    WHERE role.id = NEW.owner_assignment_id
      AND role.status = 'active'
      AND (role.valid_from IS NULL OR role.valid_from <= CURRENT_TIMESTAMP)
      AND (role.expires_at IS NULL OR role.expires_at > CURRENT_TIMESTAMP)
      AND role.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunities owner assignment is missing, inactive, expired, or revoked'
      USING ERRCODE = '22023';
  END IF;
  IF assignment_company_id IS DISTINCT FROM project_company_id THEN
    RAISE EXCEPTION 'opportunities owner assignment company differs from Project.companyId'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER opportunities_owner_scope_guard_trg
BEFORE INSERT OR UPDATE ON opportunities
FOR EACH ROW EXECUTE FUNCTION public.opportunities_owner_scope_guard_fn();

CREATE OR REPLACE FUNCTION public.work_tasks_owner_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  project_company_id text;
  assignment_company_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_assignment_id IS DISTINCT FROM OLD.owner_assignment_id THEN
      IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision + 1 THEN
        RAISE EXCEPTION 'work_tasks owner_assignment_id change requires ownership_revision increment by exactly one'
          USING ERRCODE = '22023';
      END IF;
      IF NEW.assignee_name IS DISTINCT FROM OLD.assignee_name OR NEW.source IS DISTINCT FROM OLD.source THEN
        RAISE EXCEPTION 'work_tasks legacy assigneeName and source are immutable during canonical owner mutation'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
      RAISE EXCEPTION 'work_tasks ownership_revision changed without a corresponding owner_assignment_id change'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.owner_assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project.company_id INTO project_company_id FROM projects AS project WHERE project.id = NEW.project_id;
  SELECT role.company_id INTO assignment_company_id
    FROM user_company_roles AS role
    WHERE role.id = NEW.owner_assignment_id
      AND role.status = 'active'
      AND (role.valid_from IS NULL OR role.valid_from <= CURRENT_TIMESTAMP)
      AND (role.expires_at IS NULL OR role.expires_at > CURRENT_TIMESTAMP)
      AND role.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_tasks owner assignment is missing, inactive, expired, or revoked'
      USING ERRCODE = '22023';
  END IF;
  IF assignment_company_id IS DISTINCT FROM project_company_id THEN
    RAISE EXCEPTION 'work_tasks owner assignment company differs from Project.companyId'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER work_tasks_owner_scope_guard_trg
BEFORE INSERT OR UPDATE ON work_tasks
FOR EACH ROW EXECUTE FUNCTION public.work_tasks_owner_scope_guard_fn();
