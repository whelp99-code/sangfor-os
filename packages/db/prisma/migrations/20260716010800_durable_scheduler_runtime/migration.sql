-- CreateEnum
CREATE TYPE "SchedulerJobKind" AS ENUM ('interval', 'cron', 'manual');

-- CreateEnum
CREATE TYPE "SchedulerRunStatus" AS ENUM ('QUEUED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRY_WAIT', 'SKIPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "scheduler_jobs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "job_key" TEXT NOT NULL,
    "handler_key" TEXT NOT NULL,
    "schedule_kind" "SchedulerJobKind" NOT NULL,
    "schedule_expression" TEXT NOT NULL,
    "payload_json" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "backoff_seconds" INTEGER NOT NULL DEFAULT 60,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 300,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_runs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "SchedulerRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "result_json" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_run_attempts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "worker_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error_code" TEXT,
    "receipt_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_run_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_jobs_company_id_scope_key_job_key_key" ON "scheduler_jobs"("company_id", "scope_key", "job_key");

-- CreateIndex
CREATE INDEX "scheduler_jobs_enabled_next_run_at_idx" ON "scheduler_jobs"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "scheduler_jobs_company_id_project_id_idx" ON "scheduler_jobs"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "scheduler_jobs_handler_key_idx" ON "scheduler_jobs"("handler_key");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_runs_idempotency_key_key" ON "scheduler_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "scheduler_runs_status_scheduled_for_idx" ON "scheduler_runs"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "scheduler_runs_job_id_idx" ON "scheduler_runs"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_runs_job_id_scheduled_for_key" ON "scheduler_runs"("job_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "scheduler_run_attempts_run_id_idx" ON "scheduler_run_attempts"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_run_attempts_run_id_attempt_number_key" ON "scheduler_run_attempts"("run_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "scheduler_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduler_run_attempts" ADD CONSTRAINT "scheduler_run_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scheduler_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
