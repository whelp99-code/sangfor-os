-- U034: expand the single DealQualification record for BANT plus Technical-Fit snapshots.
-- Legacy BANT rows remain untouched; U040 owns legacy labeling/backfill and U045 owns scoring.

ALTER TABLE "deal_qualifications" ADD COLUMN "technical_fit_score" INTEGER;
ALTER TABLE "deal_qualifications" ADD COLUMN "score_total" INTEGER;
ALTER TABLE "deal_qualifications" ADD COLUMN "scoring_version" TEXT;
ALTER TABLE "deal_qualifications" ADD COLUMN "revision" INTEGER;
ALTER TABLE "deal_qualifications" ADD COLUMN "assessed_by_assignment_id" TEXT;
ALTER TABLE "deal_qualifications" ADD COLUMN "assessed_at" TIMESTAMP(3);
ALTER TABLE "deal_qualifications" ADD COLUMN "updated_at" TIMESTAMP(3);
ALTER TABLE "deal_qualifications" ADD COLUMN "snapshot_hash" TEXT;

ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_assessed_by_assignment_id_fkey"
  FOREIGN KEY ("assessed_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_budget_score_bant_tf_range_chk"
  CHECK ("budget_score" >= 0 AND "budget_score" <= 20) NOT VALID;
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_authority_score_bant_tf_range_chk"
  CHECK ("authority_score" >= 0 AND "authority_score" <= 20) NOT VALID;
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_need_score_bant_tf_range_chk"
  CHECK ("need_score" >= 0 AND "need_score" <= 24) NOT VALID;
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_timeline_score_bant_tf_range_chk"
  CHECK ("timeline_score" >= 0 AND "timeline_score" <= 16) NOT VALID;
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_technical_fit_score_bant_tf_range_chk"
  CHECK ("technical_fit_score" >= 0 AND "technical_fit_score" <= 20) NOT VALID;
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_score_total_bant_tf_range_chk"
  CHECK ("score_total" >= 0 AND "score_total" <= 100) NOT VALID;
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_revision_bant_tf_positive_chk"
  CHECK ("revision" IS NULL OR "revision" > 0) NOT VALID;

CREATE INDEX "deal_qualifications_assessed_by_assignment_id_idx" ON "deal_qualifications"("assessed_by_assignment_id");
