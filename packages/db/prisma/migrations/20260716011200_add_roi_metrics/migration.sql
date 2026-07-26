-- CreateEnum
CREATE TYPE "MetricDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "MetricEvidenceState" AS ENUM ('MEASURED', 'PARTIAL', 'UNKNOWN', 'COLLECTING', 'SOURCE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AiExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiProviderAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "AiCostKind" AS ENUM ('ESTIMATE', 'INVOICE');

-- CreateTable
CREATE TABLE "metric_definitions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_contract_version" TEXT NOT NULL,
    "provenance_contract" JSONB NOT NULL,
    "freshness_seconds" INTEGER NOT NULL,
    "status" "MetricDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definition_hash" TEXT NOT NULL,
    "created_by_assignment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_benchmark_versions" (
    "id" TEXT NOT NULL,
    "metric_definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition_revision" INTEGER NOT NULL,
    "baseline_value" DECIMAL(30,8) NOT NULL,
    "artifact_version_id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "approval_request_revision" INTEGER NOT NULL,
    "artifact_hash_snapshot" TEXT NOT NULL,
    "policy_hash_snapshot" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "supersedes_benchmark_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_benchmark_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_daily_snapshots" (
    "id" TEXT NOT NULL,
    "metric_definition_id" TEXT NOT NULL,
    "benchmark_version_id" TEXT,
    "definition_revision" INTEGER NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "state" "MetricEvidenceState" NOT NULL,
    "value" DECIMAL(30,8),
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "source_count" INTEGER NOT NULL DEFAULT 0,
    "source_ids_hash" TEXT NOT NULL,
    "provenance_hash" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "fresh_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "artifact_version_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "AiExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "pricing_contract_version" TEXT NOT NULL,
    "created_by_assignment_id" TEXT NOT NULL,
    "workflow_run_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_attempts" (
    "id" TEXT NOT NULL,
    "ai_execution_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "provider_request_id_digest" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "status" "AiProviderAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "safe_error_code" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_execution_costs" (
    "id" TEXT NOT NULL,
    "ai_execution_id" TEXT NOT NULL,
    "provider_attempt_id" TEXT NOT NULL,
    "kind" "AiCostKind" NOT NULL DEFAULT 'ESTIMATE',
    "amount" DECIMAL(30,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricing_version" TEXT NOT NULL,
    "source_key_digest" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_execution_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_definitions_company_id_status_idx" ON "metric_definitions"("company_id", "status");
CREATE INDEX "metric_definitions_source_kind_idx" ON "metric_definitions"("source_kind");
CREATE UNIQUE INDEX "metric_definitions_company_id_metric_key_revision_key" ON "metric_definitions"("company_id", "metric_key", "revision");
CREATE UNIQUE INDEX "metric_definitions_company_id_metric_key_definition_hash_key" ON "metric_definitions"("company_id", "metric_key", "definition_hash");

-- CreateIndex
CREATE UNIQUE INDEX "metric_benchmark_versions_metric_definition_id_version_key" ON "metric_benchmark_versions"("metric_definition_id", "version");
CREATE UNIQUE INDEX "metric_benchmark_versions_id_metric_definition_id_key" ON "metric_benchmark_versions"("id", "metric_definition_id");
CREATE UNIQUE INDEX "metric_benchmark_versions_supersedes_benchmark_version_id_key" ON "metric_benchmark_versions"("supersedes_benchmark_version_id");
CREATE INDEX "metric_benchmark_versions_metric_definition_id_effective_f_idx" ON "metric_benchmark_versions"("metric_definition_id", "effective_from", "approved_at", "version", "id");
CREATE INDEX "metric_benchmark_versions_approval_request_id_approval_requ_idx" ON "metric_benchmark_versions"("approval_request_id", "approval_request_revision");

-- CreateIndex
CREATE UNIQUE INDEX "metric_daily_snapshots_metric_definition_id_snapshot_date_key" ON "metric_daily_snapshots"("metric_definition_id", "snapshot_date");
CREATE INDEX "metric_daily_snapshots_metric_definition_id_as_of_idx" ON "metric_daily_snapshots"("metric_definition_id", "as_of");
CREATE INDEX "metric_daily_snapshots_state_as_of_idx" ON "metric_daily_snapshots"("state", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "ai_executions_project_id_idempotency_key_key" ON "ai_executions"("project_id", "idempotency_key");
CREATE INDEX "ai_executions_company_id_project_id_status_started_at_idx" ON "ai_executions"("company_id", "project_id", "status", "started_at");
CREATE INDEX "ai_executions_artifact_version_id_idx" ON "ai_executions"("artifact_version_id");
CREATE INDEX "ai_executions_workflow_run_id_idx" ON "ai_executions"("workflow_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_attempts_ai_execution_id_attempt_number_key" ON "ai_provider_attempts"("ai_execution_id", "attempt_number");
CREATE UNIQUE INDEX "ai_provider_attempts_id_ai_execution_id_key" ON "ai_provider_attempts"("id", "ai_execution_id");
CREATE INDEX "ai_provider_attempts_ai_execution_id_status_idx" ON "ai_provider_attempts"("ai_execution_id", "status");
CREATE INDEX "ai_provider_attempts_provider_model_started_at_idx" ON "ai_provider_attempts"("provider", "model", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_execution_costs_provider_attempt_id_kind_source_key_dige_key" ON "ai_execution_costs"("provider_attempt_id", "kind", "source_key_digest");
CREATE INDEX "ai_execution_costs_ai_execution_id_occurred_at_idx" ON "ai_execution_costs"("ai_execution_id", "occurred_at");
CREATE INDEX "ai_execution_costs_provider_attempt_id_kind_idx" ON "ai_execution_costs"("provider_attempt_id", "kind");

-- AddForeignKey
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_created_by_assignment_id_fkey" FOREIGN KEY ("created_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_benchmark_versions" ADD CONSTRAINT "metric_benchmark_versions_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_benchmark_versions" ADD CONSTRAINT "metric_benchmark_versions_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_benchmark_versions" ADD CONSTRAINT "metric_benchmark_versions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_benchmark_versions" ADD CONSTRAINT "metric_benchmark_versions_supersedes_benchmark_version_id_fkey" FOREIGN KEY ("supersedes_benchmark_version_id") REFERENCES "metric_benchmark_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_daily_snapshots" ADD CONSTRAINT "metric_daily_snapshots_metric_definition_id_fkey" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "metric_daily_snapshots" ADD CONSTRAINT "metric_daily_snapshots_benchmark_version_id_fkey" FOREIGN KEY ("benchmark_version_id") REFERENCES "metric_benchmark_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_created_by_assignment_id_fkey" FOREIGN KEY ("created_by_assignment_id") REFERENCES "user_company_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_costs" ADD CONSTRAINT "ai_execution_costs_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_execution_costs" ADD CONSTRAINT "ai_execution_costs_provider_attempt_id_fkey" FOREIGN KEY ("provider_attempt_id") REFERENCES "ai_provider_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
