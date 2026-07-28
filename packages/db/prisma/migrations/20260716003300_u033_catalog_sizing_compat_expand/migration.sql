-- U033: additive catalog lifecycle, canonical artifact links, and scope guards.
-- Legacy inline fields and rows remain untouched; no catalog record is backfilled or activated.

ALTER TABLE "product_families"
  ADD COLUMN "company_id" TEXT,
  ADD COLUMN "family_key" TEXT,
  ADD COLUMN "vendor_key" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "product_editions"
  ADD COLUMN "edition_key" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "license_metrics"
  ADD COLUMN "product_family_id" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "product_skus"
  ADD COLUMN "license_metric_id" TEXT,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "term_months" INTEGER,
  ADD COLUMN "deployment_type" TEXT,
  ADD COLUMN "support_level" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "sizing_templates"
  ADD COLUMN "template_key" TEXT,
  ADD COLUMN "artifact_id" TEXT,
  ADD COLUMN "active_artifact_version_id" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "compatibility_rules"
  ADD COLUMN "rule_key" TEXT,
  ADD COLUMN "artifact_id" TEXT,
  ADD COLUMN "active_artifact_version_id" TEXT,
  ADD COLUMN "severity" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "product_families"
  ADD CONSTRAINT "product_families_company_required_chk" CHECK ("company_id" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "product_families_id_company_id_key" UNIQUE ("id", "company_id"),
  ADD CONSTRAINT "product_families_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ProductEdition history must not be removed when a family is removed. This is the one existing
-- FK semantic replacement required by U033; it preserves rows and changes only deletion policy.
ALTER TABLE "product_editions" DROP CONSTRAINT "product_editions_family_id_fkey";
ALTER TABLE "product_editions" ADD CONSTRAINT "product_editions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "license_metrics" ADD CONSTRAINT "license_metrics_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_license_metric_id_fkey" FOREIGN KEY ("license_metric_id") REFERENCES "license_metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sizing_templates" ADD CONSTRAINT "sizing_templates_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sizing_templates" ADD CONSTRAINT "sizing_templates_active_artifact_version_id_fkey" FOREIGN KEY ("active_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compatibility_rules" ADD CONSTRAINT "compatibility_rules_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compatibility_rules" ADD CONSTRAINT "compatibility_rules_active_artifact_version_id_fkey" FOREIGN KEY ("active_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "product_families_company_id_status_archived_at_updated_at_i_idx" ON "product_families"("company_id", "status", "archived_at", "updated_at", "id");
CREATE INDEX "product_families_company_id_vendor_key_family_key_idx" ON "product_families"("company_id", "vendor_key", "family_key");
CREATE INDEX "product_editions_family_id_status_archived_at_updated_at_id_idx" ON "product_editions"("family_id", "status", "archived_at", "updated_at", "id");
CREATE INDEX "product_editions_family_id_edition_key_idx" ON "product_editions"("family_id", "edition_key");
CREATE INDEX "license_metrics_product_family_id_status_updated_at_id_idx" ON "license_metrics"("product_family_id", "status", "updated_at", "id");
CREATE INDEX "product_skus_edition_id_status_archived_at_updated_at_id_idx" ON "product_skus"("edition_id", "status", "archived_at", "updated_at", "id");
CREATE INDEX "product_skus_license_metric_id_idx" ON "product_skus"("license_metric_id");
CREATE INDEX "sizing_templates_product_family_id_status_updated_at_id_idx" ON "sizing_templates"("product_family_id", "status", "updated_at", "id");
CREATE INDEX "sizing_templates_product_family_id_template_key_idx" ON "sizing_templates"("product_family_id", "template_key");
CREATE INDEX "sizing_templates_artifact_id_active_artifact_version_id_idx" ON "sizing_templates"("artifact_id", "active_artifact_version_id");
CREATE INDEX "compatibility_rules_source_sku_id_status_updated_at_id_idx" ON "compatibility_rules"("source_sku_id", "status", "updated_at", "id");
CREATE INDEX "compatibility_rules_source_sku_id_rule_key_idx" ON "compatibility_rules"("source_sku_id", "rule_key");
CREATE INDEX "compatibility_rules_artifact_id_active_artifact_version_id_idx" ON "compatibility_rules"("artifact_id", "active_artifact_version_id");

CREATE OR REPLACE FUNCTION public.product_skus_catalog_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  sku_company_id text;
  metric_company_id text;
BEGIN
  SELECT family.company_id INTO sku_company_id
    FROM product_editions AS edition
    JOIN product_families AS family ON family.id = edition.family_id
    WHERE edition.id = NEW.edition_id;

  IF NEW.license_metric_id IS NOT NULL THEN
    SELECT family.company_id INTO metric_company_id
      FROM license_metrics AS metric
      LEFT JOIN product_families AS family ON family.id = metric.product_family_id
      WHERE metric.id = NEW.license_metric_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product SKU canonical license metric is missing' USING ERRCODE = '23503';
    END IF;
    IF metric_company_id IS DISTINCT FROM sku_company_id THEN
      RAISE EXCEPTION 'license metric ProductFamily.companyId differs from SKU ProductFamily.companyId' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF sku_company_id IS NULL AND NEW.status IN ('active', 'quoted', 'imported') THEN
    RAISE EXCEPTION 'legacy catalog scope is non-canonical and cannot be active, quoted, or imported' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER product_skus_catalog_scope_guard_trg
BEFORE INSERT OR UPDATE ON product_skus
FOR EACH ROW EXECUTE FUNCTION public.product_skus_catalog_scope_guard_fn();

CREATE OR REPLACE FUNCTION public.sizing_templates_catalog_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  family_company_id text;
  artifact_company_id text;
  version_artifact_id text;
  version_company_id text;
BEGIN
  SELECT company_id INTO family_company_id FROM product_families WHERE id = NEW.product_family_id;

  IF NEW.artifact_id IS NOT NULL THEN
    SELECT company_id INTO artifact_company_id FROM artifacts WHERE id = NEW.artifact_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SizingTemplate Artifact is missing' USING ERRCODE = '23503';
    END IF;
    IF artifact_company_id IS DISTINCT FROM family_company_id THEN
      RAISE EXCEPTION 'Artifact.companyId differs from SizingTemplate ProductFamily.companyId' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.active_artifact_version_id IS NOT NULL THEN
    SELECT version.artifact_id, artifact.company_id INTO version_artifact_id, version_company_id
      FROM artifact_versions AS version
      JOIN artifacts AS artifact ON artifact.id = version.artifact_id
      WHERE version.id = NEW.active_artifact_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SizingTemplate active ArtifactVersion is missing' USING ERRCODE = '23503';
    END IF;
    IF NEW.artifact_id IS DISTINCT FROM version_artifact_id THEN
      RAISE EXCEPTION 'ArtifactVersion does not belong to SizingTemplate.artifactId' USING ERRCODE = '22023';
    END IF;
    IF version_company_id IS DISTINCT FROM family_company_id THEN
      RAISE EXCEPTION 'ArtifactVersion Project company differs from SizingTemplate ProductFamily.companyId' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF family_company_id IS NULL AND NEW.status IN ('active', 'quoted', 'imported') THEN
    RAISE EXCEPTION 'legacy catalog scope is non-canonical and cannot be active, quoted, or imported' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sizing_templates_catalog_scope_guard_trg
BEFORE INSERT OR UPDATE ON sizing_templates
FOR EACH ROW EXECUTE FUNCTION public.sizing_templates_catalog_scope_guard_fn();

CREATE OR REPLACE FUNCTION public.compatibility_rules_catalog_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  source_company_id text;
  target_company_id text;
  artifact_company_id text;
  version_artifact_id text;
  version_company_id text;
BEGIN
  SELECT family.company_id INTO source_company_id
    FROM product_skus AS sku
    JOIN product_editions AS edition ON edition.id = sku.edition_id
    JOIN product_families AS family ON family.id = edition.family_id
    WHERE sku.id = NEW.source_sku_id;
  SELECT family.company_id INTO target_company_id
    FROM product_skus AS sku
    JOIN product_editions AS edition ON edition.id = sku.edition_id
    JOIN product_families AS family ON family.id = edition.family_id
    WHERE sku.id = NEW.target_sku_id;

  IF source_company_id IS DISTINCT FROM target_company_id THEN
    RAISE EXCEPTION 'source and target SKU ProductFamily.companyId values differ' USING ERRCODE = '22023';
  END IF;

  IF NEW.artifact_id IS NOT NULL THEN
    SELECT company_id INTO artifact_company_id FROM artifacts WHERE id = NEW.artifact_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CompatibilityRule Artifact is missing' USING ERRCODE = '23503';
    END IF;
    IF artifact_company_id IS DISTINCT FROM source_company_id THEN
      RAISE EXCEPTION 'Artifact.companyId differs from CompatibilityRule ProductFamily.companyId' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.active_artifact_version_id IS NOT NULL THEN
    SELECT version.artifact_id, artifact.company_id INTO version_artifact_id, version_company_id
      FROM artifact_versions AS version
      JOIN artifacts AS artifact ON artifact.id = version.artifact_id
      WHERE version.id = NEW.active_artifact_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CompatibilityRule active ArtifactVersion is missing' USING ERRCODE = '23503';
    END IF;
    IF NEW.artifact_id IS DISTINCT FROM version_artifact_id THEN
      RAISE EXCEPTION 'ArtifactVersion does not belong to CompatibilityRule.artifactId' USING ERRCODE = '22023';
    END IF;
    IF version_company_id IS DISTINCT FROM source_company_id THEN
      RAISE EXCEPTION 'ArtifactVersion Project company differs from CompatibilityRule ProductFamily.companyId' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF source_company_id IS NULL AND NEW.status IN ('active', 'quoted', 'imported') THEN
    RAISE EXCEPTION 'legacy catalog scope is non-canonical and cannot be active, quoted, or imported' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER compatibility_rules_catalog_scope_guard_trg
BEFORE INSERT OR UPDATE ON compatibility_rules
FOR EACH ROW EXECUTE FUNCTION public.compatibility_rules_catalog_scope_guard_fn();
