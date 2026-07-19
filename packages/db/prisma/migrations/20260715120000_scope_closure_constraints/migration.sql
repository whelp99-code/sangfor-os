-- U012: validate U011 scope-backfill closure and add non-destructive composite
-- keys/FKs/checks so a new or changed row cannot reintroduce an unscoped or
-- cross-hierarchy root. Every DDL statement below is additive (expand/validate):
-- no DROP, no type narrowing, no cascade added solely for cleanup.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'scope_closure_constraints migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'scope_closure_constraints migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- Step 1: lock and verify the exact U011 control key ("__ScopeBackfillControl","scope-closure/v1")
-- BEFORE any constraint validation or SET NOT NULL below. This re-implements, in raw SQL (a
-- migration cannot call into TypeScript), the same contract packages/db/src/scope-closure.ts's
-- verifyControlRow enforces against a live database. Missing, malformed, hand-inserted, stale, or
-- tampered control state raises here, before any further DDL runs.
DO $$
DECLARE
  v_control RECORD;
  v_mode text;
  v_expected_reason_code text;
  v_review_digest text;
  v_source_facts_digest text;
  v_recomputed_hash text;
  v_recomputed_review_digest text;
  v_projected_json jsonb;
  v_resolution jsonb;
  v_conservation jsonb;
  v_before bigint;
  v_live_after bigint;
  v_extracted bigint;
  v_projects_count bigint;
  v_rcr_count bigint;
