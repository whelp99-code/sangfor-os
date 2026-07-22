-- U035: immutable quote versions, canonical fulfillment lines, and commercial snapshots.
-- This is expand-only except for the explicitly authorized quote_line_items.sku_id nullability
-- and quote_id FK replacement from CASCADE to RESTRICT.

ALTER TABLE "quotes"
  ADD COLUMN "supersedes_quote_id" TEXT,
  ADD COLUMN "content_hash" TEXT,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "valid_until" TIMESTAMP(3),
  ADD COLUMN "artifact_version_id" TEXT;

ALTER TABLE "quote_line_items"
  ALTER COLUMN "sku_id" DROP NOT NULL,
  ADD COLUMN "line_type" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "quantity_decimal" DECIMAL(20,6),
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "source_service_line_item_id" TEXT,
  ADD COLUMN "source_cost_status" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "sort_order" INTEGER,
  ADD COLUMN "product_family_id" TEXT,
  ADD COLUMN "product_family_key" TEXT,
  ADD COLUMN "product_edition_id" TEXT,
  ADD COLUMN "product_edition_key" TEXT,
  ADD COLUMN "sku_code" TEXT,
  ADD COLUMN "term_months" INTEGER,
  ADD COLUMN "license_metric_id" TEXT,
  ADD COLUMN "license_metric_key" TEXT,
  ADD COLUMN "license_metric_snapshot_hash" TEXT,
  ADD COLUMN "deployment_type" TEXT,
  ADD COLUMN "support_level" TEXT,
  ADD COLUMN "fulfillment_kind" TEXT,
  ADD COLUMN "catalog_snapshot_version" TEXT,
  ADD COLUMN "catalog_snapshot_hash" TEXT,
  ADD COLUMN "sizing_artifact_version_id" TEXT,
  ADD COLUMN "sizing_artifact_version_content_hash" TEXT,
  ADD COLUMN "compatibility_artifact_version_ids" JSONB,
  ADD COLUMN "compatibility_artifact_version_content_hashes" JSONB,
  ADD COLUMN "fulfillment_snapshot" JSONB,
  ADD COLUMN "fulfillment_snapshot_hash" TEXT;

