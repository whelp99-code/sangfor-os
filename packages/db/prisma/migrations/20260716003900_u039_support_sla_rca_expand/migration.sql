-- U039: versioned support SLA, exact case snapshots, vendor escalation provenance, and RCA links.
-- Expand only. U040 owns legacy-policy backfill, validation, and any later uniqueness tightening.

ALTER TABLE "support_sla_policies"
  ADD COLUMN "company_id" TEXT,
  ADD COLUMN "policy_key" TEXT,
  ADD COLUMN "current_version_id" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "support_sla_policies"
  ADD CONSTRAINT "support_sla_policies_company_required_chk"
    CHECK ("company_id" IS NOT NULL) NOT VALID;

ALTER TABLE "support_sla_policies"
  ADD CONSTRAINT "support_sla_policies_id_company_id_key" UNIQUE ("id", "company_id");

CREATE TABLE "support_sla_policy_versions" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "severity" TEXT NOT NULL,
  "response_minutes" INTEGER NOT NULL,
  "resolution_minutes" INTEGER NOT NULL,
  "vendor_escalation_minutes" INTEGER,
  "customer_update_minutes" INTEGER,
  "clock_kind" TEXT NOT NULL DEFAULT 'elapsed_24x7',
  "content_hash" TEXT NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "retired_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_sla_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_sla_policy_versions_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "support_sla_policy_versions_policy_id_version_key" UNIQUE ("policy_id", "version")
);

ALTER TABLE "support_sla_policy_versions"
  ADD CONSTRAINT "support_sla_policy_versions_values_chk" CHECK (
    "version" > 0
    AND btrim("severity") <> ''
    AND "response_minutes" > 0
    AND "resolution_minutes" > 0
    AND ("vendor_escalation_minutes" IS NULL OR "vendor_escalation_minutes" > 0)
    AND ("customer_update_minutes" IS NULL OR "customer_update_minutes" > 0)
    AND "clock_kind" = 'elapsed_24x7'
    AND "content_hash" ~ '^[0-9a-f]{64}$'
  ) NOT VALID;

ALTER TABLE "support_sla_policies"
  ADD CONSTRAINT "support_sla_policies_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "support_sla_policies_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "support_sla_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "support_sla_policy_versions"
  ADD CONSTRAINT "support_sla_policy_versions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "support_sla_policy_versions_policy_company_fkey"
    FOREIGN KEY ("policy_id", "company_id") REFERENCES "support_sla_policies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE INDEX "support_sla_policies_company_id_idx" ON "support_sla_policies"("company_id");
CREATE INDEX "support_sla_policies_current_version_id_idx" ON "support_sla_policies"("current_version_id");
CREATE INDEX "support_sla_policy_versions_company_id_policy_id_idx" ON "support_sla_policy_versions"("company_id", "policy_id");

CREATE OR REPLACE FUNCTION public.support_sla_policies_current_version_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  version_row record;
BEGIN
  IF NEW."current_version_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, policy_id, company_id INTO version_row
    FROM support_sla_policy_versions WHERE id = NEW."current_version_id";
  IF NOT FOUND
     OR version_row.policy_id IS DISTINCT FROM NEW.id
     OR version_row.company_id IS DISTINCT FROM NEW."company_id" THEN
    RAISE EXCEPTION 'SupportSlaPolicy currentVersion must belong to the same policy and company' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER support_sla_policies_current_version_guard_trg
BEFORE INSERT OR UPDATE ON "support_sla_policies"
FOR EACH ROW EXECUTE FUNCTION public.support_sla_policies_current_version_guard_fn();

CREATE OR REPLACE FUNCTION public.support_sla_policy_versions_immutable_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SupportSlaPolicyVersion is immutable: DELETE is not permitted' USING ERRCODE = '0A000';
  END IF;
  IF OLD."retired_at" IS NULL AND NEW."retired_at" IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['retired_at']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['retired_at']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SupportSlaPolicyVersion is immutable except one null-to-timestamp retirement' USING ERRCODE = '22023';
END;
$fn$;

CREATE TRIGGER support_sla_policy_versions_immutable_update_trg
BEFORE UPDATE ON "support_sla_policy_versions"
FOR EACH ROW EXECUTE FUNCTION public.support_sla_policy_versions_immutable_guard_fn();
CREATE TRIGGER support_sla_policy_versions_immutable_delete_trg
BEFORE DELETE ON "support_sla_policy_versions"
FOR EACH ROW EXECUTE FUNCTION public.support_sla_policy_versions_immutable_guard_fn();

