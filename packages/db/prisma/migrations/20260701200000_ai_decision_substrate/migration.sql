-- S1 AI Decision Substrate — DomainDecisionLog 확장 (순수 추가, 전부 nullable)
-- 기존 컬럼/의미 변경 없음. ADD COLUMN + CREATE INDEX + enum type only.

-- CreateEnum
CREATE TYPE "decision_actor" AS ENUM (
  'sales','presales','cfo','marketing','engineer','commercial_approval','deal_registration'
);

-- CreateEnum
CREATE TYPE "risk_tier" AS ENUM ('T0','T1','T2');

-- AlterTable (additive; all nullable — no default, no backfill)
ALTER TABLE "domain_decision_logs" ADD COLUMN "actor" "decision_actor";
ALTER TABLE "domain_decision_logs" ADD COLUMN "action_type" text;
ALTER TABLE "domain_decision_logs" ADD COLUMN "risk_tier" "risk_tier";
ALTER TABLE "domain_decision_logs" ADD COLUMN "policy_version" text;
ALTER TABLE "domain_decision_logs" ADD COLUMN "predicted_confidence" double precision;
ALTER TABLE "domain_decision_logs" ADD COLUMN "model_version" text;
ALTER TABLE "domain_decision_logs" ADD COLUMN "cost" decimal(10,4);
ALTER TABLE "domain_decision_logs" ADD COLUMN "rollback_of" text;
ALTER TABLE "domain_decision_logs" ADD COLUMN "resolved_at" timestamp(3);
ALTER TABLE "domain_decision_logs" ADD COLUMN "resolved_by" text;

-- CreateIndex (calibration groupBy). [domain, case_ref] index already exists.
CREATE INDEX "domain_decision_logs_actor_action_type_created_at_idx"
  ON "domain_decision_logs" ("actor", "action_type", "created_at");