BEGIN
  SELECT * INTO v_control
  FROM scope_backfill_quarantine
  WHERE source_model = '__ScopeBackfillControl' AND source_id = 'scope-closure/v1'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scope_closure: missing U011 control row at (__ScopeBackfillControl, scope-closure/v1)';
  END IF;

  IF v_control.id NOT IN ('scope-backfill-control-reviewed-apply', 'scope-backfill-control-empty-database') THEN
    RAISE EXCEPTION 'scope_closure: control row id "%" is not a known U011 apply id (hand-inserted control row)', v_control.id;
  END IF;

  IF v_control.source_row_json IS NULL
     OR (v_control.source_row_json->>'schemaVersion') IS DISTINCT FROM '1'
     OR (v_control.source_row_json->>'kind') IS DISTINCT FROM 'scope-backfill-control'
     OR (v_control.source_row_json->>'mode') NOT IN ('reviewed_apply', 'empty_database')
     OR (v_control.source_row_json->>'reviewDigest') IS NULL
     OR (v_control.source_row_json->>'sourceFactsDigest') IS NULL
     OR (v_control.source_row_json->'counts') IS NULL
  THEN
    RAISE EXCEPTION 'scope_closure: control row sourceRowJson is malformed: %', v_control.source_row_json;
  END IF;

  v_mode := v_control.source_row_json->>'mode';
  v_review_digest := v_control.source_row_json->>'reviewDigest';
  v_source_facts_digest := v_control.source_row_json->>'sourceFactsDigest';
  v_expected_reason_code := CASE v_mode WHEN 'reviewed_apply' THEN 'scope_backfill_reviewed_apply' ELSE 'scope_backfill_empty_database' END;

  IF v_control.reason_code IS DISTINCT FROM v_expected_reason_code THEN
    RAISE EXCEPTION 'scope_closure: control row reasonCode "%" does not match sourceRowJson.mode "%"', v_control.reason_code, v_mode;
  END IF;

  IF v_review_digest !~ '^[0-9a-f]{64}$' OR v_source_facts_digest !~ '^[0-9a-f]{64}$' OR v_control.source_row_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'scope_closure: control row digest fields are not 64 lowercase hex (reviewDigest=%, sourceFactsDigest=%, sourceRowHash=%)', v_review_digest, v_source_facts_digest, v_control.source_row_hash;
  END IF;

  v_recomputed_hash := encode(public.digest(pg_catalog.convert_to((v_control.source_row_json)::text,'UTF8'),'sha256'),'hex');
  IF v_recomputed_hash IS DISTINCT FROM v_control.source_row_hash THEN
    RAISE EXCEPTION 'scope_closure: recomputed sourceRowHash % does not equal stored % (tampered/stale control row)', v_recomputed_hash, v_control.source_row_hash;
  END IF;

  IF v_control.review_digest IS DISTINCT FROM v_review_digest THEN
    RAISE EXCEPTION 'scope_closure: control row review_digest column disagrees with sourceRowJson.reviewDigest';
  END IF;

  IF v_control.resolved_at IS NULL OR v_control.resolved_by IS NULL OR btrim(v_control.resolved_by) = '' THEN
    RAISE EXCEPTION 'scope_closure: control row is missing resolvedAt/resolvedBy provenance';
  END IF;

  v_resolution := v_control.resolution_json;
  IF v_resolution IS NULL
     OR (v_resolution->>'applyState') IS DISTINCT FROM 'completed'
     OR (v_resolution->>'reviewDigest') IS DISTINCT FROM v_review_digest
     OR (v_resolution->>'sourceFactsDigest') IS DISTINCT FROM v_source_facts_digest
     OR (v_resolution->>'sourceRowHash') IS DISTINCT FROM v_control.source_row_hash
     OR (v_resolution->'conservation') IS NULL
  THEN
    RAISE EXCEPTION 'scope_closure: control row resolutionJson is missing fields or disagrees with sourceRowJson/sourceRowHash: %', v_resolution;
  END IF;

  v_conservation := v_resolution->'conservation';
  v_before := (v_conservation->>'before')::bigint;
  v_live_after := (v_conservation->>'liveAfter')::bigint;
  v_extracted := (v_conservation->>'extracted')::bigint;
  IF v_before IS NULL OR v_live_after IS NULL OR v_extracted IS NULL OR v_before <> v_live_after + v_extracted THEN
    RAISE EXCEPTION 'scope_closure: control row conservation before=% liveAfter=% extracted=% violates before=liveAfter+extracted', v_before, v_live_after, v_extracted;
  END IF;

  SELECT count(*) INTO v_projects_count FROM projects;
  SELECT count(*) INTO v_rcr_count FROM role_change_requests;

  IF v_mode = 'empty_database' THEN
    IF v_projects_count <> 0 OR v_rcr_count <> 0 THEN
      RAISE EXCEPTION 'scope_closure: empty_database control row present but projects=% role_change_requests=% (both must be physically empty)', v_projects_count, v_rcr_count;
    END IF;
    IF v_control.candidate_scope_json IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'scope_closure: empty_database candidateScopeJson must be an empty array (converting an empty sentinel into a reviewed sentinel is forbidden)';
    END IF;
  ELSIF v_mode = 'reviewed_apply' THEN
    IF v_control.candidate_scope_json IS NULL OR jsonb_typeof(v_control.candidate_scope_json) <> 'array' THEN
      RAISE EXCEPTION 'scope_closure: reviewed_apply candidateScopeJson must be a JSON array of manifest entries';
    END IF;

    -- Recompute reviewDigest from candidateScopeJson using the exact projection
    -- manifestFactsProjection()/computeManifestDigest() apply at apply time (see
    -- packages/db/src/scope-backfill.ts): keep only sourceModel/sourceId/sourceRowHash/
    -- sourceFactsDigest/classification/candidateCompanyIds (dedup+sorted), sort entries by
    -- sourceId. jsonb::text is Postgres's canonical key-order-independent serialization, so the
    -- key order used in jsonb_build_object below does not affect the digest.
    SELECT COALESCE(jsonb_agg(proj.obj ORDER BY proj.sort_key), '[]'::jsonb)
    INTO v_projected_json
    FROM (
      SELECT
        jsonb_build_object(
          'sourceModel', e->>'sourceModel',
          'sourceId', e->>'sourceId',
          'sourceRowHash', e->>'sourceRowHash',
          'sourceFactsDigest', e->>'sourceFactsDigest',
          'classification', e->>'classification',
          'candidateCompanyIds', COALESCE((
            SELECT jsonb_agg(ids.x ORDER BY ids.x)
            FROM (SELECT DISTINCT jsonb_array_elements_text(e->'candidateCompanyIds') AS x) ids
          ), '[]'::jsonb)
        ) AS obj,
        (e->>'sourceId') AS sort_key
      FROM jsonb_array_elements(v_control.candidate_scope_json) AS e
    ) proj;

    v_recomputed_review_digest := encode(public.digest(pg_catalog.convert_to((v_projected_json)::text,'UTF8'),'sha256'),'hex');
    IF v_recomputed_review_digest IS DISTINCT FROM v_review_digest THEN
      RAISE EXCEPTION 'scope_closure: recomputed reviewDigest % over candidateScopeJson does not equal sourceRowJson.reviewDigest % (tampered Project source-facts / candidateScopeJson)', v_recomputed_review_digest, v_review_digest;
    END IF;
  END IF;
