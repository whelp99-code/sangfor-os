-- U036: internal-only discount/vendor request provenance and demo-license secret references.
-- No vendor submission, approval decision, key generation, backfill, uniqueness enforcement, or
-- legacy FK validation occurs here; U040 owns paired-row/orphan proof and constraint validation.

ALTER TABLE "discount_requests"
  ADD COLUMN "vendor_required" BOOLEAN,
  ADD COLUMN "approval_request_id" TEXT,
  ADD COLUMN "requested_by_assignment_id" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "decided_at" TIMESTAMP(3);

ALTER TABLE "vendor_requests"
  ADD COLUMN "quote_id" TEXT,
  ADD COLUMN "discount_request_id" TEXT,
  ADD COLUMN "customer_id" TEXT,
  ADD COLUMN "requested_by_assignment_id" TEXT,
  ADD COLUMN "owner_assignment_id" TEXT,
  ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "external_reference" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "submission_evidence_artifact_version_id" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "vendor_request_events"
  ADD COLUMN "actor_assignment_id" TEXT,
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "created_at" TIMESTAMP(3);

CREATE TABLE "demo_licenses" (
  "id" TEXT NOT NULL,
  "vendor_request_id" TEXT NOT NULL,
  "product_sku_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "secret_ref" TEXT,
  "issued_at" TIMESTAMP(3),
  "starts_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_licenses_pkey" PRIMARY KEY ("id")
);

