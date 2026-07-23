-- U042 / GOV-01.  Append-only governance evidence and canonical activation branches.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

ALTER TABLE "data_export_requests"
  ADD COLUMN "canonical_activated_at" TIMESTAMP(3),
  ADD COLUMN "company_id" TEXT,
  ADD COLUMN "artifact_version_id" TEXT,
  ADD COLUMN "artifact_content_hash" TEXT,
  ADD COLUMN "classification" TEXT,
  ADD COLUMN "format" TEXT,
  ADD COLUMN "requested_by_assignment_id" TEXT,
  ADD COLUMN "approval_request_id" TEXT,
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "canonical_status" TEXT,
  ADD COLUMN "issued_at" TIMESTAMP(3),
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "request_input_hash" TEXT,
  ADD COLUMN "audit_log_id" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "artifact_access_events"
  ADD COLUMN "canonical_activated_at" TIMESTAMP(3),
  ADD COLUMN "company_id" TEXT,
  ADD COLUMN "artifact_version_id" TEXT,
  ADD COLUMN "actor_assignment_id" TEXT,
  ADD COLUMN "canonical_access_type" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "policy_result" TEXT,
  ADD COLUMN "watermark_applied" BOOLEAN,
  ADD COLUMN "redaction_applied" BOOLEAN,
  ADD COLUMN "request_metadata" JSONB,
  ADD COLUMN "denial_reason" TEXT,
  ADD COLUMN "canonical_created_at" TIMESTAMP(3);

-- Preserve and prove every old row before relaxing any legacy physical column. U017's JCS
-- implementation is the one canonicalizer for both the source snapshot and the review digest.
INSERT INTO "scope_backfill_quarantine" ("id","source_model","source_id","reason_code","source_row_json","source_row_hash","candidate_scope_json","review_digest")
SELECT 'u042-export-' || d.id, 'DataExportRequest', d.id, 'governance_legacy_unresolved',
  jsonb_build_object('id',d.id,'artifact_id',d.artifact_id,'requested_by',d.requested_by,'reason',d.reason,'status',d.status,'approved_by',d.approved_by),
  public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(jsonb_build_object('id',d.id,'artifact_id',d.artifact_id,'requested_by',d.requested_by,'reason',d.reason,'status',d.status,'approved_by',d.approved_by))),
  jsonb_build_object('schemaVersion','governance-legacy-quarantine/v1','sourceModel','DataExportRequest','sourceId',d.id,'legacyRowSnapshot',jsonb_build_object('id',d.id,'artifact_id',d.artifact_id,'requested_by',d.requested_by,'reason',d.reason,'status',d.status,'approved_by',d.approved_by),'candidateArtifactVersionIds',jsonb_build_array(),'candidateAssignmentIds',jsonb_build_array()),
  public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(jsonb_build_object('schemaVersion','governance-legacy-quarantine/v1','sourceModel','DataExportRequest','sourceId',d.id,'legacyRowSnapshot',jsonb_build_object('id',d.id,'artifact_id',d.artifact_id,'requested_by',d.requested_by,'reason',d.reason,'status',d.status,'approved_by',d.approved_by),'candidateArtifactVersionIds',jsonb_build_array(),'candidateAssignmentIds',jsonb_build_array())))
FROM "data_export_requests" d
ON CONFLICT ("source_model","source_id") DO UPDATE SET
  "reason_code" = EXCLUDED."reason_code",
  "source_row_json" = EXCLUDED."source_row_json",
  "source_row_hash" = EXCLUDED."source_row_hash",
  "candidate_scope_json" = EXCLUDED."candidate_scope_json",
  "review_digest" = EXCLUDED."review_digest",
  "resolved_at" = NULL,
  "resolved_by" = NULL,
  "resolution_json" = NULL,
  "last_seen_at" = CURRENT_TIMESTAMP;
INSERT INTO "scope_backfill_quarantine" ("id","source_model","source_id","reason_code","source_row_json","source_row_hash","candidate_scope_json","review_digest")
SELECT 'u042-access-' || a.id, 'ArtifactAccessEvent', a.id, 'governance_legacy_unresolved',
  jsonb_build_object('id',a.id,'artifact_id',a.artifact_id,'user_id',a.user_id,'access_type',a.access_type,'timestamp',a."timestamp"),
  public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(jsonb_build_object('id',a.id,'artifact_id',a.artifact_id,'user_id',a.user_id,'access_type',a.access_type,'timestamp',a."timestamp"))),
  jsonb_build_object('schemaVersion','governance-legacy-quarantine/v1','sourceModel','ArtifactAccessEvent','sourceId',a.id,'legacyRowSnapshot',jsonb_build_object('id',a.id,'artifact_id',a.artifact_id,'user_id',a.user_id,'access_type',a.access_type,'timestamp',a."timestamp"),'candidateArtifactVersionIds',jsonb_build_array(),'candidateAssignmentIds',jsonb_build_array()),
  public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(jsonb_build_object('schemaVersion','governance-legacy-quarantine/v1','sourceModel','ArtifactAccessEvent','sourceId',a.id,'legacyRowSnapshot',jsonb_build_object('id',a.id,'artifact_id',a.artifact_id,'user_id',a.user_id,'access_type',a.access_type,'timestamp',a."timestamp"),'candidateArtifactVersionIds',jsonb_build_array(),'candidateAssignmentIds',jsonb_build_array())))
FROM "artifact_access_events" a
ON CONFLICT ("source_model","source_id") DO UPDATE SET
  "reason_code" = EXCLUDED."reason_code",
  "source_row_json" = EXCLUDED."source_row_json",
  "source_row_hash" = EXCLUDED."source_row_hash",
  "candidate_scope_json" = EXCLUDED."candidate_scope_json",
  "review_digest" = EXCLUDED."review_digest",
  "resolved_at" = NULL,
  "resolved_by" = NULL,
  "resolution_json" = NULL,
  "last_seen_at" = CURRENT_TIMESTAMP;

DO $$
DECLARE
  v_source_count bigint;
  v_receipt_count bigint;
  v_mismatch_count bigint;
