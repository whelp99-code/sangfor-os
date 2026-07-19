-- U011: reviewed, idempotent scope backfill with ambiguity quarantine.
-- Additive only: new scope_backfill_quarantine table, nullable role_change_requests.company_id
-- bridge (mirrors U010's Project -> Company bridge; correlation-only, not scope authority until
-- the reviewed backfill assigns it). No changes to existing columns/rows on any other table.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'scope_backfill_quarantine migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'scope_backfill_quarantine migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- AlterTable
ALTER TABLE "role_change_requests" ADD COLUMN     "company_id" TEXT;

CREATE INDEX "role_change_requests_company_id_idx" ON "role_change_requests"("company_id");

ALTER TABLE "role_change_requests" ADD CONSTRAINT "role_change_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "scope_backfill_quarantine" (
    "id" TEXT NOT NULL,
    "source_model" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "source_row_json" JSONB NOT NULL,
    "source_row_hash" TEXT NOT NULL,
    "candidate_scope_json" JSONB NOT NULL,
    "review_digest" TEXT,
    "quarantined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_json" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_backfill_quarantine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scope_backfill_quarantine_source_model_source_id_key" ON "scope_backfill_quarantine"("source_model", "source_id");

-- Empty-database migration sentinel (dispatch: exactly this key/reasonCode/mode only when
-- BOTH projects and role_change_requests are physically empty in this migration transaction; a
-- non-empty source set receives no control row here and must run the reviewed apply instead).
DO $$
DECLARE
  v_projects_count bigint;
  v_rcr_count bigint;
  v_source_facts_json text;
  v_empty_manifest_json text;
  v_source_facts_digest text;
  v_review_digest text;
  v_source_row_json jsonb;
  v_source_row_hash text;
BEGIN
  SELECT count(*) INTO v_projects_count FROM "projects";
  SELECT count(*) INTO v_rcr_count FROM "role_change_requests";

  IF v_projects_count = 0 AND v_rcr_count = 0 THEN
    v_source_facts_json := '{"schemaVersion":1,"sourceModel":"__ScopeBackfillSourceFacts","projects":0,"roleChangeRequests":0}';
    v_source_facts_digest := encode(public.digest(pg_catalog.convert_to((v_source_facts_json::jsonb)::text,'UTF8'),'sha256'),'hex');

    v_empty_manifest_json := '[]';
    v_review_digest := encode(public.digest(pg_catalog.convert_to((v_empty_manifest_json::jsonb)::text,'UTF8'),'sha256'),'hex');

    v_source_row_json := jsonb_build_object(
      'schemaVersion', 1,
      'kind', 'scope-backfill-control',
      'mode', 'empty_database',
      'reviewDigest', v_review_digest,
      'sourceFactsDigest', v_source_facts_digest,
      'counts', jsonb_build_object('source', 0, 'resolved', 0, 'extracted', 0, 'quarantined', 0, 'alreadyScoped', 0)
    );
    v_source_row_hash := encode(public.digest(pg_catalog.convert_to((v_source_row_json)::text,'UTF8'),'sha256'),'hex');

    INSERT INTO "scope_backfill_quarantine" (
      "id","source_model","source_id","reason_code","source_row_json","source_row_hash",
      "candidate_scope_json","review_digest","quarantined_at","resolved_at","resolved_by",
      "resolution_json","first_seen_at","last_seen_at"
    ) VALUES (
      'scope-backfill-control-empty-database',
      '__ScopeBackfillControl',
      'scope-closure/v1',
      'scope_backfill_empty_database',
      v_source_row_json,
      v_source_row_hash,
      v_empty_manifest_json::jsonb,
      v_review_digest,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      'migration:20260715110000_scope_backfill_quarantine',
      jsonb_build_object(
        'schemaVersion', 1,
        'applyState', 'completed',
        'reviewDigest', v_review_digest,
        'sourceFactsDigest', v_source_facts_digest,
        'sourceRowHash', v_source_row_hash,
        'conservation', jsonb_build_object('before', 0, 'liveAfter', 0, 'extracted', 0),
        'changedCount', 0
      ),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
  END IF;
END $$;
