-- Phase 4-9 schema extensions

-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "url" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "ci_status" TEXT;

-- AlterTable
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "command_run_id" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "input_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "output_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "latency_ms" INTEGER;

-- AlterTable connector_registry (Phase 3 placeholder expansion)
ALTER TABLE "connector_registry" ADD COLUMN IF NOT EXISTS "display_name" TEXT NOT NULL DEFAULT 'Connector';
ALTER TABLE "connector_registry" ADD COLUMN IF NOT EXISTS "connector_type" TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE "connector_registry" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE IF NOT EXISTS "intent_analyses" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "intent_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intent_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "risk_analyses" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "risk_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_messages" (
    "id" TEXT NOT NULL,
    "agent_assignment_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_decision_logs" (
    "id" TEXT NOT NULL,
    "agent_assignment_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_decision_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "pull_request_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "branches" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "head_sha" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "build_runs" (
    "id" TEXT NOT NULL,
    "code_change_id" TEXT,
    "command_run_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "log_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "build_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "test_runs" (
    "id" TEXT NOT NULL,
    "build_run_id" TEXT,
    "command_run_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "validation_plans" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "validation_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "validation_checks" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "check_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "validation_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quality_gates" (
    "id" TEXT NOT NULL,
    "gate_key" TEXT NOT NULL,
    "required_checks" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quality_gates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cost_events" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "source" TEXT NOT NULL,
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mail_accounts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'outlook',
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'mock',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mail_messages" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "body_preview" TEXT,
    "group_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portal_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'portal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_tasks_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "intent_analyses_command_run_id_key" ON "intent_analyses"("command_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "risk_analyses_command_run_id_key" ON "risk_analyses"("command_run_id");
CREATE INDEX IF NOT EXISTS "agent_messages_agent_assignment_id_idx" ON "agent_messages"("agent_assignment_id");
CREATE INDEX IF NOT EXISTS "agent_decision_logs_agent_assignment_id_idx" ON "agent_decision_logs"("agent_assignment_id");
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "branches_repository_id_name_key" ON "branches"("repository_id", "name");
CREATE INDEX IF NOT EXISTS "build_runs_command_run_id_idx" ON "build_runs"("command_run_id");
CREATE INDEX IF NOT EXISTS "test_runs_command_run_id_idx" ON "test_runs"("command_run_id");
CREATE INDEX IF NOT EXISTS "validation_checks_plan_id_idx" ON "validation_checks"("plan_id");
CREATE UNIQUE INDEX IF NOT EXISTS "quality_gates_gate_key_key" ON "quality_gates"("gate_key");
CREATE INDEX IF NOT EXISTS "cost_events_command_run_id_idx" ON "cost_events"("command_run_id");
CREATE INDEX IF NOT EXISTS "mail_messages_account_id_idx" ON "mail_messages"("account_id");
CREATE INDEX IF NOT EXISTS "portal_tasks_project_id_status_idx" ON "portal_tasks"("project_id", "status");
CREATE INDEX IF NOT EXISTS "llm_calls_command_run_id_idx" ON "llm_calls"("command_run_id");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "intent_analyses" ADD CONSTRAINT "intent_analyses_command_run_id_fkey" FOREIGN KEY ("command_run_id") REFERENCES "command_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_command_run_id_fkey" FOREIGN KEY ("command_run_id") REFERENCES "command_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_agent_assignment_id_fkey" FOREIGN KEY ("agent_assignment_id") REFERENCES "agent_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_decision_logs" ADD CONSTRAINT "agent_decision_logs_agent_assignment_id_fkey" FOREIGN KEY ("agent_assignment_id") REFERENCES "agent_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "branches" ADD CONSTRAINT "branches_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "build_runs" ADD CONSTRAINT "build_runs_code_change_id_fkey" FOREIGN KEY ("code_change_id") REFERENCES "code_changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_build_run_id_fkey" FOREIGN KEY ("build_run_id") REFERENCES "build_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "validation_checks" ADD CONSTRAINT "validation_checks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "validation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_command_run_id_fkey" FOREIGN KEY ("command_run_id") REFERENCES "command_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