BEGIN
  SELECT (SELECT count(*) FROM "data_export_requests") + (SELECT count(*) FROM "artifact_access_events")
  INTO v_source_count;
  SELECT count(*) INTO v_receipt_count
  FROM "scope_backfill_quarantine"
  WHERE "source_model" IN ('DataExportRequest','ArtifactAccessEvent');
  IF v_source_count <> v_receipt_count THEN
    RAISE EXCEPTION 'U042 legacy quarantine count mismatch: source=%, receipt=%', v_source_count, v_receipt_count;
  END IF;

  SELECT count(*) INTO v_mismatch_count
  FROM "scope_backfill_quarantine" q
  WHERE q."source_model" IN ('DataExportRequest','ArtifactAccessEvent')
    AND (
      q."reason_code" <> 'governance_legacy_unresolved'
      OR q."resolution_json" IS NOT NULL
      OR q."source_row_hash" IS DISTINCT FROM public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(q."source_row_json"))
      OR q."review_digest" IS DISTINCT FROM public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(q."candidate_scope_json"))
      OR q."candidate_scope_json"->>'schemaVersion' <> 'governance-legacy-quarantine/v1'
      OR q."candidate_scope_json"->>'sourceModel' <> q."source_model"
      OR q."candidate_scope_json"->>'sourceId' <> q."source_id"
      OR q."candidate_scope_json"->'legacyRowSnapshot' IS DISTINCT FROM q."source_row_json"
      OR q."candidate_scope_json"->'candidateArtifactVersionIds' <> '[]'::jsonb
      OR q."candidate_scope_json"->'candidateAssignmentIds' <> '[]'::jsonb
    );
  IF v_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'U042 legacy quarantine byte re-read failed for % row(s)', v_mismatch_count;
  END IF;
END $$;

