-- Domain-axis workflow tables (inherited from feat-domain-followups; previously
-- applied via db push without a migration). Added here so migrate deploy reaches
-- schema parity. Belongs to the domain-axis feature, not tax-invoice automation.

-- CreateTable
CREATE TABLE "domain_memories" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "memory_type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "value_json" JSONB NOT NULL,
    "outcome" TEXT,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "confidence" INTEGER NOT NULL DEFAULT 80,
    "status" TEXT NOT NULL DEFAULT 'active',
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_decision_logs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "case_ref" TEXT,
    "decision_type" TEXT NOT NULL,
    "input_json" JSONB,
    "output_json" JSONB,
    "color_gate_json" JSONB,
    "human_edit_json" JSONB,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_memories_project_id_domain_status_idx" ON "domain_memories"("project_id", "domain", "status");
CREATE UNIQUE INDEX "domain_memories_project_id_domain_memory_type_key_key" ON "domain_memories"("project_id", "domain", "memory_type", "key");
CREATE INDEX "domain_decision_logs_project_id_domain_decision_type_create_idx" ON "domain_decision_logs"("project_id", "domain", "decision_type", "created_at");
CREATE INDEX "domain_decision_logs_domain_case_ref_idx" ON "domain_decision_logs"("domain", "case_ref");

-- AddForeignKey
ALTER TABLE "domain_memories" ADD CONSTRAINT "domain_memories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_decision_logs" ADD CONSTRAINT "domain_decision_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
