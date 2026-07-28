-- U038: internal-only people eligibility schema. Runtime eligibility decisions remain deferred.

ALTER TABLE "engineer_certifications"
  ADD COLUMN "definition_id" TEXT,
  ADD COLUMN "engineer_membership_id" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "revoked_at" TIMESTAMP(3),
  ADD COLUMN "revocation_reason" TEXT,
  ADD COLUMN "revision" INTEGER;

ALTER TABLE "engineer_certifications"
  ADD CONSTRAINT "engineer_certifications_status_chk"
    CHECK ("status" IS NULL OR "status" IN ('legacy_unverified', 'pending', 'active', 'revoked')) NOT VALID,
  ADD CONSTRAINT "engineer_certifications_revision_chk"
    CHECK ("revision" IS NULL OR "revision" >= 0) NOT VALID,
  ADD CONSTRAINT "engineer_certifications_lifecycle_chk"
    CHECK (
      ("status" IS NULL AND "revision" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
      OR ("status" = 'legacy_unverified' AND "revision" = 0 AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
      OR ("status" = 'pending' AND "revision" = 0 AND "definition_id" IS NOT NULL AND "engineer_membership_id" IS NOT NULL
          AND "issuedAt" IS NULL AND "expiresAt" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
      OR ("status" = 'active' AND "revision" >= 1 AND "definition_id" IS NOT NULL AND "engineer_membership_id" IS NOT NULL
          AND "issuedAt" IS NOT NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
      OR ("status" = 'revoked' AND "revision" >= 2 AND "definition_id" IS NOT NULL AND "engineer_membership_id" IS NOT NULL
          AND "issuedAt" IS NOT NULL AND "revoked_at" IS NOT NULL AND btrim("revocation_reason") <> '')
    ) NOT VALID;

CREATE TABLE "certification_definitions" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vendor_key" TEXT NOT NULL,
  "product_family_id" TEXT,
  "level" TEXT,
  "issuer" TEXT NOT NULL,
  "validity_days" INTEGER,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certification_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certification_definitions_company_id_key_key" UNIQUE ("company_id", "key"),
  CONSTRAINT "certification_definitions_status_chk" CHECK ("status" IN ('draft', 'active', 'retired')),
  CONSTRAINT "certification_definitions_validity_days_chk" CHECK ("validity_days" IS NULL OR "validity_days" > 0),
  CONSTRAINT "certification_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "certification_definitions_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "certification_evidence" (
  "id" TEXT NOT NULL,
  "certification_id" TEXT NOT NULL,
  "artifact_version_id" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "external_reference" TEXT,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "verified_by_assignment_id" TEXT NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certification_evidence_lifecycle_chk" CHECK ("verified_at" <= "created_at" AND ("revoked_at" IS NULL OR "revoked_at" >= "verified_at")),
  CONSTRAINT "certification_evidence_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "engineer_certifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "certification_evidence_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "certification_evidence_verified_by_assignment_id_fkey" FOREIGN KEY ("verified_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "engineer_skills" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "engineer_membership_id" TEXT NOT NULL,
  "product_family_id" TEXT NOT NULL,
  "capability_key" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "source_artifact_version_id" TEXT,
  "verified_at" TIMESTAMP(3),
  "verified_by_assignment_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "engineer_skills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engineer_skills_status_chk" CHECK ("status" IN ('active', 'inactive')),
  CONSTRAINT "engineer_skills_active_verification_chk" CHECK ("status" <> 'active' OR ("verified_at" IS NOT NULL AND "verified_by_assignment_id" IS NOT NULL AND "level" >= 0)),
  CONSTRAINT "engineer_skills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_skills_engineer_membership_id_fkey" FOREIGN KEY ("engineer_membership_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_skills_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_skills_source_artifact_version_id_fkey" FOREIGN KEY ("source_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_skills_verified_by_assignment_id_fkey" FOREIGN KEY ("verified_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "engineer_eligibility_policies" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "product_family_id" TEXT,
  "capability_key" TEXT NOT NULL,
  "minimum_skill_level" INTEGER NOT NULL,
  "certification_definition_id" TEXT,
  "status" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "engineer_eligibility_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engineer_eligibility_policies_company_id_key_version_key" UNIQUE ("company_id", "key", "version"),
  CONSTRAINT "engineer_eligibility_policies_status_chk" CHECK ("status" IN ('draft', 'active', 'retired')),
  CONSTRAINT "engineer_eligibility_policies_values_chk" CHECK ("version" > 0 AND "minimum_skill_level" >= 0 AND "content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "engineer_eligibility_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_eligibility_policies_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_eligibility_policies_certification_definition_id_fkey" FOREIGN KEY ("certification_definition_id") REFERENCES "certification_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "engagement_capability_requirements" (
  "id" TEXT NOT NULL,
  "engagement_id" TEXT NOT NULL,
  "eligibility_policy_id" TEXT,
  "product_family_id" TEXT NOT NULL,
  "capability_key" TEXT NOT NULL,
  "minimum_skill_level" INTEGER NOT NULL,
  "certification_definition_id" TEXT,
  "headcount" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "engagement_capability_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_capability_requirements_values_chk" CHECK ("minimum_skill_level" >= 0 AND "headcount" > 0),
  CONSTRAINT "engagement_capability_requirements_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engagement_capability_requirements_eligibility_policy_id_fkey" FOREIGN KEY ("eligibility_policy_id") REFERENCES "engineer_eligibility_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engagement_capability_requirements_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engagement_capability_requirements_cert_definition_id_fkey" FOREIGN KEY ("certification_definition_id") REFERENCES "certification_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "engineer_assignments" (
  "id" TEXT NOT NULL,
  "requirement_id" TEXT NOT NULL,
  "engineer_membership_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "eligibility_snapshot_json" JSONB NOT NULL,
  "eligibility_snapshot_hash" TEXT NOT NULL,
  "assigned_by_assignment_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "engineer_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engineer_assignments_requirement_id_engineer_membership_id_key" UNIQUE ("requirement_id", "engineer_membership_id"),
  CONSTRAINT "engineer_assignments_status_chk" CHECK ("status" IN ('active', 'review_required', 'blocked', 'ended')),
  CONSTRAINT "engineer_assignments_lifecycle_chk" CHECK (("status" = 'active' AND "ended_at" IS NULL) OR ("status" <> 'active' AND "ended_at" IS NOT NULL)),
  CONSTRAINT "engineer_assignments_snapshot_hash_chk" CHECK ("eligibility_snapshot_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "engineer_assignments_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "engagement_capability_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_assignments_engineer_membership_id_fkey" FOREIGN KEY ("engineer_membership_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "engineer_assignments_assigned_by_assignment_id_fkey" FOREIGN KEY ("assigned_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "engineer_certifications"
  ADD CONSTRAINT "engineer_certifications_definition_id_fkey"
    FOREIGN KEY ("definition_id") REFERENCES "certification_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "engineer_certifications_engineer_membership_id_fkey"
    FOREIGN KEY ("engineer_membership_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE INDEX "engineer_certifications_definition_id_idx" ON "engineer_certifications"("definition_id");
CREATE INDEX "engineer_certifications_engineer_membership_id_idx" ON "engineer_certifications"("engineer_membership_id");
CREATE INDEX "certification_definitions_product_family_id_idx" ON "certification_definitions"("product_family_id");
CREATE INDEX "certification_evidence_certification_id_idx" ON "certification_evidence"("certification_id");
CREATE INDEX "certification_evidence_artifact_version_id_idx" ON "certification_evidence"("artifact_version_id");
CREATE INDEX "certification_evidence_verified_by_assignment_id_idx" ON "certification_evidence"("verified_by_assignment_id");
CREATE INDEX "engineer_skills_company_id_engineer_membership_id_idx" ON "engineer_skills"("company_id", "engineer_membership_id");
CREATE INDEX "engineer_skills_product_family_id_idx" ON "engineer_skills"("product_family_id");
CREATE INDEX "engineer_skills_source_artifact_version_id_idx" ON "engineer_skills"("source_artifact_version_id");
CREATE INDEX "engineer_skills_verified_by_assignment_id_idx" ON "engineer_skills"("verified_by_assignment_id");
CREATE INDEX "engineer_eligibility_policies_product_family_id_idx" ON "engineer_eligibility_policies"("product_family_id");
CREATE INDEX "engineer_eligibility_policies_certification_definition_id_idx" ON "engineer_eligibility_policies"("certification_definition_id");
CREATE INDEX "engagement_capability_requirements_engagement_id_idx" ON "engagement_capability_requirements"("engagement_id");
CREATE INDEX "engagement_capability_requirements_eligibility_policy_id_idx" ON "engagement_capability_requirements"("eligibility_policy_id");
CREATE INDEX "engagement_capability_requirements_product_family_id_idx" ON "engagement_capability_requirements"("product_family_id");
CREATE INDEX "engagement_capability_requirements_cert_definition_id_idx" ON "engagement_capability_requirements"("certification_definition_id");
CREATE INDEX "engineer_assignments_engineer_membership_id_idx" ON "engineer_assignments"("engineer_membership_id");
CREATE INDEX "engineer_assignments_assigned_by_assignment_id_idx" ON "engineer_assignments"("assigned_by_assignment_id");

CREATE OR REPLACE FUNCTION public.engineer_certifications_canonical_insert_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  definition_row record;
  membership_row record;
BEGIN
  IF NEW."status" IS DISTINCT FROM 'pending'
     OR NEW."revision" IS DISTINCT FROM 0
     OR NEW."definition_id" IS NULL
     OR NEW."engineer_membership_id" IS NULL
     OR NEW."issuedAt" IS NOT NULL
     OR NEW."expiresAt" IS NOT NULL
     OR NEW."revoked_at" IS NOT NULL
     OR NEW."revocation_reason" IS NOT NULL THEN
    RAISE EXCEPTION 'new EngineerCertification rows must be canonical pending revision 0' USING ERRCODE = '22023';
  END IF;

  SELECT id, company_id, name, level, status INTO definition_row
    FROM certification_definitions WHERE id = NEW."definition_id";
  SELECT id, company_id, user_id, status, valid_from, expires_at, revoked_at INTO membership_row
    FROM user_company_roles WHERE id = NEW."engineer_membership_id";
  IF NOT FOUND OR definition_row.id IS NULL OR membership_row.id IS NULL
     OR definition_row.status <> 'active'
     OR membership_row.status <> 'active'
     OR (membership_row.valid_from IS NOT NULL AND membership_row.valid_from > CURRENT_TIMESTAMP)
     OR (membership_row.expires_at IS NOT NULL AND membership_row.expires_at <= CURRENT_TIMESTAMP)
     OR membership_row.revoked_at IS NOT NULL
     OR definition_row.company_id IS DISTINCT FROM membership_row.company_id
     OR NEW."engineerId" IS DISTINCT FROM membership_row.user_id
     OR NEW."productName" IS DISTINCT FROM definition_row.name
     OR NEW."level" IS DISTINCT FROM definition_row.level THEN
    RAISE EXCEPTION 'EngineerCertification pending identity must be server-derived from active definition and membership' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER engineer_certifications_canonical_insert_guard_trg
BEFORE INSERT ON "engineer_certifications"
FOR EACH ROW EXECUTE FUNCTION public.engineer_certifications_canonical_insert_guard_fn();

CREATE OR REPLACE FUNCTION public.engineer_certifications_lifecycle_update_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  definition_row record;
  membership_row record;
BEGIN
  -- U040's one-time old-NULL bridge is deliberately the only route into legacy_unverified.
  IF OLD."status" IS NULL AND OLD."revision" IS NULL
     AND OLD."definition_id" IS NULL AND OLD."engineer_membership_id" IS NULL
     AND NEW."status" = 'legacy_unverified' AND NEW."revision" = 0
     AND NEW."revoked_at" IS NULL AND NEW."revocation_reason" IS NULL
     AND (to_jsonb(NEW) - ARRAY['definition_id', 'engineer_membership_id', 'status', 'revision', 'updatedAt']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['definition_id', 'engineer_membership_id', 'status', 'revision', 'updatedAt']) THEN
    RAISE EXCEPTION 'legacy certification bridge may change only deterministic scope links and lifecycle marker' USING ERRCODE = '22023';
  ELSIF OLD."status" IS NULL AND OLD."revision" IS NULL
     AND OLD."definition_id" IS NULL AND OLD."engineer_membership_id" IS NULL
     AND NEW."status" = 'legacy_unverified' AND NEW."revision" = 0
     AND NEW."revoked_at" IS NULL AND NEW."revocation_reason" IS NULL THEN
    IF NEW."definition_id" IS NOT NULL THEN
      SELECT id, name, level INTO definition_row FROM certification_definitions WHERE id = NEW."definition_id";
      IF NOT FOUND OR NEW."productName" IS DISTINCT FROM definition_row.name OR NEW."level" IS DISTINCT FROM definition_row.level THEN
        RAISE EXCEPTION 'legacy certification bridge definition is not deterministic' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF NEW."engineer_membership_id" IS NOT NULL THEN
      SELECT id, user_id INTO membership_row FROM user_company_roles WHERE id = NEW."engineer_membership_id";
      IF NOT FOUND OR NEW."engineerId" IS DISTINCT FROM membership_row.user_id THEN
        RAISE EXCEPTION 'legacy certification bridge membership is not deterministic' USING ERRCODE = '22023';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."definition_id" IS DISTINCT FROM OLD."definition_id"
     OR NEW."engineer_membership_id" IS DISTINCT FROM OLD."engineer_membership_id"
     OR NEW."engineerId" IS DISTINCT FROM OLD."engineerId"
     OR NEW."productName" IS DISTINCT FROM OLD."productName"
     OR NEW."level" IS DISTINCT FROM OLD."level"
     OR NEW."isValid" IS DISTINCT FROM OLD."isValid"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'EngineerCertification identity and compatibility fields are immutable' USING ERRCODE = '22023';
  END IF;

  IF OLD."status" = 'pending' AND NEW."status" = 'active'
     AND NEW."revision" = OLD."revision" + 1
     AND NEW."issuedAt" IS NOT NULL
     AND NEW."revoked_at" IS NULL AND NEW."revocation_reason" IS NULL
     AND (to_jsonb(NEW) - ARRAY['status', 'revision', 'issuedAt', 'expiresAt', 'updatedAt']) IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status', 'revision', 'issuedAt', 'expiresAt', 'updatedAt']) THEN
    SELECT validity_days INTO definition_row FROM certification_definitions WHERE id = OLD."definition_id";
    IF NOT FOUND OR NEW."expiresAt" IS DISTINCT FROM (CASE WHEN definition_row.validity_days IS NULL THEN NULL ELSE NEW."issuedAt" + (definition_row.validity_days * INTERVAL '1 day') END) THEN
      RAISE EXCEPTION 'EngineerCertification activation expiry must be definition-derived' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'active' AND NEW."status" = 'revoked'
     AND NEW."revision" = OLD."revision" + 1
     AND NEW."revoked_at" IS NOT NULL AND btrim(NEW."revocation_reason") <> ''
     AND (to_jsonb(NEW) - ARRAY['status', 'revision', 'revoked_at', 'revocation_reason', 'updatedAt']) IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status', 'revision', 'revoked_at', 'revocation_reason', 'updatedAt']) THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'active' AND NEW."status" = 'active'
     AND NEW."revision" = OLD."revision" + 1
     AND (to_jsonb(NEW) - ARRAY['revision', 'updatedAt']) IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['revision', 'updatedAt']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'EngineerCertification update is outside the canonical CAS lifecycle graph' USING ERRCODE = '22023';
END;
$fn$;

CREATE TRIGGER engineer_certifications_lifecycle_update_guard_trg
BEFORE UPDATE ON "engineer_certifications"
FOR EACH ROW EXECUTE FUNCTION public.engineer_certifications_lifecycle_update_guard_fn();

CREATE OR REPLACE FUNCTION public.engineer_certifications_immutable_delete_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'EngineerCertification history is immutable: DELETE is not permitted' USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER engineer_certifications_immutable_delete_trg
BEFORE DELETE ON "engineer_certifications"
FOR EACH ROW EXECUTE FUNCTION public.engineer_certifications_immutable_delete_fn();

CREATE OR REPLACE FUNCTION public.certification_evidence_scope_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  certification_row record;
  subject_membership record;
  verifier_membership record;
  artifact_company_id text;
BEGIN
  SELECT certification.id, certification.status, certification.revision, certification.definition_id,
         certification.engineer_membership_id, definition.company_id, definition.issuer, definition.status AS definition_status
    INTO certification_row
    FROM engineer_certifications AS certification
    JOIN certification_definitions AS definition ON definition.id = certification.definition_id
    WHERE certification.id = NEW.certification_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CertificationEvidence requires a canonical certification definition' USING ERRCODE = '22023';
  END IF;
  SELECT id, company_id, user_id, status, valid_from, expires_at, revoked_at INTO subject_membership
    FROM user_company_roles WHERE id = certification_row.engineer_membership_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CertificationEvidence subject membership is missing' USING ERRCODE = '22023';
  END IF;
  SELECT id, company_id, user_id, status, valid_from, expires_at, revoked_at INTO verifier_membership
    FROM user_company_roles WHERE id = NEW.verified_by_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CertificationEvidence verifier assignment is missing' USING ERRCODE = '22023';
  END IF;
  SELECT artifact.company_id INTO artifact_company_id
    FROM artifact_versions AS version
    JOIN artifacts AS artifact ON artifact.id = version.artifact_id
    WHERE version.id = NEW.artifact_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CertificationEvidence ArtifactVersion has no canonical Artifact company' USING ERRCODE = '22023';
  END IF;

  IF certification_row.definition_status <> 'active'
     OR subject_membership.status <> 'active'
     OR (subject_membership.valid_from IS NOT NULL AND subject_membership.valid_from > CURRENT_TIMESTAMP)
     OR (subject_membership.expires_at IS NOT NULL AND subject_membership.expires_at <= CURRENT_TIMESTAMP)
     OR subject_membership.revoked_at IS NOT NULL
     OR certification_row.company_id IS DISTINCT FROM subject_membership.company_id
     OR certification_row.company_id IS DISTINCT FROM verifier_membership.company_id
     OR certification_row.company_id IS DISTINCT FROM artifact_company_id
     OR NEW.verified_by_assignment_id = certification_row.engineer_membership_id
     OR verifier_membership.user_id = subject_membership.user_id
     OR convert_to(NEW.issuer, 'UTF8') IS DISTINCT FROM convert_to(certification_row.issuer, 'UTF8')
     OR NEW.verified_at > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'CertificationEvidence violates issuer, active membership, self-verification, or company scope guard' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF certification_row.status <> 'pending' OR certification_row.revision <> 0 THEN
      RAISE EXCEPTION 'CertificationEvidence INSERT requires pending canonical certification' USING ERRCODE = '22023';
    END IF;
  ELSIF certification_row.status <> 'active' THEN
    RAISE EXCEPTION 'CertificationEvidence UPDATE requires active canonical certification' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER certification_evidence_scope_guard_trg
BEFORE INSERT OR UPDATE ON "certification_evidence"
FOR EACH ROW EXECUTE FUNCTION public.certification_evidence_scope_guard_fn();

CREATE OR REPLACE FUNCTION public.certification_evidence_immutable_update_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL
     OR (to_jsonb(NEW) - ARRAY['revoked_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revoked_at']) THEN
    RAISE EXCEPTION 'CertificationEvidence only permits one immutable null-to-timestamp revocation transition' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER certification_evidence_immutable_update_guard_trg
BEFORE UPDATE ON "certification_evidence"
FOR EACH ROW EXECUTE FUNCTION public.certification_evidence_immutable_update_guard_fn();

CREATE OR REPLACE FUNCTION public.certification_evidence_immutable_delete_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'CertificationEvidence history is immutable: DELETE is not permitted' USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER certification_evidence_immutable_delete_trg
BEFORE DELETE ON "certification_evidence"
FOR EACH ROW EXECUTE FUNCTION public.certification_evidence_immutable_delete_fn();