ALTER TABLE "data_export_requests"
  ALTER COLUMN "artifact_id" DROP NOT NULL,
  ALTER COLUMN "requested_by" DROP NOT NULL,
  ALTER COLUMN "reason" DROP NOT NULL,
  ALTER COLUMN "status" DROP NOT NULL,
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "artifact_access_events"
  ALTER COLUMN "artifact_id" DROP NOT NULL,
  ALTER COLUMN "user_id" DROP NOT NULL,
  ALTER COLUMN "access_type" DROP NOT NULL,
  ALTER COLUMN "timestamp" DROP NOT NULL,
  ALTER COLUMN "timestamp" DROP DEFAULT;

ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_canonical_activation_chk" CHECK (
  ("canonical_activated_at" IS NULL AND "company_id" IS NULL AND "artifact_version_id" IS NULL AND "artifact_content_hash" IS NULL AND "classification" IS NULL AND "format" IS NULL AND "requested_by_assignment_id" IS NULL AND "approval_request_id" IS NULL AND "purpose" IS NULL AND "canonical_status" IS NULL AND "issued_at" IS NULL AND "expires_at" IS NULL AND "completed_at" IS NULL AND "idempotency_key" IS NULL AND "request_input_hash" IS NULL AND "audit_log_id" IS NULL)
  OR ("canonical_activated_at" IS NOT NULL AND "artifact_id" IS NULL AND "requested_by" IS NULL AND "reason" IS NULL AND "status" IS NULL AND "approved_by" IS NULL AND "company_id" IS NOT NULL AND "artifact_content_hash" IS NOT NULL AND "classification" IS NOT NULL AND "format" = 'json' AND "requested_by_assignment_id" IS NOT NULL AND "purpose" IS NOT NULL AND "canonical_status" IS NOT NULL AND "issued_at" IS NOT NULL AND "expires_at" IS NOT NULL AND "idempotency_key" IS NOT NULL AND "request_input_hash" IS NOT NULL AND "audit_log_id" IS NOT NULL)
);
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_canonical_values_chk" CHECK (
  "canonical_activated_at" IS NULL OR (
    "classification" IN ('public','internal','confidential','restricted')
    AND "canonical_status" IN ('issued','consumed','expired','revoked')
    AND "request_input_hash" ~ '^[0-9a-f]{64}$'
    AND char_length("purpose") BETWEEN 1 AND 512
    AND char_length("idempotency_key") BETWEEN 1 AND 128
    AND btrim("idempotency_key") = "idempotency_key"
  )
);
ALTER TABLE "artifact_access_events" ADD CONSTRAINT "artifact_access_events_canonical_activation_chk" CHECK (
  ("canonical_activated_at" IS NULL AND "company_id" IS NULL AND "artifact_version_id" IS NULL AND "actor_assignment_id" IS NULL AND "canonical_access_type" IS NULL AND "requestId" IS NULL AND "policy_result" IS NULL AND "watermark_applied" IS NULL AND "redaction_applied" IS NULL AND "request_metadata" IS NULL AND "denial_reason" IS NULL AND "canonical_created_at" IS NULL)
  OR ("canonical_activated_at" IS NOT NULL AND "artifact_id" IS NULL AND "user_id" IS NULL AND "access_type" IS NULL AND "timestamp" IS NULL AND "company_id" IS NOT NULL AND "artifact_version_id" IS NOT NULL AND "actor_assignment_id" IS NOT NULL AND "canonical_access_type" IS NOT NULL AND "requestId" IS NOT NULL AND "policy_result" IS NOT NULL AND "watermark_applied" IS NOT NULL AND "redaction_applied" IS NOT NULL AND "request_metadata" IS NOT NULL AND "canonical_created_at" IS NOT NULL)
);
ALTER TABLE "artifact_access_events" ADD CONSTRAINT "artifact_access_events_canonical_values_chk" CHECK (
  "canonical_activated_at" IS NULL OR (
    "canonical_access_type" IN ('view','copy','download','export','share','print')
    AND "policy_result" IN ('allowed','denied')
    AND (
      ("policy_result" = 'allowed' AND "denial_reason" IS NULL)
      OR (
        "policy_result" = 'denied'
        AND "denial_reason" IS NOT NULL
        AND char_length(btrim("denial_reason")) BETWEEN 1 AND 256
      )
    )
    AND char_length("requestId") BETWEEN 1 AND 128
    AND jsonb_typeof("request_metadata") = 'object'
  )
);
CREATE TABLE "retention_policies" ("id" TEXT NOT NULL,"company_id" TEXT NOT NULL,"key" TEXT NOT NULL,"status" TEXT NOT NULL,"current_version_id" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id"),CONSTRAINT "retention_policies_company_id_key_key" UNIQUE ("company_id","key"),CONSTRAINT "retention_policies_current_version_id_key" UNIQUE ("current_version_id"));
CREATE TABLE "retention_policy_versions" ("id" TEXT NOT NULL,"policy_id" TEXT NOT NULL,"version" INTEGER NOT NULL,"duration_days" INTEGER NOT NULL,"action" TEXT NOT NULL,"legal_basis" TEXT NOT NULL,"content_hash" TEXT NOT NULL,"supersedes_version_id" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "retention_policy_versions_pkey" PRIMARY KEY ("id"),CONSTRAINT "retention_policy_versions_policy_id_version_key" UNIQUE ("policy_id","version"));
CREATE TABLE "retention_assignments" ("id" TEXT NOT NULL,"policy_version_id" TEXT NOT NULL,"artifact_classification" TEXT NOT NULL,"resource_kind" TEXT NOT NULL,"due_at" TIMESTAMP(3),"active" BOOLEAN NOT NULL DEFAULT true,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "retention_assignments_pkey" PRIMARY KEY ("id"),CONSTRAINT "retention_assignments_policy_version_id_artifact_classifica_key" UNIQUE ("policy_version_id","artifact_classification","resource_kind"));
CREATE TABLE "legal_holds" ("id" TEXT NOT NULL,"company_id" TEXT NOT NULL,"policy_id" TEXT,"custodian_assignment_id" TEXT NOT NULL,"status" TEXT NOT NULL,"reason" TEXT NOT NULL,"started_at" TIMESTAMP(3) NOT NULL,"released_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id"));
CREATE TABLE "legal_hold_scopes" ("id" TEXT NOT NULL,"legal_hold_id" TEXT NOT NULL,"company_id" TEXT NOT NULL,"artifact_version_id" TEXT,"resource_kind" TEXT NOT NULL,"resource_id" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "legal_hold_scopes_pkey" PRIMARY KEY ("id"),CONSTRAINT "legal_hold_scopes_legal_hold_id_resource_kind_resource_id_key" UNIQUE ("legal_hold_id","resource_kind","resource_id"));
CREATE TABLE "retention_runs" ("id" TEXT NOT NULL,"company_id" TEXT NOT NULL,"phase" TEXT NOT NULL,"status" TEXT NOT NULL,"revision" INTEGER NOT NULL,"retention_assignment_id" TEXT NOT NULL,"policy_version_id" TEXT NOT NULL,"policy_content_hash" TEXT NOT NULL,"resource_kind" TEXT NOT NULL,"action" TEXT NOT NULL,"cutoff_at" TIMESTAMP(3) NOT NULL,"max_items" INTEGER NOT NULL,"preview_hash" TEXT NOT NULL,"item_count" INTEGER NOT NULL,"candidate_count" INTEGER NOT NULL,"held_count" INTEGER NOT NULL,"ineligible_count" INTEGER NOT NULL,"actor_assignment_id" TEXT NOT NULL,"idempotency_key" TEXT NOT NULL,"input_hash" TEXT NOT NULL,"audit_log_id" TEXT NOT NULL,"preview_run_id" TEXT,"execution_mode" TEXT,"revalidation_hash" TEXT,"approval_request_id" TEXT,"approval_request_revision" INTEGER,"approval_manifest_artifact_version_id" TEXT,"approval_manifest_content_hash" TEXT,"approval_policy_hash" TEXT,"would_purge_count" INTEGER NOT NULL DEFAULT 0,"purged_count" INTEGER NOT NULL DEFAULT 0,"blocked_count" INTEGER NOT NULL DEFAULT 0,"failed_count" INTEGER NOT NULL DEFAULT 0,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id"),CONSTRAINT "retention_runs_id_phase_key" UNIQUE ("id","phase"),CONSTRAINT "retention_runs_assignment_phase_actor_idempotency_key" UNIQUE ("retention_assignment_id","phase","actor_assignment_id","idempotency_key"),CONSTRAINT "retention_runs_preview_phase_actor_idempotency_key" UNIQUE ("preview_run_id","phase","actor_assignment_id","idempotency_key"));
CREATE TABLE "retention_run_items" ("id" TEXT NOT NULL,"retention_run_id" TEXT NOT NULL,"phase" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"resource_kind" TEXT NOT NULL,"resource_id" TEXT NOT NULL,"document_id" TEXT NOT NULL,"project_id" TEXT NOT NULL,"policy_version_id" TEXT NOT NULL,"policy_content_hash" TEXT NOT NULL,"pre_action_hash" TEXT NOT NULL,"hold_set_hash" TEXT NOT NULL,"decision" TEXT NOT NULL,"outcome" TEXT NOT NULL,"reason_code" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "retention_run_items_pkey" PRIMARY KEY ("id"),CONSTRAINT "retention_run_items_run_resource_key" UNIQUE ("retention_run_id","resource_kind","resource_id"),CONSTRAINT "retention_run_items_run_ordinal_key" UNIQUE ("retention_run_id","ordinal"));
CREATE TABLE "export_capabilities" ("id" TEXT NOT NULL,"export_request_id" TEXT NOT NULL,"artifact_version_id" TEXT NOT NULL,"artifact_content_hash" TEXT NOT NULL,"requester_assignment_id" TEXT NOT NULL,"token_digest" TEXT NOT NULL,"expires_at" TIMESTAMP(3) NOT NULL,"consumed_at" TIMESTAMP(3),"revoked_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "export_capabilities_pkey" PRIMARY KEY ("id"),CONSTRAINT "export_capabilities_token_digest_key" UNIQUE ("token_digest"));
CREATE TABLE "ownership_transfers" ("id" TEXT NOT NULL,"role_change_request_id" TEXT NOT NULL,"source_assignment_id" TEXT NOT NULL,"successor_assignment_id" TEXT NOT NULL,"requested_by_assignment_id" TEXT NOT NULL,"approved_by_assignment_id" TEXT,"preview_schema_version" TEXT NOT NULL,"preview_hash" TEXT NOT NULL,"item_count" INTEGER NOT NULL,"status" TEXT NOT NULL,"revision" INTEGER NOT NULL,"preview_idempotency_key" TEXT NOT NULL,"preview_input_hash" TEXT NOT NULL,"execute_idempotency_key" TEXT,"execute_input_hash" TEXT,"preview_audit_log_id" TEXT NOT NULL,"completion_audit_log_id" TEXT,"blocked_reason" TEXT,"requested_at" TIMESTAMP(3),"approved_at" TIMESTAMP(3),"completed_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id"),CONSTRAINT "ownership_transfers_role_change_request_id_key" UNIQUE ("role_change_request_id"),CONSTRAINT "ownership_transfers_source_preview_idempotency_key" UNIQUE ("source_assignment_id","preview_idempotency_key"),CONSTRAINT "ownership_transfers_id_execute_idempotency_key" UNIQUE ("id","execute_idempotency_key"));
CREATE TABLE "ownership_transfer_items" ("id" TEXT NOT NULL,"ownership_transfer_id" TEXT NOT NULL,"ordinal" INTEGER NOT NULL,"entity_type" TEXT NOT NULL,"entity_id" TEXT NOT NULL,"owner_assignment_id" TEXT NOT NULL,"ownership_revision" INTEGER NOT NULL,"after_owner_assignment_id" TEXT NOT NULL,"after_ownership_revision" INTEGER NOT NULL,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "ownership_transfer_items_pkey" PRIMARY KEY ("id"),CONSTRAINT "ownership_transfer_items_transfer_entity_key" UNIQUE ("ownership_transfer_id","entity_type","entity_id"),CONSTRAINT "ownership_transfer_items_transfer_ordinal_key" UNIQUE ("ownership_transfer_id","ordinal"));

-- CHECK constraints may not contain subqueries directly. This non-trigger helper keeps the exact
-- ten trigger-function/twenty-three trigger authority inventory unchanged while making every
-- nullable ArtifactVersion correlation and required actor/approval/audit binding company-exact.
CREATE OR REPLACE FUNCTION public.sangfor_u042_company_bindings_match(
  p_company_id text,
  p_artifact_version_id text DEFAULT NULL,
  p_assignment_id text DEFAULT NULL,
  p_approval_request_id text DEFAULT NULL,
  p_audit_log_id text DEFAULT NULL,
  p_retention_assignment_id text DEFAULT NULL,
  p_legal_hold_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT p_company_id IS NOT NULL
    AND (
      p_artifact_version_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.artifact_versions av
        JOIN public.artifacts a ON a.id = av.artifact_id
        WHERE av.id = p_artifact_version_id AND a.company_id = p_company_id
      )
    )
    AND (
      p_assignment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_company_roles ucr
        WHERE ucr.id = p_assignment_id AND ucr.company_id = p_company_id
      )
    )
    AND (
      p_approval_request_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.approval_requests ar
        WHERE ar.id = p_approval_request_id
          AND ar.company_id = p_company_id
          AND ar.legacy_unbound = false
      )
    )
    AND (
      p_audit_log_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.audit_logs al
        WHERE al.id = p_audit_log_id AND al.company_id = p_company_id
      )
    )
    AND (
      p_retention_assignment_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.retention_assignments ra
        JOIN public.retention_policy_versions rpv ON rpv.id = ra.policy_version_id
        JOIN public.retention_policies rp ON rp.id = rpv.policy_id
        WHERE ra.id = p_retention_assignment_id AND rp.company_id = p_company_id
      )
    )
    AND (
      p_legal_hold_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.legal_holds lh
        WHERE lh.id = p_legal_hold_id AND lh.company_id = p_company_id
      )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.sangfor_u042_retention_item_matches(
  p_retention_run_id text,
  p_phase text,
  p_policy_version_id text,
  p_policy_content_hash text,
  p_decision text,
  p_outcome text,
  p_document_id text,
  p_project_id text
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.retention_runs rr
    JOIN public.knowledge_documents kd ON kd.id = p_document_id
    WHERE rr.id = p_retention_run_id
      AND rr.phase = p_phase
      AND rr.policy_version_id = p_policy_version_id
      AND rr.policy_content_hash = p_policy_content_hash
      AND kd.project_id = p_project_id
      AND (
        (rr.phase = 'preview' AND p_outcome = 'not_executed')
        OR (
          rr.phase = 'execution'
          AND rr.status = 'completed'
          AND rr.execution_mode = 'dry_run'
          AND (
            (p_decision = 'candidate' AND p_outcome = 'would_purge')
            OR (p_decision IN ('held','ineligible') AND p_outcome = 'blocked')
          )
        )
        OR (
          rr.phase = 'execution'
          AND rr.status = 'completed'
          AND rr.execution_mode = 'local_purge'
          AND (
            (p_decision = 'candidate' AND p_outcome = 'purged')
            OR (p_decision IN ('held','ineligible') AND p_outcome = 'blocked')
          )
        )
        OR (
          rr.phase = 'execution'
          AND rr.status = 'blocked'
          AND p_outcome = 'blocked'
        )
        OR (
          rr.phase = 'execution'
          AND rr.status = 'failed'
          AND p_outcome IN ('blocked','failed')
        )
      )
  );