-- Preserve quote and request history rather than cascading it away.
ALTER TABLE "discount_requests" DROP CONSTRAINT "discount_requests_quote_id_fkey";
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "vendor_request_events" DROP CONSTRAINT "vendor_request_events_request_id_fkey";
ALTER TABLE "vendor_request_events" ADD CONSTRAINT "vendor_request_events_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "vendor_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_approval_request_id_fkey"
  FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_requested_by_assignment_id_fkey"
  FOREIGN KEY ("requested_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_discount_request_id_fkey"
  FOREIGN KEY ("discount_request_id") REFERENCES "discount_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_requested_by_assignment_id_fkey"
  FOREIGN KEY ("requested_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_owner_assignment_id_fkey"
  FOREIGN KEY ("owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_submission_evidence_artifact_version_id_fkey"
  FOREIGN KEY ("submission_evidence_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "vendor_request_events" ADD CONSTRAINT "vendor_request_events_actor_assignment_id_fkey"
  FOREIGN KEY ("actor_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "demo_licenses" ADD CONSTRAINT "demo_licenses_vendor_request_id_fkey"
  FOREIGN KEY ("vendor_request_id") REFERENCES "vendor_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "demo_licenses" ADD CONSTRAINT "demo_licenses_product_sku_id_fkey"
  FOREIGN KEY ("product_sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "demo_licenses" ADD CONSTRAINT "demo_licenses_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE INDEX "discount_requests_approval_request_id_idx" ON "discount_requests"("approval_request_id");
CREATE INDEX "discount_requests_requested_by_assignment_id_idx" ON "discount_requests"("requested_by_assignment_id");
CREATE INDEX "discount_requests_idempotency_key_idx" ON "discount_requests"("idempotency_key");
CREATE INDEX "discount_requests_status_created_at_idx" ON "discount_requests"("status", "created_at");
CREATE INDEX "vendor_requests_quote_id_idx" ON "vendor_requests"("quote_id");
CREATE INDEX "vendor_requests_discount_request_id_idx" ON "vendor_requests"("discount_request_id");
CREATE INDEX "vendor_requests_customer_id_idx" ON "vendor_requests"("customer_id");
CREATE INDEX "vendor_requests_requested_by_assignment_id_idx" ON "vendor_requests"("requested_by_assignment_id");
CREATE INDEX "vendor_requests_owner_assignment_id_ownership_revision_idx" ON "vendor_requests"("owner_assignment_id", "ownership_revision");
CREATE INDEX "vendor_requests_idempotency_key_idx" ON "vendor_requests"("idempotency_key");
CREATE INDEX "vendor_requests_submission_evidence_artifact_version_id_idx" ON "vendor_requests"("submission_evidence_artifact_version_id");
CREATE INDEX "vendor_requests_status_updated_at_idx" ON "vendor_requests"("status", "updated_at");
CREATE INDEX "vendor_request_events_actor_assignment_id_idx" ON "vendor_request_events"("actor_assignment_id");
CREATE INDEX "vendor_request_events_request_id_created_at_idx" ON "vendor_request_events"("request_id", "created_at");
CREATE INDEX "demo_licenses_vendor_request_id_idx" ON "demo_licenses"("vendor_request_id");
CREATE INDEX "demo_licenses_product_sku_id_idx" ON "demo_licenses"("product_sku_id");
CREATE INDEX "demo_licenses_customer_id_status_expires_at_idx" ON "demo_licenses"("customer_id", "status", "expires_at");

CREATE OR REPLACE FUNCTION public.vendor_requests_owner_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  customer_company_id text;
  assignment_company_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_assignment_id IS DISTINCT FROM OLD.owner_assignment_id THEN
      IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision + 1 THEN
        RAISE EXCEPTION 'vendor_requests owner_assignment_id change requires ownership_revision increment by exactly one'
          USING ERRCODE = '22023';
      END IF;
      IF NEW.revision IS DISTINCT FROM OLD.revision THEN
        RAISE EXCEPTION 'vendor_requests owner assignment and domain revision cannot change in one operation'
          USING ERRCODE = '22023';
      END IF;
      IF (to_jsonb(NEW) - ARRAY['owner_assignment_id', 'ownership_revision', 'updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['owner_assignment_id', 'ownership_revision', 'updated_at']) THEN
        RAISE EXCEPTION 'vendor_requests owner reassignment may change only owner_assignment_id and ownership_revision'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
      RAISE EXCEPTION 'vendor_requests ownership_revision changed without a corresponding owner_assignment_id change'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.owner_assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project.company_id INTO customer_company_id
    FROM customers AS customer
    JOIN projects AS project ON project.id = customer.project_id
    WHERE customer.id = NEW.customer_id;
  IF NOT FOUND OR customer_company_id IS NULL THEN
    RAISE EXCEPTION 'vendor_requests owner assignment requires a customer with canonical Project.companyId'
      USING ERRCODE = '22023';
  END IF;

  SELECT role.company_id INTO assignment_company_id
    FROM user_company_roles AS role
    WHERE role.id = NEW.owner_assignment_id
      AND role.status = 'active'
      AND (role.valid_from IS NULL OR role.valid_from <= CURRENT_TIMESTAMP)
      AND (role.expires_at IS NULL OR role.expires_at > CURRENT_TIMESTAMP)
      AND role.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor_requests owner assignment is missing, inactive, expired, or revoked'
      USING ERRCODE = '22023';
  END IF;
  IF assignment_company_id IS DISTINCT FROM customer_company_id THEN
    RAISE EXCEPTION 'vendor_requests owner assignment company differs from Customer Project.companyId'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER vendor_requests_owner_scope_guard_trg
BEFORE INSERT OR UPDATE ON "vendor_requests"
FOR EACH ROW EXECUTE FUNCTION public.vendor_requests_owner_scope_guard_fn();

CREATE OR REPLACE FUNCTION public.vendor_request_events_immutable_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'VendorRequestEvent timeline is immutable: % is not permitted', TG_OP USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER vendor_request_events_immutable_update_trg
BEFORE UPDATE ON "vendor_request_events"
FOR EACH ROW EXECUTE FUNCTION public.vendor_request_events_immutable_fn();
CREATE TRIGGER vendor_request_events_immutable_delete_trg
BEFORE DELETE ON "vendor_request_events"
FOR EACH ROW EXECUTE FUNCTION public.vendor_request_events_immutable_fn();