CREATE TABLE "quote_commercial_snapshots" (
  "id" TEXT NOT NULL,
  "quote_id" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "threshold_margin_pct" DECIMAL(8,2) NOT NULL,
  "calculated_revenue" DECIMAL(14,2) NOT NULL,
  "calculated_cost" DECIMAL(14,2) NOT NULL,
  "calculated_margin_pct" DECIMAL(8,2) NOT NULL,
  "cost_coverage_status" TEXT NOT NULL,
  "requires_approval" BOOLEAN NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_commercial_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "quote_line_items" DROP CONSTRAINT "quote_line_items_quote_id_fkey";
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_supersedes_quote_id_fkey" FOREIGN KEY ("supersedes_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_source_service_line_item_id_fkey" FOREIGN KEY ("source_service_line_item_id") REFERENCES "quote_service_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_product_edition_id_fkey" FOREIGN KEY ("product_edition_id") REFERENCES "product_editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_license_metric_id_fkey" FOREIGN KEY ("license_metric_id") REFERENCES "license_metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_sizing_artifact_version_id_fkey" FOREIGN KEY ("sizing_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_commercial_snapshots" ADD CONSTRAINT "quote_commercial_snapshots_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "quotes_supersedes_quote_id_idx" ON "quotes"("supersedes_quote_id");
CREATE INDEX "quotes_artifact_version_id_idx" ON "quotes"("artifact_version_id");
CREATE INDEX "quote_line_items_sku_id_idx" ON "quote_line_items"("sku_id");
CREATE INDEX "quote_line_items_source_service_line_item_id_idx" ON "quote_line_items"("source_service_line_item_id");
CREATE INDEX "quote_line_items_product_family_id_idx" ON "quote_line_items"("product_family_id");
CREATE INDEX "quote_line_items_product_edition_id_idx" ON "quote_line_items"("product_edition_id");
CREATE INDEX "quote_line_items_license_metric_id_idx" ON "quote_line_items"("license_metric_id");
CREATE INDEX "quote_line_items_sizing_artifact_version_id_idx" ON "quote_line_items"("sizing_artifact_version_id");
CREATE UNIQUE INDEX "quote_commercial_snapshots_quote_id_key" ON "quote_commercial_snapshots"("quote_id");

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_content_hash_format_chk"
  CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE "quote_commercial_snapshots" ADD CONSTRAINT "quote_commercial_snapshots_snapshot_hash_format_chk"
  CHECK ("snapshot_hash" ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_fulfillment_v1_complete_chk"
  CHECK (("fulfillment_snapshot" IS NULL AND "fulfillment_snapshot_hash" IS NULL) OR
         ("fulfillment_snapshot" IS NOT NULL AND "fulfillment_snapshot_hash" ~ '^[0-9a-f]{64}$')) NOT VALID;

CREATE OR REPLACE FUNCTION public.quote_canonical_immutable_update_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.content_hash IS NOT NULL THEN
    RAISE EXCEPTION 'quotes are immutable once content_hash is set' USING ERRCODE = '0A000';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['currency', 'content_hash']) IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['currency', 'content_hash']) THEN
    RAISE EXCEPTION 'legacy Quote bridge may only fill currency and content_hash' USING ERRCODE = '22023';
  END IF;
  IF NEW.content_hash IS NULL OR NEW.content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'legacy Quote bridge requires a lowercase SHA-256 content_hash' USING ERRCODE = '22023';
  END IF;
  IF OLD.currency IS NULL AND NEW.currency IS NULL THEN
    RAISE EXCEPTION 'legacy Quote bridge requires currency when legacy currency is null' USING ERRCODE = '22023';
  END IF;
  IF OLD.currency IS NOT NULL AND NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'legacy Quote bridge cannot rewrite currency' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.quote_canonical_immutable_delete_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'Quote history is immutable: DELETE is not permitted' USING ERRCODE = '0A000';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.quote_commercial_snapshot_immutable_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'QuoteCommercialSnapshot history is immutable: % is not permitted', TG_OP USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER quotes_canonical_immutable_update_trg
BEFORE UPDATE ON "quotes" FOR EACH ROW EXECUTE FUNCTION public.quote_canonical_immutable_update_fn();
CREATE TRIGGER quotes_canonical_immutable_delete_trg
BEFORE DELETE ON "quotes" FOR EACH ROW EXECUTE FUNCTION public.quote_canonical_immutable_delete_fn();
CREATE TRIGGER quote_commercial_snapshots_immutable_update_trg
BEFORE UPDATE ON "quote_commercial_snapshots" FOR EACH ROW EXECUTE FUNCTION public.quote_commercial_snapshot_immutable_fn();
CREATE TRIGGER quote_commercial_snapshots_immutable_delete_trg
BEFORE DELETE ON "quote_commercial_snapshots" FOR EACH ROW EXECUTE FUNCTION public.quote_commercial_snapshot_immutable_fn();

CREATE OR REPLACE FUNCTION public.quote_line_fulfillment_v1_validate_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_catalog_hash text;
  v_fulfillment_hash text;
  v_expected_snapshot jsonb;
  v_quote_company_id text;
  v_family_company_id text;
  v_edition_family_id text;
  v_sku_edition_id text;
  v_sku_code text;
  v_family_key text;
  v_edition_key text;
  v_metric_family_id text;
  v_metric_key text;
  v_artifact_hash text;
  v_id text;
  v_hash text;
  v_ordinal bigint;
  v_quantity_decimal_text text;
