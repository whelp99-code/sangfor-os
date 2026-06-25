-- Phase 11 connector / observability tables

CREATE TABLE IF NOT EXISTS "codex_tasks" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "github_issue_id" TEXT,
    "pull_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "codex_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "codex_task_logs" (
    "id" TEXT NOT NULL,
    "codex_task_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codex_task_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cursor_sessions" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "branch_name" TEXT NOT NULL,
    "task_summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "build_status" TEXT,
    "test_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "cursor_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_issues" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "codex_task_id" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "github_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "run_timeline_items" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_timeline_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_events" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "codex_tasks_command_run_id_idx" ON "codex_tasks"("command_run_id");
CREATE INDEX IF NOT EXISTS "codex_tasks_status_idx" ON "codex_tasks"("status");
CREATE INDEX IF NOT EXISTS "codex_task_logs_codex_task_id_idx" ON "codex_task_logs"("codex_task_id");
CREATE INDEX IF NOT EXISTS "cursor_sessions_command_run_id_idx" ON "cursor_sessions"("command_run_id");
CREATE INDEX IF NOT EXISTS "cursor_sessions_status_idx" ON "cursor_sessions"("status");
CREATE INDEX IF NOT EXISTS "github_issues_command_run_id_idx" ON "github_issues"("command_run_id");
CREATE INDEX IF NOT EXISTS "github_issues_codex_task_id_idx" ON "github_issues"("codex_task_id");
CREATE INDEX IF NOT EXISTS "run_timeline_items_command_run_id_sort_order_idx" ON "run_timeline_items"("command_run_id", "sort_order");
CREATE INDEX IF NOT EXISTS "notification_events_command_run_id_idx" ON "notification_events"("command_run_id");

DO $$ BEGIN
  ALTER TABLE "codex_task_logs" ADD CONSTRAINT "codex_task_logs_codex_task_id_fkey" FOREIGN KEY ("codex_task_id") REFERENCES "codex_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