END $$;

-- Step 2: additive composite uniqueness backing later scoped-assignment FKs
-- (U017-U019, U024 consume these as fields:[<assignmentId>,companyId] references:[id,companyId]).
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_id_key" UNIQUE ("company_id", "id");
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_id_company_id_key" UNIQUE ("id", "company_id");

-- Step 3: RoleChangeRequest closure gate (zero live nulls, zero stale quarantine overlap) before
-- tightening, then SET NOT NULL. The validated named FK role_change_requests_company_id_fkey ->
-- companies(id) already exists from migration 20260715110000 (U011, not edited here); the
-- defensive check below only confirms it is present and convalidated.
DO $$
DECLARE
  v_live_null bigint;
  v_stale_overlap bigint;
BEGIN
  SELECT count(*) INTO v_live_null FROM role_change_requests WHERE company_id IS NULL;
  IF v_live_null <> 0 THEN
    RAISE EXCEPTION 'scope_closure: % live role_change_requests row(s) still have company_id IS NULL; U011 extraction/backfill must resolve them before SET NOT NULL', v_live_null;
  END IF;

  SELECT count(*) INTO v_stale_overlap
  FROM scope_backfill_quarantine q
  JOIN role_change_requests r ON r.id = q.source_id
  WHERE q.source_model = 'RoleChangeRequest';
  IF v_stale_overlap <> 0 THEN
    RAISE EXCEPTION 'scope_closure: % scope_backfill_quarantine row(s) for RoleChangeRequest reference a source_id that is still a live role_change_requests row (stale quarantine)', v_stale_overlap;
  END IF;
END $$;

ALTER TABLE "role_change_requests" ALTER COLUMN "company_id" SET NOT NULL;

DO $$
DECLARE
  v_valid boolean;
BEGIN
  SELECT convalidated INTO v_valid
  FROM pg_constraint
  WHERE conname = 'role_change_requests_company_id_fkey' AND contype = 'f';
  IF v_valid IS NULL OR v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'scope_closure: role_change_requests_company_id_fkey is missing or not validated';
  END IF;
END $$;

-- Step 4: Project.companyId stays Prisma-optional until U073 (a live legacy-null row can be a
-- genuine pending U011 quarantine decision, not a defect), but the DB forbids NEW unscoped
-- writes: a row created before this migration's watermark is grandfathered; any row created at or
-- after it must carry a company_id. This CHECK validates immediately (true for every existing row
-- by construction) — it is not an unvalidated placeholder. Prisma-level optionality is therefore
-- an ORM convenience, not the closure guarantee; this DB check is the guarantee for new writes.
DO $$
DECLARE
  v_watermark timestamptz := clock_timestamp();
BEGIN
  EXECUTE format(
    'ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_required_for_new_rows_check" CHECK (company_id IS NOT NULL OR created_at < %L)',
    v_watermark
  );
END $$;
