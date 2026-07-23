-- U041 / AIQ-01: additive, exact-ArtifactVersion AI quality history. These tables are
-- deliberately insert-only evidence; no current release authority is introduced here.

CREATE TABLE "ai_quality_assessments" (
  "id" TEXT NOT NULL,
  "artifact_version_id" TEXT NOT NULL,
  "artifact_content_hash" TEXT NOT NULL,
  "result_hash" TEXT NOT NULL,
  "policy_key" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "evaluator_key" TEXT NOT NULL,
  "evaluator_version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "score" DOUBLE PRECISION NOT NULL,
  "source_coverage" DOUBLE PRECISION NOT NULL,
  "confidence_basis" JSONB NOT NULL,
  "missing_info" JSONB NOT NULL,
  "known_gaps" JSONB NOT NULL,
  "risk_flags" JSONB NOT NULL,
  "injection_detected" BOOLEAN NOT NULL,
  "leakage_detected" BOOLEAN NOT NULL,
  "quality_passed" BOOLEAN NOT NULL,
  "assessed_by_assignment_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "assessment_input_hash" TEXT NOT NULL,
  "assessed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_quality_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_quality_assessments_artifact_assignment_idempotency_key" UNIQUE ("artifact_version_id", "assessed_by_assignment_id", "idempotency_key")
);

ALTER TABLE "ai_quality_assessments" ADD CONSTRAINT "ai_quality_assessments_shape_chk" CHECK (
  "status" = 'completed'
  AND "artifact_content_hash" ~ '^[0-9a-f]{64}$'
  AND "result_hash" ~ '^[0-9a-f]{64}$'
  AND "assessment_input_hash" ~ '^[0-9a-f]{64}$'
  AND "score" >= 0 AND "score" <= 1
  AND "source_coverage" >= 0 AND "source_coverage" <= 1
  AND char_length("idempotency_key") BETWEEN 1 AND 160
  AND "idempotency_key" = btrim("idempotency_key")
);

CREATE TABLE "ai_quality_evidence" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "source_artifact_version_id" TEXT,
  "citation" JSONB NOT NULL,
  "coverage" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_quality_evidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_quality_evidence" ADD CONSTRAINT "ai_quality_evidence_shape_chk" CHECK (
  "source_hash" ~ '^[0-9a-f]{64}$'
  AND char_length("source_kind") BETWEEN 1 AND 80
  AND "source_kind" = btrim("source_kind")
  AND char_length("source_reference") BETWEEN 1 AND 2000
  AND "source_reference" = btrim("source_reference")
  AND ("source_kind" <> 'artifact' OR "source_artifact_version_id" IS NOT NULL)
);

CREATE TABLE "ai_quality_reviews" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "artifact_version_id" TEXT NOT NULL,
  "artifact_content_hash" TEXT NOT NULL,
  "assessment_result_hash" TEXT NOT NULL,
  "review_slot_key" TEXT NOT NULL,
  "reviewer_assignment_id" TEXT NOT NULL,
  "reviewer_role_snapshot" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "comment" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "review_input_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_quality_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_quality_reviews_assessment_slot_key" UNIQUE ("assessment_id", "review_slot_key"),
  CONSTRAINT "ai_quality_reviews_assessment_reviewer_idempotency_key" UNIQUE ("assessment_id", "reviewer_assignment_id", "idempotency_key")
);

ALTER TABLE "ai_quality_reviews" ADD CONSTRAINT "ai_quality_reviews_shape_chk" CHECK (
  "artifact_content_hash" ~ '^[0-9a-f]{64}$'
  AND "assessment_result_hash" ~ '^[0-9a-f]{64}$'
  AND "review_input_hash" ~ '^[0-9a-f]{64}$'
  AND "decision" IN ('approved', 'rejected')
  AND char_length("review_slot_key") BETWEEN 1 AND 160
  AND "review_slot_key" = btrim("review_slot_key")
  AND char_length("idempotency_key") BETWEEN 1 AND 160
  AND "idempotency_key" = btrim("idempotency_key")
  AND ("comment" IS NULL OR (char_length("comment") BETWEEN 1 AND 4000 AND "comment" = btrim("comment")))
);