$fn$;

ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_company_bindings_chk" CHECK (
  "canonical_activated_at" IS NULL OR public.sangfor_u042_company_bindings_match(
    "company_id", "artifact_version_id", "requested_by_assignment_id",
    "approval_request_id", "audit_log_id", NULL, NULL
  )
);
ALTER TABLE "artifact_access_events" ADD CONSTRAINT "artifact_access_events_company_bindings_chk" CHECK (
  "canonical_activated_at" IS NULL OR public.sangfor_u042_company_bindings_match(
    "company_id", "artifact_version_id", "actor_assignment_id", NULL, NULL, NULL, NULL
  )
);
ALTER TABLE "legal_hold_scopes" ADD CONSTRAINT "legal_hold_scopes_company_bindings_chk" CHECK (
  public.sangfor_u042_company_bindings_match(
    "company_id", "artifact_version_id", NULL, NULL, NULL, NULL, "legal_hold_id"
  )
);
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_company_bindings_chk" CHECK (
  public.sangfor_u042_company_bindings_match(
    "company_id", "approval_manifest_artifact_version_id", "actor_assignment_id",
    "approval_request_id", "audit_log_id", "retention_assignment_id", NULL
  )
);
ALTER TABLE "retention_run_items" ADD CONSTRAINT "retention_run_items_parent_shape_chk" CHECK (
  public.sangfor_u042_retention_item_matches(
    "retention_run_id", "phase", "policy_version_id", "policy_content_hash",
    "decision", "outcome", "document_id", "project_id"
  )
);

ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "retention_policies"("id") ON DELETE RESTRICT;
ALTER TABLE "retention_assignments" ADD CONSTRAINT "retention_assignments_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "retention_policy_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "legal_hold_scopes" ADD CONSTRAINT "legal_hold_scopes_hold_id_fkey" FOREIGN KEY ("legal_hold_id") REFERENCES "legal_holds"("id") ON DELETE RESTRICT;
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_assignment_id_fkey" FOREIGN KEY ("retention_assignment_id") REFERENCES "retention_assignments"("id") ON DELETE RESTRICT;
ALTER TABLE "retention_run_items" ADD CONSTRAINT "retention_run_items_run_phase_fkey" FOREIGN KEY ("retention_run_id","phase") REFERENCES "retention_runs"("id","phase") ON DELETE RESTRICT;
ALTER TABLE "export_capabilities" ADD CONSTRAINT "export_capabilities_export_request_id_fkey" FOREIGN KEY ("export_request_id") REFERENCES "data_export_requests"("id") ON DELETE RESTRICT;
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_role_change_request_id_fkey" FOREIGN KEY ("role_change_request_id") REFERENCES "role_change_requests"("id") ON DELETE RESTRICT;
ALTER TABLE "ownership_transfer_items" ADD CONSTRAINT "ownership_transfer_items_transfer_id_fkey" FOREIGN KEY ("ownership_transfer_id") REFERENCES "ownership_transfers"("id") ON DELETE RESTRICT;

ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_shape_chk" CHECK (
  "phase" IN ('preview','execution')
  AND "status" IN ('completed','blocked','failed')
  AND "revision" >= 0
  AND "resource_kind" = 'knowledge_chunk'
  AND "action" = 'purge'
  AND "max_items" BETWEEN 1 AND 100
  AND "preview_hash" ~ '^[0-9a-f]{64}$'
  AND "input_hash" ~ '^[0-9a-f]{64}$'
  AND "item_count" >= 0
  AND "candidate_count" >= 0
  AND "held_count" >= 0
  AND "ineligible_count" >= 0
  AND "candidate_count" + "held_count" + "ineligible_count" = "item_count"
  AND "purged_count" >= 0
  AND "would_purge_count" >= 0
  AND "blocked_count" >= 0
  AND "failed_count" >= 0
  AND (
    (
      "phase" = 'preview'
      AND "revision" = 0
      AND "preview_run_id" IS NULL
      AND "execution_mode" IS NULL
      AND "revalidation_hash" IS NULL
      AND "approval_request_id" IS NULL
      AND "approval_request_revision" IS NULL
      AND "approval_manifest_artifact_version_id" IS NULL
      AND "approval_manifest_content_hash" IS NULL
      AND "approval_policy_hash" IS NULL
      AND "would_purge_count" = 0
      AND "purged_count" = 0
      AND "blocked_count" = 0
      AND "failed_count" = 0
    )
    OR (
      "phase" = 'execution'
      AND "preview_run_id" IS NOT NULL
      AND "execution_mode" IN ('dry_run','local_purge')
      AND "revalidation_hash" ~ '^[0-9a-f]{64}$'
      AND "approval_request_id" IS NOT NULL
      AND "approval_request_revision" >= 0
      AND "approval_manifest_artifact_version_id" IS NOT NULL
      AND "approval_manifest_content_hash" IS NOT NULL
      AND "approval_policy_hash" IS NOT NULL
    )
  )
  AND ("status" NOT IN ('blocked','failed') OR "purged_count" = 0)
  AND (
    "phase" <> 'execution'
    OR "status" <> 'completed'
    OR (
      "execution_mode" = 'dry_run'
      AND "purged_count" = 0
      AND "failed_count" = 0
      AND "would_purge_count" = "candidate_count"
    )
    OR (
      "execution_mode" = 'local_purge'
      AND "would_purge_count" = 0
      AND "failed_count" = 0
      AND "purged_count" <= "max_items"
    )
  )
);
ALTER TABLE "retention_run_items" ADD CONSTRAINT "retention_run_items_shape_chk" CHECK ("ordinal" >= 0 AND "resource_kind"='knowledge_chunk' AND "decision" IN ('candidate','held','ineligible') AND "outcome" IN ('not_executed','would_purge','purged','blocked','failed') AND "pre_action_hash" ~ '^[0-9a-f]{64}$' AND "hold_set_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "export_capabilities" ADD CONSTRAINT "export_capabilities_shape_chk" CHECK ("token_digest" ~ '^[0-9a-f]{64}$' AND NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL));
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_shape_chk" CHECK (
  "preview_schema_version" = 'ownership-transfer/v1'
  AND "preview_hash" ~ '^[0-9a-f]{64}$'
  AND "preview_input_hash" ~ '^[0-9a-f]{64}$'
  AND ("execute_input_hash" IS NULL OR "execute_input_hash" ~ '^[0-9a-f]{64}$')
  AND "item_count" > 0
  AND "revision" >= 0
  AND "status" IN ('requested','approved','completed','blocked','cancelled')
  AND "source_assignment_id" <> "successor_assignment_id"
  AND "requested_at" IS NOT NULL
  AND (
    (
      "status" = 'requested'
      AND "approved_by_assignment_id" IS NULL
      AND "approved_at" IS NULL
      AND "execute_idempotency_key" IS NULL
      AND "execute_input_hash" IS NULL
      AND "completion_audit_log_id" IS NULL
      AND "completed_at" IS NULL
      AND "blocked_reason" IS NULL
    )
    OR (
      "status" = 'approved'
      AND "approved_by_assignment_id" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND "execute_idempotency_key" IS NULL
      AND "execute_input_hash" IS NULL
      AND "completion_audit_log_id" IS NULL
      AND "completed_at" IS NULL
      AND "blocked_reason" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "approved_by_assignment_id" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND "execute_idempotency_key" IS NOT NULL
      AND "execute_input_hash" IS NOT NULL
      AND "completion_audit_log_id" IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "blocked_reason" IS NULL
    )
    OR (
      "status" = 'blocked'
      AND "approved_by_assignment_id" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND "execute_idempotency_key" IS NOT NULL
      AND "execute_input_hash" IS NOT NULL
      AND "completion_audit_log_id" IS NULL
      AND "completed_at" IS NULL
      AND "blocked_reason" IS NOT NULL
      AND char_length(btrim("blocked_reason")) BETWEEN 1 AND 512
    )
    OR (
      "status" = 'cancelled'
      AND "execute_idempotency_key" IS NULL
      AND "execute_input_hash" IS NULL
      AND "completion_audit_log_id" IS NULL
      AND "completed_at" IS NULL
      AND "blocked_reason" IS NULL
      AND (
        ("approved_by_assignment_id" IS NULL AND "approved_at" IS NULL)
        OR ("approved_by_assignment_id" IS NOT NULL AND "approved_at" IS NOT NULL)
      )
    )
  )
);
ALTER TABLE "ownership_transfer_items" ADD CONSTRAINT "ownership_transfer_items_shape_chk" CHECK ("entity_type" IN ('Artifact','ApprovalRequest','Opportunity','WorkTask','VendorRequest','RenewalOpportunity','SupportCase') AND "ordinal">=0 AND "ownership_revision">=0 AND "after_ownership_revision"="ownership_revision"+1);

