-- U017/ART-01a: immutable Artifact/ArtifactVersion identity schema. Schema only — no legacy
-- backfill (U020), no current-pointer assignment/CAS (U023), no approval/release runtime. Every
-- Artifact row this migration can produce leaves ownership_revision=0, current_version_id=NULL,
-- current_revision=0.
--
-- Content hashing follows RFC 8785 (JSON Canonicalization Scheme, JCS) exclusively. This file
-- installs four immutable PostgreSQL functions that independently reproduce the same canonical
-- text/hash as packages/db/src/canonical-content-hash.ts (the sole JS producer/verifier):
--   sangfor_utf16_units(text)          -> integer[]  (UTF-16 code-unit sequence, used as a sort key)
--   sangfor_jcs_escape_string(text)    -> text        (RFC 8785 string escaping)
--   sangfor_ecma_number_to_string(numeric) -> text     (ECMA-262 Number::toString, radix 10)
--   sangfor_rfc8785_jcs_v1(jsonb)      -> text         (the full recursive canonicalizer)
--   sangfor_sha256_utf8(text)          -> text         (lowercase hex SHA-256 of UTF-8 bytes)
-- These operate on the ALREADY-PARSED jsonb value handed to them. PostgreSQL cannot detect
-- duplicate source object keys once a JSON literal has been converted to jsonb (Postgres itself
-- silently keeps the last occurrence during that conversion, same as JS's JSON.parse) — that
-- detection is exclusively the job of the raw-token scanner in canonical-content-hash.ts, before
-- any row reaches this database. Nothing below claims otherwise, and nothing below populates a
-- current-version pointer or changes an owner.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'artifact_identity migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'artifact_identity migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 1: RFC 8785 JCS canonicalization functions.
-- ─────────────────────────────────────────────────────────────────────────

-- UTF-16 code-unit sequence of a text value, expanding any character above the BMP into its
-- surrogate pair (high = 0xD800 + ((cp-0x10000) >> 10), low = 0xDC00 + ((cp-0x10000) & 0x3FF)).
-- PostgreSQL's own integer[] comparison operators are already lexicographic (element-by-element),
-- so ORDER BY this function's result reproduces RFC 8785's exact "UTF-16 code unit" member-name
-- ordering — including the case a plain codepoint/collation sort gets wrong: an astral character's
-- leading surrogate (0xD800-0xDBFF) sorts BEFORE any BMP character in 0xE000-0xFFFF, even though
-- the astral character's full code point is numerically larger.
CREATE OR REPLACE FUNCTION public.sangfor_utf16_units(s text)
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  units integer[] := '{}';
  i integer;
  cp integer;
  adjusted integer;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..char_length(s) LOOP
    cp := ascii(substr(s, i, 1));
    IF cp > 65535 THEN
      adjusted := cp - 65536;
      units := units || (55296 + (adjusted >> 10));
      units := units || (56320 + (adjusted & 1023));
    ELSE
      units := units || cp;
    END IF;
  END LOOP;
  RETURN units;
END;
$fn$;

-- RFC 8785 §3.2.2.2 string escaping (identical to the ES `JSON.stringify` quote() algorithm):
-- named escapes for backspace/tab/LF/FF/CR/quote/backslash; \u00XX for every other control
-- character (U+0000-U+001F); every other character (including all non-ASCII text) literal.
CREATE OR REPLACE FUNCTION public.sangfor_jcs_escape_string(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  out_text text := '';
  i integer;
  ch text;
  cp integer;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1..char_length(s) LOOP
    ch := substr(s, i, 1);
    cp := ascii(ch);
    IF ch = '"' THEN out_text := out_text || '\"';
    ELSIF ch = '\' THEN out_text := out_text || '\\';
    ELSIF cp = 8 THEN out_text := out_text || '\b';
    ELSIF cp = 9 THEN out_text := out_text || '\t';
    ELSIF cp = 10 THEN out_text := out_text || '\n';
    ELSIF cp = 12 THEN out_text := out_text || '\f';
    ELSIF cp = 13 THEN out_text := out_text || '\r';
    ELSIF cp < 32 THEN out_text := out_text || '\u' || lpad(to_hex(cp), 4, '0');
    ELSE out_text := out_text || ch;
    END IF;
  END LOOP;
  RETURN '"' || out_text || '"';
END;
$fn$;

-- ECMAScript Number::toString(x, 10) (ECMA-262 6.1.6.1.20), applied to the IEEE 754 double
-- nearest the given exact `numeric` value (`::float8` performs that same round-to-nearest-even
-- conversion a JS engine performs when parsing a JSON number token into a Number). PostgreSQL's
-- own float8 output (since PG12, extra_float_digits defaults to 1) already computes the shortest
-- round-trip decimal digit string; this function only re-derives (sign, digits, decimal-point
-- position) from whatever fixed/scientific form PostgreSQL chose to emit, then reformats per the
-- exact spec algorithm, whose three non-scientific branches apply precisely when the decimal-point
-- position n is in the inclusive integer interval [-5, 21] (spec step 5; "n > -6" and "n <= 21"
-- below are the same integer conditions written as strict inequalities).
CREATE OR REPLACE FUNCTION public.sangfor_ecma_number_to_string(v numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_float float8;
  v_is_neg boolean;
  v_text text;
  v_mantissa text;
  v_exp integer := 0;
  v_int_part text;
  v_frac_part text;
  v_raw_digits text;
  v_decpt integer;
  v_lead_zeros integer := 0;
  v_digits text;
  v_k integer;
  v_n integer;
  v_result text;
  v_e_pos integer;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'sangfor_ecma_number_to_string: NULL input';
  END IF;

  v_float := v::float8;

  IF v_float = 'NaN'::float8 OR v_float = 'Infinity'::float8 OR v_float = '-Infinity'::float8 THEN
    RAISE EXCEPTION 'sangfor_ecma_number_to_string: value is not a finite number';
  END IF;

  IF v_float = 0 THEN
    RETURN '0';
  END IF;

  v_is_neg := v_float < 0;
  IF v_is_neg THEN v_float := -v_float; END IF;

  v_text := v_float::text;

  v_e_pos := position('e' in v_text);
  IF v_e_pos = 0 THEN v_e_pos := position('E' in v_text); END IF;
  IF v_e_pos > 0 THEN
    v_mantissa := substring(v_text from 1 for v_e_pos - 1);
    v_exp := substring(v_text from v_e_pos + 1)::integer;
  ELSE
    v_mantissa := v_text;
    v_exp := 0;
  END IF;

  IF position('.' in v_mantissa) > 0 THEN
    v_int_part := split_part(v_mantissa, '.', 1);
    v_frac_part := split_part(v_mantissa, '.', 2);
  ELSE
    v_int_part := v_mantissa;
    v_frac_part := '';
  END IF;

  v_raw_digits := v_int_part || v_frac_part;
  v_decpt := length(v_int_part) + v_exp;

  v_lead_zeros := 0;
  WHILE v_lead_zeros < length(v_raw_digits) - 1 AND substring(v_raw_digits from v_lead_zeros + 1 for 1) = '0' LOOP
    v_lead_zeros := v_lead_zeros + 1;
  END LOOP;
  v_digits := substring(v_raw_digits from v_lead_zeros + 1);
  v_decpt := v_decpt - v_lead_zeros;

  WHILE length(v_digits) > 1 AND substring(v_digits from length(v_digits) for 1) = '0' LOOP
    v_digits := substring(v_digits from 1 for length(v_digits) - 1);
  END LOOP;

  v_k := length(v_digits);
  v_n := v_decpt;

  IF v_k <= v_n AND v_n <= 21 THEN
    v_result := v_digits || repeat('0', v_n - v_k);
  ELSIF v_n > 0 AND v_n <= 21 THEN
    v_result := substring(v_digits from 1 for v_n) || '.' || substring(v_digits from v_n + 1);
  ELSIF v_n > -6 AND v_n <= 0 THEN
    v_result := '0.' || repeat('0', -v_n) || v_digits;
  ELSE
    IF v_k = 1 THEN
      v_result := v_digits;
    ELSE
      v_result := substring(v_digits from 1 for 1) || '.' || substring(v_digits from 2);
    END IF;
    v_result := v_result || 'e' || (CASE WHEN v_n - 1 >= 0 THEN '+' ELSE '-' END) || abs(v_n - 1)::text;
  END IF;

  IF v_is_neg THEN
    v_result := '-' || v_result;
  END IF;

  RETURN v_result;
END;
$fn$;

-- The full RFC 8785 JCS canonicalizer over an already-parsed jsonb value: object member names
-- sorted by sangfor_utf16_units (never locale/collation), numbers via
-- sangfor_ecma_number_to_string, strings via sangfor_jcs_escape_string, no inserted whitespace.
-- Recursive (calls itself for array elements/object member values); PL/pgSQL resolves the
-- self-reference at execution time, so the forward reference in this CREATE FUNCTION's own body
-- is not an ordering problem.
CREATE OR REPLACE FUNCTION public.sangfor_rfc8785_jcs_v1(v jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_type text;
  v_keys text[];
  v_key text;
  v_parts text[];
  v_elem jsonb;
BEGIN
  IF v IS NULL THEN
    RETURN 'null';
  END IF;

  v_type := jsonb_typeof(v);

  IF v_type = 'null' THEN
    RETURN 'null';
  ELSIF v_type = 'boolean' THEN
    RETURN CASE WHEN (v #>> '{}') = 'true' THEN 'true' ELSE 'false' END;
  ELSIF v_type = 'number' THEN
    RETURN public.sangfor_ecma_number_to_string((v #>> '{}')::numeric);
  ELSIF v_type = 'string' THEN
    RETURN public.sangfor_jcs_escape_string(v #>> '{}');
  ELSIF v_type = 'array' THEN
    v_parts := ARRAY[]::text[];
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v) LOOP
      v_parts := v_parts || public.sangfor_rfc8785_jcs_v1(v_elem);
    END LOOP;
    RETURN '[' || array_to_string(v_parts, ',') || ']';
  ELSIF v_type = 'object' THEN
    SELECT array_agg(key ORDER BY public.sangfor_utf16_units(key)) INTO v_keys
    FROM jsonb_object_keys(v) AS key;
    v_parts := ARRAY[]::text[];
    IF v_keys IS NOT NULL THEN
      FOREACH v_key IN ARRAY v_keys LOOP
        v_parts := v_parts || (public.sangfor_jcs_escape_string(v_key) || ':' || public.sangfor_rfc8785_jcs_v1(v -> v_key));
      END LOOP;
    END IF;
    RETURN '{' || array_to_string(v_parts, ',') || '}';
  ELSE
    RAISE EXCEPTION 'sangfor_rfc8785_jcs_v1: unsupported jsonb type %', v_type;
  END IF;
END;
$fn$;

-- Lowercase hex SHA-256 of the UTF-8 bytes of a canonical text (pgcrypto's digest(), already
-- installed by migration 20260715110000).
CREATE OR REPLACE FUNCTION public.sangfor_sha256_utf8(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT encode(public.digest(convert_to(t, 'UTF8'), 'sha256'), 'hex');
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2: tables (Prisma-managed shape — generated via `prisma migrate diff` against this exact
-- schema.prisma and copied verbatim so it stays byte-identical to what a fresh `prisma migrate
-- dev` would produce for these two models; the custom functions/triggers/CHECK constraints below
-- are additive and outside Prisma's DSL, same pattern as every sibling migration in this campaign).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_by_assignment_id" TEXT NOT NULL,
    "owner_assignment_id" TEXT NOT NULL,
    "ownership_revision" INTEGER NOT NULL DEFAULT 0,
    "current_version_id" TEXT,
    "current_revision" INTEGER NOT NULL DEFAULT 0,
    "legacy_source_type" TEXT,
    "legacy_source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artifact_versions" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash_version" TEXT NOT NULL,
    "canonical_content_envelope" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content_json" JSONB NOT NULL,
    "sanitized_text" TEXT,
    "status" TEXT NOT NULL,
    "created_by_assignment_id" TEXT NOT NULL,
    "legacy_source_type" TEXT,
    "legacy_source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artifacts_current_version_id_key" ON "artifacts"("current_version_id");
CREATE INDEX "artifacts_company_id_project_id_artifact_type_idx" ON "artifacts"("company_id", "project_id", "artifact_type");
CREATE UNIQUE INDEX "artifacts_legacy_source_key" ON "artifacts"("legacy_source_type", "legacy_source_id");

CREATE INDEX "artifact_versions_artifact_id_version_idx" ON "artifact_versions"("artifact_id", "version");
CREATE UNIQUE INDEX "artifact_versions_artifact_id_version_key" ON "artifact_versions"("artifact_id", "version");
CREATE UNIQUE INDEX "artifact_versions_content_hash_key" ON "artifact_versions"("artifact_id", "content_hash_version", "content_hash");
CREATE UNIQUE INDEX "artifact_versions_legacy_source_key" ON "artifact_versions"("legacy_source_type", "legacy_source_id");

ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Composite FKs: company_id must actually belong to tenant_id (companies_tenant_id_id_key from
-- U012), and project_id must actually belong to company_id (projects_company_id_id_key from
-- U012) — same pattern as auth_sessions (migration 20260715140000).
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Distinct exact U012 composite assignment FKs (user_company_roles_id_company_id_key from U012)
-- — never an ID-only assignment FK: a created_by/owner_assignment_id that names a real
-- user_company_roles.id belonging to a DIFFERENT company is rejected by Postgres itself.
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_assignment_id_fkey" FOREIGN KEY ("created_by_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_owner_assignment_id_fkey" FOREIGN KEY ("owner_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3: CHECK constraints (state invariants; no OLD/NEW transition logic — see the triggers in
-- Step 4 for the invariants that require comparing OLD and NEW).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_classification_check" CHECK (classification IN ('public', 'internal', 'confidential', 'restricted'));
-- origin vocabulary is a U017 judgment call — see the schema.prisma doc comment on model Artifact.
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_origin_check" CHECK (origin IN ('human', 'ai', 'legacy_import'));
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_ownership_revision_check" CHECK (ownership_revision >= 0);
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_current_revision_check" CHECK (current_revision >= 0);
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_pointer_revision_coupling_check" CHECK (
  (current_version_id IS NULL AND current_revision = 0)
  OR (current_version_id IS NOT NULL AND current_revision > 0)
);

ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_content_hash_version_check" CHECK (content_hash_version = 'artifact-content/rfc8785-jcs-sha256/v1');
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_content_hash_format_check" CHECK (content_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_version_positive_check" CHECK (version > 0);
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_status_check" CHECK (status IN ('ai_draft', 'human_draft', 'review_ready', 'superseded', 'legacy_unreviewed'));

-- ─────────────────────────────────────────────────────────────────────────
-- Step 4: triggers.
-- ─────────────────────────────────────────────────────────────────────────

-- artifacts: (a) created_by_assignment_id is immutable; (b) owner_assignment_id may only change
-- together with ownership_revision incrementing by exactly 1 (the U059 CAS contract), and
-- ownership_revision may never change without owner_assignment_id also changing; (c) whenever
-- current_version_id is non-NULL it must belong to THIS artifact (the "same-Artifact pointer"
-- constraint) — this migration never sets it, but U023 will, so the check runs on every
-- INSERT/UPDATE, not only at CAS time.
CREATE OR REPLACE FUNCTION public.sangfor_artifacts_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_pointer_owner_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.created_by_assignment_id IS DISTINCT FROM OLD.created_by_assignment_id THEN
      RAISE EXCEPTION 'artifacts.created_by_assignment_id is immutable (old=%, new=%)', OLD.created_by_assignment_id, NEW.created_by_assignment_id
        USING ERRCODE = '22023';
    END IF;

    IF NEW.owner_assignment_id IS DISTINCT FROM OLD.owner_assignment_id THEN
      IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision + 1 THEN
        RAISE EXCEPTION 'artifacts: owner_assignment_id change must increment ownership_revision by exactly 1 (old_revision=%, new_revision=%)', OLD.ownership_revision, NEW.ownership_revision
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
      RAISE EXCEPTION 'artifacts: ownership_revision changed without a corresponding owner_assignment_id change'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.current_version_id IS NOT NULL THEN
    SELECT artifact_id INTO v_pointer_owner_id FROM artifact_versions WHERE id = NEW.current_version_id;
    IF v_pointer_owner_id IS NULL THEN
      RAISE EXCEPTION 'artifacts.current_version_id % does not reference an existing artifact_versions row', NEW.current_version_id
        USING ERRCODE = '23503';
    END IF;
    IF v_pointer_owner_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'artifacts.current_version_id % belongs to artifact % , not this row (%)', NEW.current_version_id, v_pointer_owner_id, NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_artifacts_guard_trg
BEFORE INSERT OR UPDATE ON artifacts
FOR EACH ROW EXECUTE FUNCTION public.sangfor_artifacts_guard();

-- artifact_versions named insert guard: created_by_assignment_id must be a real user_company_roles
-- row belonging to the SAME company as the parent artifact (joined via artifact_id ->
-- artifacts.company_id) — the "no redundant companyId column" contract from the U017 dispatch.
CREATE OR REPLACE FUNCTION public.sangfor_artifact_version_creator_company_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_artifact_company_id text;
  v_assignment_ok boolean;
BEGIN
  SELECT company_id INTO v_artifact_company_id FROM artifacts WHERE id = NEW.artifact_id;
  IF v_artifact_company_id IS NULL THEN
    RAISE EXCEPTION 'artifact_versions: artifact_id % does not reference an existing artifacts row', NEW.artifact_id
      USING ERRCODE = '23503';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_company_roles
    WHERE id = NEW.created_by_assignment_id AND company_id = v_artifact_company_id
  ) INTO v_assignment_ok;
  IF NOT v_assignment_ok THEN
    RAISE EXCEPTION 'artifact_versions: created_by_assignment_id % is not a business-role assignment in the parent artifact''s own company %', NEW.created_by_assignment_id, v_artifact_company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_artifact_versions_creator_company_guard_trg
BEFORE INSERT ON artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_artifact_version_creator_company_guard();

-- artifact_versions content guard: reconstructs the exact envelope from the already-parsed I-JSON
-- content_json, requires BYTE equality with the application-supplied canonical_content_envelope,
-- fixes the version literal (redundant with the CHECK above, defense in depth against a future
-- CHECK removal), and verifies content_hash = sha256_utf8(canonical_content_envelope). This
-- function does NOT and cannot detect duplicate source object keys — jsonb has already collapsed
-- them by the time content_json exists as a value; that detection is exclusively
-- canonical-content-hash.ts's job, upstream of any INSERT.
CREATE OR REPLACE FUNCTION public.sangfor_artifact_version_content_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_envelope_value jsonb;
  v_recomputed_envelope text;
  v_recomputed_hash text;
BEGIN
  IF NEW.content_hash_version IS DISTINCT FROM 'artifact-content/rfc8785-jcs-sha256/v1' THEN
    RAISE EXCEPTION 'artifact_versions: content_hash_version must be exactly artifact-content/rfc8785-jcs-sha256/v1, got %', NEW.content_hash_version
      USING ERRCODE = '22023';
  END IF;

  v_envelope_value := jsonb_build_object('contract', 'sangfor.artifact-content', 'payload', NEW.content_json, 'version', 1);
  v_recomputed_envelope := public.sangfor_rfc8785_jcs_v1(v_envelope_value);

  IF NEW.canonical_content_envelope IS DISTINCT FROM v_recomputed_envelope THEN
    RAISE EXCEPTION 'artifact_versions: canonical_content_envelope does not byte-match the RFC 8785 JCS reconstruction of content_json'
      USING ERRCODE = '22023';
  END IF;

  v_recomputed_hash := public.sangfor_sha256_utf8(NEW.canonical_content_envelope);
  IF NEW.content_hash IS DISTINCT FROM v_recomputed_hash THEN
    RAISE EXCEPTION 'artifact_versions: content_hash does not equal sha256(canonical_content_envelope)'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_artifact_version_content_guard_trg
BEFORE INSERT ON artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_artifact_version_content_guard();

-- Append-only: artifact_versions denies every UPDATE and DELETE outright.
CREATE OR REPLACE FUNCTION public.sangfor_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted on %', TG_TABLE_NAME, TG_OP, TG_TABLE_NAME
    USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER sangfor_artifact_versions_deny_update_trg
BEFORE UPDATE ON artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();

CREATE TRIGGER sangfor_artifact_versions_deny_delete_trg
BEFORE DELETE ON artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();
