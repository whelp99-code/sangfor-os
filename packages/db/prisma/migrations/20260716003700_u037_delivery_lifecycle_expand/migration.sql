-- U037: internal-only delivery acceptance, projection provenance, and renewal lifecycle schema.
-- No acceptance/projector/reminder runtime, legacy secret migration, orphan repair, FK validation,
-- or uniqueness backfill occurs here; U040 owns deferred validation and remediation evidence.

CREATE TABLE "delivery_acceptances" (
  "id" TEXT NOT NULL,
  "engagement_id" TEXT NOT NULL,
  "quote_id" TEXT NOT NULL,
  "artifact_version_id" TEXT NOT NULL,
  "accepted_by_assignment_id" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "acceptance_hash" TEXT NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_acceptances_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_assets"
  ADD COLUMN "delivery_acceptance_id" TEXT,
  ADD COLUMN "source_quote_line_item_id" TEXT,
  ADD COLUMN "product_family_id" TEXT,
  ADD COLUMN "product_sku_id" TEXT,
  ADD COLUMN "installed_at" TIMESTAMP(3),
  ADD COLUMN "activation_reference" TEXT;

ALTER TABLE "asset_licenses"
  ADD COLUMN "delivery_acceptance_id" TEXT,
  ADD COLUMN "source_quote_line_item_id" TEXT,
  ADD COLUMN "secret_ref" TEXT,
  ADD COLUMN "license_metric_key" TEXT,
  ADD COLUMN "licensed_quantity" DECIMAL(20,6),
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "subscriptions"
  ADD COLUMN "delivery_acceptance_id" TEXT,
  ADD COLUMN "asset_license_id" TEXT,
  ADD COLUMN "source_quote_line_item_id" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "renewal_opportunities"
  ADD COLUMN "subscription_id" TEXT,
  ADD COLUMN "opportunity_id" TEXT,
  ADD COLUMN "renewal_due_at" TIMESTAMP(3),
  ADD COLUMN "owner_assignment_id" TEXT,
  ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idempotency_key" TEXT;

CREATE TABLE "renewal_reminder_events" (
  "id" TEXT NOT NULL,
  "renewal_opportunity_id" TEXT NOT NULL,
  "threshold_days" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "work_task_id" TEXT,
  "notification_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "renewal_reminder_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "delivery_acceptances" ADD CONSTRAINT "delivery_acceptances_engagement_id_fkey"
  FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "delivery_acceptances" ADD CONSTRAINT "delivery_acceptances_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "delivery_acceptances" ADD CONSTRAINT "delivery_acceptances_artifact_version_id_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "delivery_acceptances" ADD CONSTRAINT "delivery_acceptances_accepted_by_assignment_id_fkey"
  FOREIGN KEY ("accepted_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "customer_assets" ADD CONSTRAINT "customer_assets_delivery_acceptance_id_fkey"
  FOREIGN KEY ("delivery_acceptance_id") REFERENCES "delivery_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "customer_assets" ADD CONSTRAINT "customer_assets_source_quote_line_item_id_fkey"
  FOREIGN KEY ("source_quote_line_item_id") REFERENCES "quote_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "customer_assets" ADD CONSTRAINT "customer_assets_product_family_id_fkey"
  FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "customer_assets" ADD CONSTRAINT "customer_assets_product_sku_id_fkey"
  FOREIGN KEY ("product_sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_delivery_acceptance_id_fkey"
  FOREIGN KEY ("delivery_acceptance_id") REFERENCES "delivery_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_source_quote_line_item_id_fkey"
  FOREIGN KEY ("source_quote_line_item_id") REFERENCES "quote_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_delivery_acceptance_id_fkey"
  FOREIGN KEY ("delivery_acceptance_id") REFERENCES "delivery_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_asset_license_id_fkey"
  FOREIGN KEY ("asset_license_id") REFERENCES "asset_licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_source_quote_line_item_id_fkey"
  FOREIGN KEY ("source_quote_line_item_id") REFERENCES "quote_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "renewal_opportunities" DROP CONSTRAINT "renewal_opportunities_customer_id_fkey";
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "customer_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_opportunity_id_fkey"
  FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_owner_assignment_id_fkey"
  FOREIGN KEY ("owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "renewal_reminder_events" ADD CONSTRAINT "renewal_reminder_events_renewal_opportunity_id_fkey"
  FOREIGN KEY ("renewal_opportunity_id") REFERENCES "renewal_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "renewal_reminder_events" ADD CONSTRAINT "renewal_reminder_events_work_task_id_fkey"
  FOREIGN KEY ("work_task_id") REFERENCES "work_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "renewal_reminder_events" ADD CONSTRAINT "renewal_reminder_events_notification_event_id_fkey"
  FOREIGN KEY ("notification_event_id") REFERENCES "notification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE UNIQUE INDEX "delivery_acceptances_engagement_id_key" ON "delivery_acceptances"("engagement_id");
CREATE UNIQUE INDEX "delivery_acceptances_idempotency_key_key" ON "delivery_acceptances"("idempotency_key");
CREATE INDEX "delivery_acceptances_quote_id_idx" ON "delivery_acceptances"("quote_id");
CREATE INDEX "delivery_acceptances_artifact_version_id_idx" ON "delivery_acceptances"("artifact_version_id");
CREATE INDEX "delivery_acceptances_accepted_by_assignment_id_idx" ON "delivery_acceptances"("accepted_by_assignment_id");

CREATE INDEX "customer_assets_delivery_acceptance_id_idx" ON "customer_assets"("delivery_acceptance_id");
CREATE INDEX "customer_assets_source_quote_line_item_id_idx" ON "customer_assets"("source_quote_line_item_id");
CREATE UNIQUE INDEX "customer_assets_delivery_acceptance_source_line_uidx"
  ON "customer_assets"("delivery_acceptance_id", "source_quote_line_item_id")
  WHERE "delivery_acceptance_id" IS NOT NULL AND "source_quote_line_item_id" IS NOT NULL;
CREATE INDEX "asset_licenses_delivery_acceptance_id_idx" ON "asset_licenses"("delivery_acceptance_id");
CREATE INDEX "asset_licenses_source_quote_line_item_id_idx" ON "asset_licenses"("source_quote_line_item_id");
CREATE UNIQUE INDEX "asset_licenses_delivery_acceptance_source_line_uidx"
  ON "asset_licenses"("delivery_acceptance_id", "source_quote_line_item_id")
  WHERE "delivery_acceptance_id" IS NOT NULL AND "source_quote_line_item_id" IS NOT NULL;
CREATE INDEX "subscriptions_delivery_acceptance_id_idx" ON "subscriptions"("delivery_acceptance_id");
CREATE INDEX "subscriptions_source_quote_line_item_id_idx" ON "subscriptions"("source_quote_line_item_id");
CREATE UNIQUE INDEX "subscriptions_delivery_acceptance_source_line_uidx"
  ON "subscriptions"("delivery_acceptance_id", "source_quote_line_item_id")
  WHERE "delivery_acceptance_id" IS NOT NULL AND "source_quote_line_item_id" IS NOT NULL;

CREATE UNIQUE INDEX "renewal_opportunities_subscription_id_key" ON "renewal_opportunities"("subscription_id");
CREATE INDEX "renewal_opportunities_asset_id_idx" ON "renewal_opportunities"("asset_id");
CREATE INDEX "renewal_opportunities_subscription_id_idx" ON "renewal_opportunities"("subscription_id");
CREATE INDEX "renewal_opportunities_opportunity_id_idx" ON "renewal_opportunities"("opportunity_id");
CREATE INDEX "renewal_opportunities_owner_assignment_revision_idx" ON "renewal_opportunities"("owner_assignment_id", "ownership_revision");
CREATE INDEX "renewal_opportunities_idempotency_key_idx" ON "renewal_opportunities"("idempotency_key");
CREATE UNIQUE INDEX "renewal_reminder_events_opportunity_threshold_key" ON "renewal_reminder_events"("renewal_opportunity_id", "threshold_days");
CREATE INDEX "renewal_reminder_events_work_task_id_idx" ON "renewal_reminder_events"("work_task_id");
CREATE INDEX "renewal_reminder_events_notification_event_id_idx" ON "renewal_reminder_events"("notification_event_id");

CREATE OR REPLACE FUNCTION public.delivery_acceptances_immutable_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'DeliveryAcceptance is immutable: % is not permitted', TG_OP USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER delivery_acceptances_immutable_update_trg
BEFORE UPDATE ON "delivery_acceptances"
FOR EACH ROW EXECUTE FUNCTION public.delivery_acceptances_immutable_fn();
CREATE TRIGGER delivery_acceptances_immutable_delete_trg
BEFORE DELETE ON "delivery_acceptances"
FOR EACH ROW EXECUTE FUNCTION public.delivery_acceptances_immutable_fn();

CREATE OR REPLACE FUNCTION public.renewal_opportunities_owner_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  customer_company_id text;
  assignment_company_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
       OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
       OR NEW.renewal_due_at IS DISTINCT FROM OLD.renewal_due_at
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'renewal_opportunities source and creation attribution are immutable'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.owner_assignment_id IS DISTINCT FROM OLD.owner_assignment_id THEN
      IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision + 1 THEN
        RAISE EXCEPTION 'renewal_opportunities owner_assignment_id change requires ownership_revision increment by exactly one'
          USING ERRCODE = '22023';
      END IF;
      IF (to_jsonb(NEW) - ARRAY['owner_assignment_id', 'ownership_revision', 'updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['owner_assignment_id', 'ownership_revision', 'updated_at']) THEN
        RAISE EXCEPTION 'renewal_opportunities owner reassignment may change only owner_assignment_id and ownership_revision'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
      RAISE EXCEPTION 'renewal_opportunities ownership_revision changed without a corresponding owner_assignment_id change'
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
    RAISE EXCEPTION 'renewal_opportunities owner assignment requires a customer with canonical Project.companyId'
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
    RAISE EXCEPTION 'renewal_opportunities owner assignment is missing, inactive, expired, or revoked'
      USING ERRCODE = '22023';
  END IF;
  IF assignment_company_id IS DISTINCT FROM customer_company_id THEN
    RAISE EXCEPTION 'renewal_opportunities owner assignment company differs from Customer Project.companyId'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER renewal_opportunities_owner_scope_guard_trg
BEFORE INSERT OR UPDATE ON "renewal_opportunities"
FOR EACH ROW EXECUTE FUNCTION public.renewal_opportunities_owner_scope_guard_fn();

CREATE OR REPLACE FUNCTION public.renewal_reminder_events_immutable_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'RenewalReminderEvent is immutable: % is not permitted', TG_OP USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER renewal_reminder_events_immutable_update_trg
BEFORE UPDATE ON "renewal_reminder_events"
FOR EACH ROW EXECUTE FUNCTION public.renewal_reminder_events_immutable_fn();
CREATE TRIGGER renewal_reminder_events_immutable_delete_trg
BEFORE DELETE ON "renewal_reminder_events"
FOR EACH ROW EXECUTE FUNCTION public.renewal_reminder_events_immutable_fn();

CREATE OR REPLACE FUNCTION public.asset_licenses_secret_reference_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.license_key IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.license_key IS DISTINCT FROM OLD.license_key) THEN
    RAISE EXCEPTION 'asset_licenses.license_key is legacy read/quarantine material and cannot be newly written'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.secret_ref IS NOT NULL AND NEW.secret_ref !~ '^vault://[A-Za-z0-9._:/-]+$' THEN
    RAISE EXCEPTION 'asset_licenses.secret_ref must be a vault reference, never raw key material'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER asset_licenses_secret_reference_guard_trg
BEFORE INSERT OR UPDATE ON "asset_licenses"
FOR EACH ROW EXECUTE FUNCTION public.asset_licenses_secret_reference_guard_fn();