CREATE OR REPLACE FUNCTION public.governance_history_immutable_update_reject_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable governance history'; END $$;
CREATE OR REPLACE FUNCTION public.governance_history_immutable_delete_reject_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable governance history'; END $$;
CREATE OR REPLACE FUNCTION public.artifact_access_events_canonical_insert_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.canonical_activated_at IS NULL OR NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'canonical access event required';
  END IF;
  IF NOT public.sangfor_u042_company_bindings_match(
    NEW.company_id, NEW.artifact_version_id, NEW.actor_assignment_id, NULL, NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'artifact access event company binding mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.data_export_requests_canonical_insert_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.canonical_activated_at IS NULL
     OR NEW.canonical_status <> 'issued'
     OR NEW.completed_at IS NOT NULL
     OR NEW.expires_at IS DISTINCT FROM NEW.issued_at + interval '600 seconds'
  THEN
    RAISE EXCEPTION 'invalid canonical export issuance';
  END IF;
  IF NOT public.sangfor_u042_company_bindings_match(
    NEW.company_id, NEW.artifact_version_id, NEW.requested_by_assignment_id,
    NEW.approval_request_id, NEW.audit_log_id, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'data export request company binding mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.data_export_requests_lifecycle_update_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.canonical_activated_at IS NULL
     OR OLD.canonical_status <> 'issued'
     OR NEW.canonical_status NOT IN ('consumed','expired','revoked')
     OR (NEW.canonical_status = 'consumed' AND NEW.completed_at IS NULL)
  THEN
    RAISE EXCEPTION 'invalid export lifecycle';
  END IF;

  IF ROW(
    NEW.id, NEW.artifact_id, NEW.requested_by, NEW.reason, NEW.status, NEW.approved_by,
    NEW.canonical_activated_at, NEW.company_id, NEW.artifact_version_id,
    NEW.artifact_content_hash, NEW.classification, NEW.format,
    NEW.requested_by_assignment_id, NEW.approval_request_id, NEW.purpose,
    NEW.issued_at, NEW.expires_at, NEW.idempotency_key, NEW.request_input_hash,
    NEW.audit_log_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.artifact_id, OLD.requested_by, OLD.reason, OLD.status, OLD.approved_by,
    OLD.canonical_activated_at, OLD.company_id, OLD.artifact_version_id,
    OLD.artifact_content_hash, OLD.classification, OLD.format,
    OLD.requested_by_assignment_id, OLD.approval_request_id, OLD.purpose,
    OLD.issued_at, OLD.expires_at, OLD.idempotency_key, OLD.request_input_hash,
    OLD.audit_log_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'data export immutable identity changed';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.export_capabilities_canonical_insert_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_request record;
BEGIN
  SELECT canonical_activated_at, artifact_version_id, artifact_content_hash,
         requested_by_assignment_id, expires_at
  INTO v_request
  FROM data_export_requests
  WHERE id = NEW.export_request_id;

  IF NEW.token_digest !~ '^[0-9a-f]{64}$'
     OR v_request.canonical_activated_at IS NULL
     OR NEW.artifact_version_id IS DISTINCT FROM v_request.artifact_version_id
     OR NEW.artifact_content_hash IS DISTINCT FROM v_request.artifact_content_hash
     OR NEW.requester_assignment_id IS DISTINCT FROM v_request.requested_by_assignment_id
     OR NEW.expires_at IS DISTINCT FROM v_request.expires_at
     OR NEW.consumed_at IS NOT NULL
     OR NEW.revoked_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid export capability binding';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.export_capabilities_lifecycle_update_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD.consumed_at IS NOT NULL
     OR OLD.revoked_at IS NOT NULL
     OR NOT (
       (NEW.consumed_at IS NOT NULL AND NEW.revoked_at IS NULL)
       OR (NEW.consumed_at IS NULL AND NEW.revoked_at IS NOT NULL)
     )
  THEN
    RAISE EXCEPTION 'terminal capability';
  END IF;

  IF ROW(
    NEW.id, NEW.export_request_id, NEW.artifact_version_id, NEW.artifact_content_hash,
    NEW.requester_assignment_id, NEW.token_digest, NEW.expires_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.export_request_id, OLD.artifact_version_id, OLD.artifact_content_hash,
    OLD.requester_assignment_id, OLD.token_digest, OLD.expires_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'export capability immutable identity changed';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ownership_transfers_canonical_insert_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_source record;
  v_successor record;
  v_requester record;
  v_role_change_company text;
  v_audit_company text;
BEGIN
  IF NEW.status <> 'requested' OR NEW.revision <> 0 THEN
    RAISE EXCEPTION 'requested revision zero only';
  END IF;

  SELECT company_id, status INTO v_source
  FROM user_company_roles WHERE id = NEW.source_assignment_id;
  SELECT company_id, status INTO v_successor
  FROM user_company_roles WHERE id = NEW.successor_assignment_id;
  SELECT company_id, status INTO v_requester
  FROM user_company_roles WHERE id = NEW.requested_by_assignment_id;
  SELECT company_id INTO v_role_change_company
  FROM role_change_requests WHERE id = NEW.role_change_request_id;
  SELECT company_id INTO v_audit_company
  FROM audit_logs WHERE id = NEW.preview_audit_log_id;

  IF v_source.company_id IS NULL
     OR v_source.company_id IS DISTINCT FROM v_successor.company_id
     OR v_source.company_id IS DISTINCT FROM v_requester.company_id
     OR v_source.company_id IS DISTINCT FROM v_role_change_company
     OR v_source.company_id IS DISTINCT FROM v_audit_company
     OR v_source.status IS DISTINCT FROM 'active'
     OR v_successor.status IS DISTINCT FROM 'active'
     OR v_requester.status IS DISTINCT FROM 'active'
  THEN
    RAISE EXCEPTION 'ownership transfer assignments must be active and same-company';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ownership_transfers_lifecycle_update_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_item_count bigint;
  v_bad_ordinal_count bigint;
  v_item_hash text;
  v_source_company text;
  v_approved_company text;
  v_completion_audit_company text;
BEGIN
  IF NEW.revision <> OLD.revision + 1
     OR NOT (
       (OLD.status = 'requested' AND NEW.status IN ('approved','cancelled'))
       OR (OLD.status = 'approved' AND NEW.status IN ('completed','blocked','cancelled'))
     )
  THEN
    RAISE EXCEPTION 'invalid ownership lifecycle';
  END IF;

  IF ROW(
    NEW.id, NEW.role_change_request_id, NEW.source_assignment_id,
    NEW.successor_assignment_id, NEW.requested_by_assignment_id,
    NEW.preview_schema_version, NEW.preview_hash, NEW.item_count,
    NEW.preview_idempotency_key, NEW.preview_input_hash,
    NEW.preview_audit_log_id, NEW.requested_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.role_change_request_id, OLD.source_assignment_id,
    OLD.successor_assignment_id, OLD.requested_by_assignment_id,
    OLD.preview_schema_version, OLD.preview_hash, OLD.item_count,
    OLD.preview_idempotency_key, OLD.preview_input_hash,
    OLD.preview_audit_log_id, OLD.requested_at, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'ownership transfer immutable preview identity changed';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE ordinal <> expected_ordinal),
         public.sangfor_sha256_utf8(
           public.sangfor_rfc8785_jcs_v1(
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'entityType', entity_type,
                   'entityId', entity_id,
                   'ownerAssignmentId', owner_assignment_id,
                   'ownershipRevision', ownership_revision
                 )
                 ORDER BY public.sangfor_utf16_units(entity_type),
                          public.sangfor_utf16_units(entity_id)
               ),
               '[]'::jsonb
             )
           )
         )
  INTO v_item_count, v_bad_ordinal_count, v_item_hash
  FROM (
    SELECT i.*,
           row_number() OVER (
             ORDER BY public.sangfor_utf16_units(entity_type),
                      public.sangfor_utf16_units(entity_id)
           ) - 1 AS expected_ordinal
    FROM ownership_transfer_items i
    WHERE i.ownership_transfer_id = OLD.id
  ) ordered_items;

  IF v_item_count <> OLD.item_count
     OR v_bad_ordinal_count <> 0
     OR v_item_hash IS DISTINCT FROM OLD.preview_hash
  THEN
    RAISE EXCEPTION 'ownership transfer tuple count/order/hash mismatch';
  END IF;

  SELECT company_id INTO v_source_company
  FROM user_company_roles WHERE id = OLD.source_assignment_id;

  IF NEW.approved_by_assignment_id IS NOT NULL THEN
    SELECT company_id INTO v_approved_company
    FROM user_company_roles
    WHERE id = NEW.approved_by_assignment_id AND status = 'active';
    IF v_approved_company IS DISTINCT FROM v_source_company THEN
      RAISE EXCEPTION 'ownership transfer approver company mismatch';
    END IF;
  END IF;

  IF NEW.completion_audit_log_id IS NOT NULL THEN
    SELECT company_id INTO v_completion_audit_company
    FROM audit_logs WHERE id = NEW.completion_audit_log_id;
    IF v_completion_audit_company IS DISTINCT FROM v_source_company THEN
      RAISE EXCEPTION 'ownership transfer completion audit company mismatch';
    END IF;
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.approved_by_assignment_id IS DISTINCT FROM OLD.approved_by_assignment_id
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    THEN
      RAISE EXCEPTION 'ownership transfer approval history changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ownership_transfer_items_canonical_insert_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_parent record;
  v_actual_owner text;
  v_actual_revision integer;
  v_existing_count bigint;
  v_previous record;
  v_candidate_hash text;
BEGIN
  SELECT source_assignment_id, successor_assignment_id, item_count, preview_hash
  INTO v_parent
  FROM ownership_transfers
  WHERE id = NEW.ownership_transfer_id;

  IF v_parent.source_assignment_id IS NULL
     OR NEW.owner_assignment_id IS DISTINCT FROM v_parent.source_assignment_id
     OR NEW.after_owner_assignment_id IS DISTINCT FROM v_parent.successor_assignment_id
     OR NEW.after_ownership_revision <> NEW.ownership_revision + 1
  THEN
    RAISE EXCEPTION 'invalid ownership item parent alignment';
  END IF;

  CASE NEW.entity_type
    WHEN 'Artifact' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM artifacts WHERE id = NEW.entity_id;
    WHEN 'ApprovalRequest' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM approval_requests WHERE id = NEW.entity_id;
    WHEN 'Opportunity' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM opportunities WHERE id = NEW.entity_id;
    WHEN 'WorkTask' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM work_tasks WHERE id = NEW.entity_id;
    WHEN 'VendorRequest' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM vendor_requests WHERE id = NEW.entity_id;
    WHEN 'RenewalOpportunity' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM renewal_opportunities WHERE id = NEW.entity_id;
    WHEN 'SupportCase' THEN
      SELECT owner_assignment_id, ownership_revision INTO v_actual_owner, v_actual_revision
      FROM support_cases WHERE id = NEW.entity_id;
    ELSE
      RAISE EXCEPTION 'invalid ownership item entity type';
  END CASE;

  IF v_actual_owner IS DISTINCT FROM NEW.owner_assignment_id
     OR v_actual_revision IS DISTINCT FROM NEW.ownership_revision
  THEN
    RAISE EXCEPTION 'ownership item does not byte-match source owner tuple';
  END IF;

  SELECT count(*) INTO v_existing_count
  FROM ownership_transfer_items
  WHERE ownership_transfer_id = NEW.ownership_transfer_id;
  IF NEW.ordinal <> v_existing_count OR NEW.ordinal >= v_parent.item_count THEN
    RAISE EXCEPTION 'ownership item ordinal must be contiguous and bounded';
  END IF;

  SELECT entity_type, entity_id INTO v_previous
  FROM ownership_transfer_items
  WHERE ownership_transfer_id = NEW.ownership_transfer_id
  ORDER BY ordinal DESC
  LIMIT 1;
  IF v_previous.entity_type IS NOT NULL
     AND ROW(
       public.sangfor_utf16_units(NEW.entity_type),
       public.sangfor_utf16_units(NEW.entity_id)
     ) <= ROW(
       public.sangfor_utf16_units(v_previous.entity_type),
       public.sangfor_utf16_units(v_previous.entity_id)
     )
  THEN
    RAISE EXCEPTION 'ownership item tuple order is not strict UTF-16 order';
  END IF;

  IF NEW.ordinal = v_parent.item_count - 1 THEN
    SELECT public.sangfor_sha256_utf8(
             public.sangfor_rfc8785_jcs_v1(
               jsonb_agg(
                 jsonb_build_object(
                   'entityType', entity_type,
                   'entityId', entity_id,
                   'ownerAssignmentId', owner_assignment_id,
                   'ownershipRevision', ownership_revision
                 )
                 ORDER BY public.sangfor_utf16_units(entity_type),
                          public.sangfor_utf16_units(entity_id)
               )
             )
           )
    INTO v_candidate_hash
    FROM (
      SELECT entity_type, entity_id, owner_assignment_id, ownership_revision
      FROM ownership_transfer_items
      WHERE ownership_transfer_id = NEW.ownership_transfer_id
      UNION ALL
      SELECT NEW.entity_type, NEW.entity_id, NEW.owner_assignment_id, NEW.ownership_revision
    ) candidate_items;
    IF v_candidate_hash IS DISTINCT FROM v_parent.preview_hash THEN
      RAISE EXCEPTION 'ownership item set does not match parent preview hash';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER retention_runs_immutable_update_trg BEFORE UPDATE ON "retention_runs" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_update_reject_fn();
CREATE TRIGGER retention_runs_immutable_delete_trg BEFORE DELETE ON "retention_runs" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER retention_run_items_immutable_update_trg BEFORE UPDATE ON "retention_run_items" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_update_reject_fn();
CREATE TRIGGER retention_run_items_immutable_delete_trg BEFORE DELETE ON "retention_run_items" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER retention_policy_versions_immutable_update_trg BEFORE UPDATE ON "retention_policy_versions" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_update_reject_fn();
CREATE TRIGGER retention_policy_versions_immutable_delete_trg BEFORE DELETE ON "retention_policy_versions" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER legal_hold_scopes_immutable_update_trg BEFORE UPDATE ON "legal_hold_scopes" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_update_reject_fn();
CREATE TRIGGER legal_hold_scopes_immutable_delete_trg BEFORE DELETE ON "legal_hold_scopes" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER artifact_access_events_canonical_insert_guard_trg BEFORE INSERT ON "artifact_access_events" FOR EACH ROW EXECUTE FUNCTION public.artifact_access_events_canonical_insert_guard_fn();
CREATE TRIGGER artifact_access_events_immutable_update_trg BEFORE UPDATE ON "artifact_access_events" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_update_reject_fn();
CREATE TRIGGER artifact_access_events_immutable_delete_trg BEFORE DELETE ON "artifact_access_events" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER data_export_requests_canonical_insert_guard_trg BEFORE INSERT ON "data_export_requests" FOR EACH ROW EXECUTE FUNCTION public.data_export_requests_canonical_insert_guard_fn();
CREATE TRIGGER data_export_requests_lifecycle_update_guard_trg BEFORE UPDATE ON "data_export_requests" FOR EACH ROW EXECUTE FUNCTION public.data_export_requests_lifecycle_update_guard_fn();
CREATE TRIGGER data_export_requests_immutable_delete_trg BEFORE DELETE ON "data_export_requests" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER export_capabilities_canonical_insert_guard_trg BEFORE INSERT ON "export_capabilities" FOR EACH ROW EXECUTE FUNCTION public.export_capabilities_canonical_insert_guard_fn();
CREATE TRIGGER export_capabilities_lifecycle_update_guard_trg BEFORE UPDATE ON "export_capabilities" FOR EACH ROW EXECUTE FUNCTION public.export_capabilities_lifecycle_update_guard_fn();
CREATE TRIGGER export_capabilities_immutable_delete_trg BEFORE DELETE ON "export_capabilities" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER ownership_transfers_canonical_insert_guard_trg BEFORE INSERT ON "ownership_transfers" FOR EACH ROW EXECUTE FUNCTION public.ownership_transfers_canonical_insert_guard_fn();
CREATE TRIGGER ownership_transfers_lifecycle_update_guard_trg BEFORE UPDATE ON "ownership_transfers" FOR EACH ROW EXECUTE FUNCTION public.ownership_transfers_lifecycle_update_guard_fn();
CREATE TRIGGER ownership_transfers_immutable_delete_trg BEFORE DELETE ON "ownership_transfers" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();
CREATE TRIGGER ownership_transfer_items_canonical_insert_guard_trg BEFORE INSERT ON "ownership_transfer_items" FOR EACH ROW EXECUTE FUNCTION public.ownership_transfer_items_canonical_insert_guard_fn();
CREATE TRIGGER ownership_transfer_items_immutable_update_trg BEFORE UPDATE ON "ownership_transfer_items" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_update_reject_fn();
CREATE TRIGGER ownership_transfer_items_immutable_delete_trg BEFORE DELETE ON "ownership_transfer_items" FOR EACH ROW EXECUTE FUNCTION public.governance_history_immutable_delete_reject_fn();

-- Prisma's final datamodel deliberately has no DB default for @updatedAt fields. The add uses a
-- temporary default only to preserve existing rows; removing it makes the deployed shape exact.
ALTER TABLE "data_export_requests" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "retention_policies" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "retention_assignments" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "legal_holds" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ownership_transfers" ALTER COLUMN "updated_at" DROP DEFAULT;

DROP INDEX IF EXISTS "artifact_access_events_artifact_id_idx";
CREATE INDEX "artifact_access_events_company_id_canonical_activated_at_idx" ON "artifact_access_events"("company_id", "canonical_activated_at");
CREATE INDEX "data_export_requests_company_id_canonical_activated_at_idx" ON "data_export_requests"("company_id", "canonical_activated_at");
CREATE UNIQUE INDEX "data_export_requests_requested_assignment_idempotency_key" ON "data_export_requests"("requested_by_assignment_id", "idempotency_key");
CREATE INDEX "export_capabilities_expires_at_consumed_at_revoked_at_idx" ON "export_capabilities"("expires_at", "consumed_at", "revoked_at");
CREATE INDEX "legal_hold_scopes_company_id_resource_kind_resource_id_idx" ON "legal_hold_scopes"("company_id", "resource_kind", "resource_id");
CREATE INDEX "legal_holds_company_id_status_released_at_idx" ON "legal_holds"("company_id", "status", "released_at");
CREATE INDEX "ownership_transfers_source_assignment_id_successor_assignme_idx" ON "ownership_transfers"("source_assignment_id", "successor_assignment_id", "status");
CREATE INDEX "retention_assignments_active_due_at_idx" ON "retention_assignments"("active", "due_at");

-- Recreate every U042 FK with Prisma's exact names and ON UPDATE CASCADE semantics.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname, conrelid::regclass AS table_name FROM pg_constraint
    WHERE contype='f' AND conrelid IN ('data_export_requests'::regclass,'artifact_access_events'::regclass,'retention_policies'::regclass,'retention_policy_versions'::regclass,'retention_assignments'::regclass,'legal_holds'::regclass,'legal_hold_scopes'::regclass,'retention_runs'::regclass,'retention_run_items'::regclass,'export_capabilities'::regclass,'ownership_transfers'::regclass,'ownership_transfer_items'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.table_name, c.conname); END LOOP;
END $$;
ALTER TABLE "data_export_requests"
  ADD CONSTRAINT "data_export_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_export_requests_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_export_requests_requested_by_assignment_id_fkey" FOREIGN KEY ("requested_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_export_requests_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_export_requests_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artifact_access_events"
  ADD CONSTRAINT "artifact_access_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "artifact_access_events_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "artifact_access_events_actor_assignment_id_fkey" FOREIGN KEY ("actor_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_policies_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "retention_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_policy_versions"
  ADD CONSTRAINT "retention_policy_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "retention_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_policy_versions_supersedes_version_id_fkey" FOREIGN KEY ("supersedes_version_id") REFERENCES "retention_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_assignments" ADD CONSTRAINT "retention_assignments_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "retention_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
  ADD CONSTRAINT "legal_holds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "legal_holds_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "retention_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "legal_holds_custodian_assignment_id_fkey" FOREIGN KEY ("custodian_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_hold_scopes"
  ADD CONSTRAINT "legal_hold_scopes_legal_hold_id_fkey" FOREIGN KEY ("legal_hold_id") REFERENCES "legal_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "legal_hold_scopes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "legal_hold_scopes_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_runs"
  ADD CONSTRAINT "retention_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_retention_assignment_id_fkey" FOREIGN KEY ("retention_assignment_id") REFERENCES "retention_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "retention_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_actor_assignment_id_fkey" FOREIGN KEY ("actor_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_preview_run_id_fkey" FOREIGN KEY ("preview_run_id") REFERENCES "retention_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_runs_approval_manifest_artifact_version_id_fkey" FOREIGN KEY ("approval_manifest_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_run_items"
  ADD CONSTRAINT "retention_run_items_retention_run_id_phase_fkey" FOREIGN KEY ("retention_run_id","phase") REFERENCES "retention_runs"("id","phase") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_run_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_run_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "retention_run_items_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "retention_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_capabilities"
  ADD CONSTRAINT "export_capabilities_export_request_id_fkey" FOREIGN KEY ("export_request_id") REFERENCES "data_export_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "export_capabilities_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "export_capabilities_requester_assignment_id_fkey" FOREIGN KEY ("requester_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ownership_transfers"
  ADD CONSTRAINT "ownership_transfers_role_change_request_id_fkey" FOREIGN KEY ("role_change_request_id") REFERENCES "role_change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfers_source_assignment_id_fkey" FOREIGN KEY ("source_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfers_successor_assignment_id_fkey" FOREIGN KEY ("successor_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfers_requested_by_assignment_id_fkey" FOREIGN KEY ("requested_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfers_approved_by_assignment_id_fkey" FOREIGN KEY ("approved_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfers_preview_audit_log_id_fkey" FOREIGN KEY ("preview_audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfers_completion_audit_log_id_fkey" FOREIGN KEY ("completion_audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ownership_transfer_items"
  ADD CONSTRAINT "ownership_transfer_items_ownership_transfer_id_fkey" FOREIGN KEY ("ownership_transfer_id") REFERENCES "ownership_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfer_items_owner_assignment_id_fkey" FOREIGN KEY ("owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ownership_transfer_items_after_owner_assignment_id_fkey" FOREIGN KEY ("after_owner_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