ALTER TABLE "support_cases"
  ADD COLUMN "asset_id" TEXT,
  ADD COLUMN "owner_assignment_id" TEXT,
  ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "responded_at" TIMESTAMP(3),
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "rca_artifact_version_id" TEXT,
  ADD COLUMN "rca_required_at" TIMESTAMP(3),
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "support_cases" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
ALTER TABLE "support_cases" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "support_cases" DROP CONSTRAINT "support_cases_customer_id_fkey";
ALTER TABLE "support_cases"
  ADD CONSTRAINT "support_cases_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "support_cases_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "customer_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "support_cases_owner_assignment_id_fkey"
    FOREIGN KEY ("owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "support_cases_rca_artifact_version_id_fkey"
    FOREIGN KEY ("rca_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE INDEX "support_cases_asset_id_idx" ON "support_cases"("asset_id");
CREATE INDEX "support_cases_owner_assignment_id_ownership_revision_idx" ON "support_cases"("owner_assignment_id", "ownership_revision");
CREATE INDEX "support_cases_rca_artifact_version_id_idx" ON "support_cases"("rca_artifact_version_id");

CREATE TABLE "support_case_sla_snapshots" (
  "id" TEXT NOT NULL,
  "support_case_id" TEXT NOT NULL,
  "policy_version_id" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "response_minutes" INTEGER NOT NULL,
  "resolution_minutes" INTEGER NOT NULL,
  "vendor_escalation_minutes" INTEGER,
  "customer_update_minutes" INTEGER,
  "clock_kind" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "response_due_at" TIMESTAMP(3) NOT NULL,
  "resolution_due_at" TIMESTAMP(3) NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_case_sla_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_case_sla_snapshots_support_case_id_key" UNIQUE ("support_case_id")
);

ALTER TABLE "support_case_sla_snapshots"
  ADD CONSTRAINT "support_case_sla_snapshots_values_chk" CHECK (
    btrim("severity") <> ''
    AND "response_minutes" > 0
    AND "resolution_minutes" > 0
    AND ("vendor_escalation_minutes" IS NULL OR "vendor_escalation_minutes" > 0)
    AND ("customer_update_minutes" IS NULL OR "customer_update_minutes" > 0)
    AND "clock_kind" = 'elapsed_24x7'
    AND "response_due_at" >= "started_at"
    AND "resolution_due_at" >= "response_due_at"
    AND "snapshot_hash" ~ '^[0-9a-f]{64}$'
  ) NOT VALID;

ALTER TABLE "support_case_sla_snapshots"
  ADD CONSTRAINT "support_case_sla_snapshots_support_case_id_fkey"
    FOREIGN KEY ("support_case_id") REFERENCES "support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "support_case_sla_snapshots_policy_version_id_fkey"
    FOREIGN KEY ("policy_version_id") REFERENCES "support_sla_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
CREATE INDEX "support_case_sla_snapshots_policy_version_id_idx" ON "support_case_sla_snapshots"("policy_version_id");

CREATE OR REPLACE FUNCTION public.support_cases_owner_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  case_company_id text;
  assignment_company_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."owner_assignment_id" IS DISTINCT FROM OLD."owner_assignment_id" THEN
      IF NEW."ownership_revision" IS DISTINCT FROM OLD."ownership_revision" + 1
         OR NEW."revision" IS DISTINCT FROM OLD."revision"
         OR (to_jsonb(NEW) - ARRAY['owner_assignment_id', 'ownership_revision', 'updated_at']) IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['owner_assignment_id', 'ownership_revision', 'updated_at']) THEN
        RAISE EXCEPTION 'support_cases owner reassignment may change only owner_assignment_id and ownership_revision' USING ERRCODE = '22023';
      END IF;
    ELSIF NEW."ownership_revision" IS DISTINCT FROM OLD."ownership_revision" THEN
      RAISE EXCEPTION 'support_cases ownership_revision changed without a corresponding owner_assignment_id change' USING ERRCODE = '22023';
    ELSIF (to_jsonb(NEW) - ARRAY['status', 'responded_at', 'resolved_at', 'closed_at', 'rca_artifact_version_id', 'rca_required_at', 'revision', 'updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'responded_at', 'resolved_at', 'closed_at', 'rca_artifact_version_id', 'rca_required_at', 'revision', 'updated_at'])
       OR NEW."revision" IS NOT DISTINCT FROM OLD."revision"
       OR NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
      RAISE EXCEPTION 'support_cases domain state/RCA mutation requires exactly one revision increment and cannot rewrite immutable attribution' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW."owner_assignment_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT project.company_id INTO case_company_id
    FROM customers AS customer JOIN projects AS project ON project.id = customer.project_id
    WHERE customer.id = NEW.customer_id;
  IF NOT FOUND OR case_company_id IS NULL THEN
    RAISE EXCEPTION 'support_cases owner assignment requires a customer with canonical Project.companyId' USING ERRCODE = '22023';
  END IF;
  SELECT company_id INTO assignment_company_id
    FROM user_company_roles
    WHERE id = NEW."owner_assignment_id"
      AND status = 'active'
      AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_cases owner assignment is missing, inactive, expired, or revoked' USING ERRCODE = '22023';
  END IF;
  IF assignment_company_id IS DISTINCT FROM case_company_id THEN
    RAISE EXCEPTION 'support_cases owner assignment company differs from Customer Project.companyId' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER support_cases_owner_scope_guard_trg
BEFORE INSERT OR UPDATE ON "support_cases"
FOR EACH ROW EXECUTE FUNCTION public.support_cases_owner_scope_guard_fn();

ALTER TABLE "vendor_escalations"
  ADD COLUMN "vendor_request_id" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "external_reference" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "submission_evidence_artifact_version_id" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "vendor_escalations" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
ALTER TABLE "vendor_escalations" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "vendor_escalations" DROP CONSTRAINT "vendor_escalations_case_id_fkey";
ALTER TABLE "vendor_escalations"
  ADD CONSTRAINT "vendor_escalations_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "vendor_escalations_vendor_request_id_fkey"
    FOREIGN KEY ("vendor_request_id") REFERENCES "vendor_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "vendor_escalations_submission_evidence_artifact_version_id_fkey"
    FOREIGN KEY ("submission_evidence_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "vendor_escalations_status_chk"
    CHECK ("status" IN ('draft', 'manually_submitted', 'waiting_vendor', 'approved', 'rejected', 'cancelled', 'completed')) NOT VALID,
  ADD CONSTRAINT "vendor_escalations_revision_chk" CHECK ("revision" >= 0) NOT VALID,
  ADD CONSTRAINT "vendor_escalations_terminal_resolved_at_chk" CHECK (
    (("status" IN ('draft', 'manually_submitted', 'waiting_vendor')) AND "resolved_at" IS NULL)
    OR (("status" IN ('approved', 'rejected', 'cancelled', 'completed')) AND "resolved_at" IS NOT NULL)
  ) NOT VALID;

CREATE UNIQUE INDEX "vendor_escalations_vendor_request_id_key" ON "vendor_escalations"("vendor_request_id");
CREATE INDEX "vendor_escalations_submission_evidence_artifact_version_id_idx" ON "vendor_escalations"("submission_evidence_artifact_version_id");
CREATE INDEX "vendor_escalations_status_updated_at_idx" ON "vendor_escalations"("status", "updated_at");

CREATE OR REPLACE FUNCTION public.vendor_escalations_pair_state_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  request_row record;
  case_project_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'rejected', 'cancelled', 'completed') THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW."resolved_at" IS DISTINCT FROM OLD."resolved_at" THEN
      RAISE EXCEPTION 'vendor_escalations terminal status and resolvedAt are immutable' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW."vendor_request_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT request.id, request.status, request.revision, project.id AS project_id
    INTO request_row
    FROM vendor_requests AS request
    JOIN customers AS customer ON customer.id = request.customer_id
    JOIN projects AS project ON project.id = customer.project_id
    WHERE request.id = NEW."vendor_request_id";
  SELECT project.id INTO case_project_id
    FROM support_cases AS support_case
    JOIN customers AS customer ON customer.id = support_case.customer_id
    JOIN projects AS project ON project.id = customer.project_id
    WHERE support_case.id = NEW.case_id;
  IF NOT FOUND OR request_row.id IS NULL OR case_project_id IS NULL OR request_row.project_id IS DISTINCT FROM case_project_id THEN
    RAISE EXCEPTION 'vendor_escalations paired VendorRequest is missing, foreign, or cross-project' USING ERRCODE = '22023';
  END IF;
  IF NEW.revision IS DISTINCT FROM request_row.revision THEN
    RAISE EXCEPTION 'vendor_escalations paired revision must equal VendorRequest.revision' USING ERRCODE = '22023';
  END IF;
  IF (request_row.status = 'ready_for_manual_submission' AND NEW.status <> 'draft')
     OR (request_row.status IN ('manually_submitted', 'waiting_vendor', 'approved', 'rejected', 'cancelled', 'completed') AND NEW.status <> request_row.status)
     OR request_row.status NOT IN ('ready_for_manual_submission', 'manually_submitted', 'waiting_vendor', 'approved', 'rejected', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'vendor_escalations paired status does not match VendorRequest status map' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER vendor_escalations_pair_state_guard_trg
BEFORE INSERT OR UPDATE ON "vendor_escalations"
FOR EACH ROW EXECUTE FUNCTION public.vendor_escalations_pair_state_guard_fn();