BEGIN
  IF NEW.fulfillment_snapshot IS NULL AND NEW.fulfillment_snapshot_hash IS NULL THEN
    IF NEW.fulfillment_kind IS NOT NULL OR NEW.line_type IS NOT NULL OR NEW.source_service_line_item_id IS NOT NULL
       OR NEW.source_cost_status IS NOT NULL OR NEW.product_family_id IS NOT NULL OR NEW.product_family_key IS NOT NULL
       OR NEW.product_edition_id IS NOT NULL OR NEW.product_edition_key IS NOT NULL OR NEW.sku_code IS NOT NULL
       OR NEW.term_months IS NOT NULL OR NEW.license_metric_id IS NOT NULL OR NEW.license_metric_key IS NOT NULL
       OR NEW.license_metric_snapshot_hash IS NOT NULL OR NEW.deployment_type IS NOT NULL OR NEW.support_level IS NOT NULL
       OR NEW.catalog_snapshot_version IS NOT NULL OR NEW.catalog_snapshot_hash IS NOT NULL
       OR NEW.sizing_artifact_version_id IS NOT NULL OR NEW.sizing_artifact_version_content_hash IS NOT NULL
       OR NEW.compatibility_artifact_version_ids IS NOT NULL OR NEW.compatibility_artifact_version_content_hashes IS NOT NULL THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: legacy rows may only carry quantity_decimal and currency bridge values' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.fulfillment_snapshot IS NULL OR NEW.fulfillment_snapshot_hash IS NOT NULL OR NEW.catalog_snapshot_hash IS NOT NULL THEN
    RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: caller-supplied or incomplete hashes are rejected' USING ERRCODE = '23514';
  END IF;
  IF NEW.quantity_decimal IS NULL OR NEW.quantity_decimal <= 0 THEN
    RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: quantity_decimal must be positive' USING ERRCODE = '23514';
  END IF;
  v_quantity_decimal_text := trim(trailing '.' from trim(trailing '0' from NEW.quantity_decimal::text));
  IF v_quantity_decimal_text !~ '^(0|[1-9][0-9]*(\.[0-9]*[1-9])?)$' THEN
    RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: quantity_decimal is not canonical base-10 text' USING ERRCODE = '23514';
  END IF;
  IF NEW.license_metric_id IS NULL AND (NEW.license_metric_key IS NOT NULL OR NEW.license_metric_snapshot_hash IS NOT NULL)
     OR NEW.license_metric_id IS NOT NULL AND (NEW.license_metric_key IS NULL OR NEW.license_metric_snapshot_hash IS NULL) THEN
    RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: license provenance is all-or-none' USING ERRCODE = '23514';
  END IF;
  IF NEW.license_metric_snapshot_hash IS NOT NULL AND NEW.license_metric_snapshot_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: malformed license hash' USING ERRCODE = '23514';
  END IF;

  IF NEW.fulfillment_kind = 'service_only' THEN
    IF NEW.line_type IS DISTINCT FROM 'service' OR NEW.source_cost_status IS NULL OR NEW.sku_id IS NOT NULL
       OR NEW.product_family_id IS NOT NULL OR NEW.product_family_key IS NOT NULL OR NEW.product_edition_id IS NOT NULL
       OR NEW.product_edition_key IS NOT NULL OR NEW.sku_code IS NOT NULL OR NEW.catalog_snapshot_version IS NOT NULL
       OR NEW.term_months IS NOT NULL OR NEW.license_metric_id IS NOT NULL OR NEW.sizing_artifact_version_id IS NOT NULL
       OR NEW.sizing_artifact_version_content_hash IS NOT NULL OR NEW.compatibility_artifact_version_ids IS NOT NULL
       OR NEW.compatibility_artifact_version_content_hashes IS NOT NULL THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: invalid service_only shape' USING ERRCODE = '23514';
    END IF;
    v_catalog_hash := NULL;
  ELSIF NEW.fulfillment_kind IN ('perpetual_product', 'subscription_product') THEN
    IF NEW.line_type IS DISTINCT FROM 'product' OR NEW.product_family_id IS NULL OR NEW.product_family_key IS NULL
       OR NEW.product_edition_id IS NULL OR NEW.product_edition_key IS NULL OR NEW.sku_id IS NULL OR NEW.sku_code IS NULL
       OR NEW.catalog_snapshot_version IS DISTINCT FROM 'quote-line-catalog/v1' OR NEW.sizing_artifact_version_id IS NULL
       OR NEW.sizing_artifact_version_content_hash IS NULL OR NEW.compatibility_artifact_version_ids IS NULL
       OR NEW.compatibility_artifact_version_content_hashes IS NULL THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: incomplete product provenance' USING ERRCODE = '23514';
    END IF;
    IF NEW.fulfillment_kind = 'perpetual_product' AND NEW.term_months IS NOT NULL THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: perpetual product termMonths must be null' USING ERRCODE = '23514';
    END IF;
    IF NEW.fulfillment_kind = 'subscription_product' AND (NEW.term_months IS NULL OR NEW.term_months <= 0) THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: subscription termMonths must be positive' USING ERRCODE = '23514';
    END IF;
    SELECT project.company_id INTO v_quote_company_id
      FROM quotes quote JOIN opportunities opportunity ON opportunity.id = quote.opportunity_id
      JOIN projects project ON project.id = opportunity.project_id WHERE quote.id = NEW.quote_id;
    SELECT family.company_id, edition.family_id, sku.edition_id, sku.sku_code, family.family_key, edition.edition_key
      INTO v_family_company_id, v_edition_family_id, v_sku_edition_id, v_sku_code, v_family_key, v_edition_key
      FROM product_skus sku JOIN product_editions edition ON edition.id = sku.edition_id
      JOIN product_families family ON family.id = edition.family_id WHERE sku.id = NEW.sku_id;
    IF v_quote_company_id IS NULL OR v_family_company_id IS DISTINCT FROM v_quote_company_id
       OR v_edition_family_id IS DISTINCT FROM NEW.product_family_id OR v_sku_edition_id IS DISTINCT FROM NEW.product_edition_id
       OR v_sku_code IS DISTINCT FROM NEW.sku_code OR v_family_key IS DISTINCT FROM NEW.product_family_key
       OR v_edition_key IS DISTINCT FROM NEW.product_edition_key THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: catalog parentage or snapshot leaf mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.license_metric_id IS NOT NULL THEN
      SELECT product_family_id, key INTO v_metric_family_id, v_metric_key FROM license_metrics WHERE id = NEW.license_metric_id;
      IF v_metric_family_id IS DISTINCT FROM NEW.product_family_id OR v_metric_key IS DISTINCT FROM NEW.license_metric_key THEN
        RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: license metric family/key mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
    SELECT content_hash INTO v_artifact_hash FROM artifact_versions WHERE id = NEW.sizing_artifact_version_id;
    IF v_artifact_hash IS DISTINCT FROM NEW.sizing_artifact_version_content_hash OR v_artifact_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: sizing artifact ID/hash mismatch' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.compatibility_artifact_version_ids) IS DISTINCT FROM 'array'
       OR jsonb_typeof(NEW.compatibility_artifact_version_content_hashes) IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.compatibility_artifact_version_ids) = 0
       OR jsonb_array_length(NEW.compatibility_artifact_version_ids) <> jsonb_array_length(NEW.compatibility_artifact_version_content_hashes) THEN
      RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: compatibility arrays must be nonempty equal-length arrays' USING ERRCODE = '23514';
    END IF;
    FOR v_id, v_hash, v_ordinal IN
      SELECT ids.value #>> '{}', hashes.value #>> '{}', ids.ordinality
      FROM jsonb_array_elements(NEW.compatibility_artifact_version_ids) WITH ORDINALITY AS ids(value, ordinality)
      JOIN jsonb_array_elements(NEW.compatibility_artifact_version_content_hashes) WITH ORDINALITY AS hashes(value, ordinality) USING (ordinality)
    LOOP
      IF v_id IS NULL OR v_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(NEW.compatibility_artifact_version_ids -> (v_ordinal - 1)::int) <> 'string'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.compatibility_artifact_version_ids) WITH ORDINALITY AS prior(value, ordinality)
                    WHERE prior.ordinality < v_ordinal AND (prior.value #>> '{}') = v_id) THEN
        RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: compatibility IDs must be unique string values' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.compatibility_artifact_version_ids) WITH ORDINALITY AS prior(value, ordinality)
                 WHERE prior.ordinality < v_ordinal AND public.sangfor_utf16_units(prior.value #>> '{}') >= public.sangfor_utf16_units(v_id)) THEN
        RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: compatibility IDs must be JavaScript UTF-16 sorted' USING ERRCODE = '23514';
      END IF;
      SELECT content_hash INTO v_artifact_hash FROM artifact_versions WHERE id = v_id;
      IF v_artifact_hash IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: compatibility ID/hash mismatch' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    v_catalog_hash := public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(jsonb_build_object(
      'catalogSnapshotVersion', NEW.catalog_snapshot_version, 'productFamilyId', NEW.product_family_id,
      'productFamilyKey', NEW.product_family_key, 'productEditionId', NEW.product_edition_id,
      'productEditionKey', NEW.product_edition_key, 'skuId', NEW.sku_id, 'skuCode', NEW.sku_code
    )));
  ELSE
    RAISE EXCEPTION 'quote_line_fulfillment_v1_complete_chk: fulfillment_kind is invalid' USING ERRCODE = '23514';
  END IF;

  v_expected_snapshot := jsonb_build_object(
    'schemaVersion', 'quote-line-fulfillment/v1',
    'source', jsonb_build_object('quoteId', NEW.quote_id, 'quoteLineItemId', NEW.id, 'lineType', NEW.line_type, 'skuId', NEW.sku_id, 'sourceServiceLineItemId', NEW.source_service_line_item_id, 'sourceCostStatus', NEW.source_cost_status),
    'quantity', jsonb_build_object('quantityDecimal', v_quantity_decimal_text, 'currency', NEW.currency),
    'catalog', jsonb_build_object('catalogSnapshotVersion', NEW.catalog_snapshot_version, 'catalogSnapshotHash', v_catalog_hash, 'productFamilyId', NEW.product_family_id, 'productFamilyKey', NEW.product_family_key, 'productEditionId', NEW.product_edition_id, 'productEditionKey', NEW.product_edition_key, 'skuId', NEW.sku_id, 'skuCode', NEW.sku_code),
    'license', jsonb_build_object('licenseMetricId', NEW.license_metric_id, 'licenseMetricKey', NEW.license_metric_key, 'licenseMetricSnapshotHash', NEW.license_metric_snapshot_hash, 'termMonths', NEW.term_months),
    'deployment', jsonb_build_object('deploymentType', NEW.deployment_type, 'supportLevel', NEW.support_level, 'fulfillmentKind', NEW.fulfillment_kind),
    'rules', jsonb_build_object('sizingArtifactVersionId', NEW.sizing_artifact_version_id, 'sizingArtifactVersionContentHash', NEW.sizing_artifact_version_content_hash, 'compatibilityArtifactVersionIds', NEW.compatibility_artifact_version_ids, 'compatibilityArtifactVersionContentHashes', NEW.compatibility_artifact_version_content_hashes)
  );
  IF NEW.fulfillment_snapshot IS DISTINCT FROM v_expected_snapshot THEN
    RAISE EXCEPTION 'quote_line_fulfillment_v1_validate_trg: fulfillmentSnapshot must exactly match typed columns and explicit nulls' USING ERRCODE = '23514';
  END IF;
  NEW.catalog_snapshot_hash := v_catalog_hash;
  v_fulfillment_hash := public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(v_expected_snapshot));
  NEW.fulfillment_snapshot_hash := v_fulfillment_hash;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER quote_line_fulfillment_v1_validate_trg
BEFORE INSERT OR UPDATE ON "quote_line_items"
FOR EACH ROW EXECUTE FUNCTION public.quote_line_fulfillment_v1_validate_fn();