CREATE TABLE "ai_release_evaluations" (
  "id" TEXT NOT NULL,
  "evaluation_key" TEXT NOT NULL,
  "evaluation_input_hash" TEXT NOT NULL,
  "review_set_hash" TEXT NOT NULL,
  "artifact_version_id" TEXT NOT NULL,
  "artifact_content_hash" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "policy_key" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "policy_hash" TEXT NOT NULL,
  "approval_request_id" TEXT,
  "approval_request_revision" INTEGER,
  "approval_artifact_hash_snapshot" TEXT,
  "approval_policy_hash_snapshot" TEXT,
  "eligible" BOOLEAN NOT NULL,
  "blockers" JSONB NOT NULL,
  "evaluated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_release_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_release_evaluations_evaluation_key_key" UNIQUE ("evaluation_key"),
  CONSTRAINT "ai_release_evaluations_action_assessment_artifact_input_key" UNIQUE ("action", "assessment_id", "artifact_version_id", "artifact_content_hash", "evaluation_input_hash")
);

ALTER TABLE "ai_release_evaluations" ADD CONSTRAINT "ai_release_evaluations_shape_chk" CHECK (
  "evaluation_key" ~ '^[0-9a-f]{64}$'
  AND "evaluation_input_hash" ~ '^[0-9a-f]{64}$'
  AND "review_set_hash" ~ '^[0-9a-f]{64}$'
  AND "artifact_content_hash" ~ '^[0-9a-f]{64}$'
  AND "policy_hash" ~ '^[0-9a-f]{64}$'
  AND ("approval_artifact_hash_snapshot" IS NULL OR "approval_artifact_hash_snapshot" ~ '^[0-9a-f]{64}$')
  AND ("approval_policy_hash_snapshot" IS NULL OR "approval_policy_hash_snapshot" ~ '^[0-9a-f]{64}$')
  AND "action" IN ('ai.review', 'ai.internal_release', 'ai.customer_send', 'quote.internal_release')
  AND (("approval_request_id" IS NULL AND "approval_request_revision" IS NULL AND "approval_artifact_hash_snapshot" IS NULL AND "approval_policy_hash_snapshot" IS NULL)
       OR ("approval_request_id" IS NOT NULL AND "approval_request_revision" IS NOT NULL AND "approval_artifact_hash_snapshot" IS NOT NULL AND "approval_policy_hash_snapshot" IS NOT NULL))
);

CREATE TABLE "ai_prompt_snapshots" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "prompt_key" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "prompt_hash" TEXT NOT NULL,
  "tool_key" TEXT NOT NULL,
  "tool_version" TEXT NOT NULL,
  "tool_hash" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "approval_reference" TEXT,
  "release_reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_prompt_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_prompt_snapshots" ADD CONSTRAINT "ai_prompt_snapshots_shape_chk" CHECK (
  "prompt_hash" ~ '^[0-9a-f]{64}$'
  AND "tool_hash" ~ '^[0-9a-f]{64}$'
  AND char_length("classification") BETWEEN 1 AND 120
  AND "classification" = btrim("classification")
);

CREATE TABLE "ai_model_snapshots" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "model_key" TEXT NOT NULL,
  "model_version" TEXT NOT NULL,
  "model_hash" TEXT NOT NULL,
  "tool_key" TEXT NOT NULL,
  "tool_version" TEXT NOT NULL,
  "tool_hash" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "approval_reference" TEXT,
  "release_reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_model_snapshots" ADD CONSTRAINT "ai_model_snapshots_shape_chk" CHECK (
  "model_hash" ~ '^[0-9a-f]{64}$'
  AND "tool_hash" ~ '^[0-9a-f]{64}$'
  AND char_length("classification") BETWEEN 1 AND 120
  AND "classification" = btrim("classification")
);

