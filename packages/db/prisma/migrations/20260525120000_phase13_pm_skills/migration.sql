-- Phase 13 PM Skills / Orchestrator (additive)

CREATE TABLE "skill_catalog_items" (
    "id" TEXT NOT NULL,
    "skill_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "plugin" TEXT,
    "phases_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "usage" TEXT,
    "agent_usage_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_catalog_items_skill_key_key" ON "skill_catalog_items"("skill_key");

CREATE TABLE "skill_runs" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "skill_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "execution_mode" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "raw_output_json" JSONB,
    "normalized_output_json" JSONB,
    "normalize_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "skill_runs_command_run_id_sort_order_idx" ON "skill_runs"("command_run_id", "sort_order");

CREATE TABLE "work_breakdown_items" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "skill_run_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_area" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL DEFAULT 'low',
    "estimated_hours" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "acceptance_criteria" JSONB,
    "test_criteria" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_breakdown_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_breakdown_items_command_run_id_sort_order_idx" ON "work_breakdown_items"("command_run_id", "sort_order");

CREATE TABLE "agent_assignment_rules" (
    "id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_assignment_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_assignment_rules_rule_key_key" ON "agent_assignment_rules"("rule_key");

ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_command_run_id_fkey" FOREIGN KEY ("command_run_id") REFERENCES "command_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_breakdown_items" ADD CONSTRAINT "work_breakdown_items_command_run_id_fkey" FOREIGN KEY ("command_run_id") REFERENCES "command_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_breakdown_items" ADD CONSTRAINT "work_breakdown_items_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
