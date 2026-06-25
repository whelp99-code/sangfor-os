-- Phase 15: improvement candidates for self-improving loop (additive)
CREATE TABLE "improvement_candidates" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "suggested_module" TEXT,
    "suggested_action" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "command_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "improvement_candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "improvement_candidates_status_created_at_idx"
  ON "improvement_candidates"("status", "created_at");

ALTER TABLE "improvement_candidates" ADD CONSTRAINT "improvement_candidates_command_run_id_fkey"
  FOREIGN KEY ("command_run_id") REFERENCES "command_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