ALTER TABLE "ai_quality_assessments"
  ADD CONSTRAINT "ai_quality_assessments_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_quality_assessments_assessed_by_assignment_id_fkey" FOREIGN KEY ("assessed_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quality_evidence"
  ADD CONSTRAINT "ai_quality_evidence_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "ai_quality_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_quality_evidence_source_artifact_version_id_fkey" FOREIGN KEY ("source_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quality_reviews"
  ADD CONSTRAINT "ai_quality_reviews_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "ai_quality_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_quality_reviews_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_quality_reviews_reviewer_assignment_id_fkey" FOREIGN KEY ("reviewer_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_release_evaluations"
  ADD CONSTRAINT "ai_release_evaluations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "ai_quality_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_release_evaluations_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_release_evaluations_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_snapshots"
  ADD CONSTRAINT "ai_prompt_snapshots_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "ai_quality_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_model_snapshots"
  ADD CONSTRAINT "ai_model_snapshots_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "ai_quality_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ai_quality_assessments_artifact_version_id_artifact_content_idx" ON "ai_quality_assessments"("artifact_version_id", "artifact_content_hash");
CREATE INDEX "ai_quality_evidence_assessment_id_idx" ON "ai_quality_evidence"("assessment_id");
CREATE INDEX "ai_quality_evidence_source_artifact_version_id_idx" ON "ai_quality_evidence"("source_artifact_version_id");
CREATE INDEX "ai_quality_reviews_artifact_version_id_artifact_content_has_idx" ON "ai_quality_reviews"("artifact_version_id", "artifact_content_hash");
CREATE INDEX "ai_release_evaluations_action_artifact_version_id_artifact__idx" ON "ai_release_evaluations"("action", "artifact_version_id", "artifact_content_hash", "evaluated_at");
CREATE INDEX "ai_prompt_snapshots_assessment_id_idx" ON "ai_prompt_snapshots"("assessment_id");
CREATE INDEX "ai_model_snapshots_assessment_id_idx" ON "ai_model_snapshots"("assessment_id");

CREATE OR REPLACE FUNCTION public.ai_quality_history_immutable_update_reject_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'AI quality history is immutable: UPDATE is not permitted' USING ERRCODE = '0A000';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ai_quality_history_immutable_delete_reject_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'AI quality history is immutable: DELETE is not permitted' USING ERRCODE = '0A000';
END;
$fn$;

CREATE TRIGGER ai_quality_assessments_immutable_update_trg BEFORE UPDATE ON "ai_quality_assessments" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_update_reject_fn();
CREATE TRIGGER ai_quality_assessments_immutable_delete_trg BEFORE DELETE ON "ai_quality_assessments" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_delete_reject_fn();
CREATE TRIGGER ai_quality_evidence_immutable_update_trg BEFORE UPDATE ON "ai_quality_evidence" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_update_reject_fn();
CREATE TRIGGER ai_quality_evidence_immutable_delete_trg BEFORE DELETE ON "ai_quality_evidence" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_delete_reject_fn();
CREATE TRIGGER ai_quality_reviews_immutable_update_trg BEFORE UPDATE ON "ai_quality_reviews" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_update_reject_fn();
CREATE TRIGGER ai_quality_reviews_immutable_delete_trg BEFORE DELETE ON "ai_quality_reviews" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_delete_reject_fn();
CREATE TRIGGER ai_release_evaluations_immutable_update_trg BEFORE UPDATE ON "ai_release_evaluations" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_update_reject_fn();
CREATE TRIGGER ai_release_evaluations_immutable_delete_trg BEFORE DELETE ON "ai_release_evaluations" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_delete_reject_fn();
CREATE TRIGGER ai_prompt_snapshots_immutable_update_trg BEFORE UPDATE ON "ai_prompt_snapshots" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_update_reject_fn();
CREATE TRIGGER ai_prompt_snapshots_immutable_delete_trg BEFORE DELETE ON "ai_prompt_snapshots" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_delete_reject_fn();
CREATE TRIGGER ai_model_snapshots_immutable_update_trg BEFORE UPDATE ON "ai_model_snapshots" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_update_reject_fn();
CREATE TRIGGER ai_model_snapshots_immutable_delete_trg BEFORE DELETE ON "ai_model_snapshots" FOR EACH ROW EXECUTE FUNCTION public.ai_quality_history_immutable_delete_reject_fn();
