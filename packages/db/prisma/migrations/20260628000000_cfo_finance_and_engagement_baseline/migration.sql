-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('DRAFT', 'GATE_REVIEW', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "opportunity_stage" AS ENUM ('LEAD', 'QUALIFIED', 'PROPOSAL', 'POC', 'NEGOTIATION', 'WON', 'LOST');

-- DropForeignKey
ALTER TABLE "mail_derived_candidates" DROP CONSTRAINT "mail_derived_candidates_knowledge_document_id_fkey";

-- DropIndex
DROP INDEX "notification_events_command_run_id_idx";

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "action",
DROP COLUMN "metadata",
ADD COLUMN     "details" JSONB,
ADD COLUMN     "event_hash" TEXT,
ADD COLUMN     "event_type" TEXT NOT NULL,
ADD COLUMN     "previous_hash" TEXT,
ADD COLUMN     "resource_id" TEXT,
ADD COLUMN     "resource_type" TEXT NOT NULL,
ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "generated_documents" ADD COLUMN     "engagement_id" TEXT,
ADD COLUMN     "opportunity_id" TEXT;

-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN     "access_token" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "refresh_token" TEXT,
ADD COLUMN     "tenant_id" TEXT,
ADD COLUMN     "token_expires_at" TIMESTAMP(3),
ADD COLUMN     "token_scope" TEXT;

-- AlterTable
ALTER TABLE "mail_messages" ADD COLUMN     "conversation_id" TEXT,
ADD COLUMN     "direction" TEXT,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "received_at" TIMESTAMP(3),
ADD COLUMN     "to_email" TEXT;

-- AlterTable
ALTER TABLE "notification_events" DROP COLUMN "command_run_id",
DROP COLUMN "created_at",
DROP COLUMN "message",
ADD COLUMN     "channel" TEXT NOT NULL,
ADD COLUMN     "company_id" TEXT NOT NULL,
ADD COLUMN     "payload_json" JSONB NOT NULL,
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "opportunities" DROP COLUMN "stage",
ADD COLUMN     "stage" "opportunity_stage" NOT NULL DEFAULT 'LEAD';

-- AlterTable
ALTER TABLE "opportunity_stage_events" DROP COLUMN "from_stage",
ADD COLUMN     "from_stage" "opportunity_stage",
DROP COLUMN "to_stage",
ADD COLUMN     "to_stage" "opportunity_stage" NOT NULL;

-- AlterTable
ALTER TABLE "poc_projects" ADD COLUMN     "engagement_id" TEXT,
ADD COLUMN     "opportunity_id" TEXT;

-- AlterTable
ALTER TABLE "poc_result_reports" DROP COLUMN "status",
ADD COLUMN     "status" "quote_status" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "deal_qualifications" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "budget_score" INTEGER NOT NULL,
    "authority_score" INTEGER NOT NULL,
    "need_score" INTEGER NOT NULL,
    "timeline_score" INTEGER NOT NULL,
    "weighted_score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "qualified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualified_by" TEXT,
    "notes" TEXT,

    CONSTRAINT "deal_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_evidence_links" (
    "id" TEXT NOT NULL,
    "mail_derived_candidate_id" TEXT NOT NULL,
    "target_entity_type" TEXT NOT NULL,
    "target_entity_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL DEFAULT 'related',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_notification_events" (
    "id" TEXT NOT NULL,
    "command_run_id" TEXT,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT DEFAULT 'active',
    "client" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_invoices" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "vat" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "depositAmount" INTEGER,
    "depositStatus" TEXT DEFAULT '미수',
    "depositDate" TIMESTAMP(3),
    "issue_date" TIMESTAMP(3),
    "buyer" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expenses" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "expenseName" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "vat" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT DEFAULT '기타',
    "vendor" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofType" TEXT,
    "paymentMethod" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_cashflows" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "counterparty" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "cashChange" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "out_account" TEXT,
    "in_account" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance_after" INTEGER,
    "memo" TEXT,

    CONSTRAINT "finance_cashflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_subscriptions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "vendor" TEXT,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "cycle" TEXT NOT NULL DEFAULT 'monthly',
    "category" TEXT,
    "next_billing_date" TIMESTAMP(3) NOT NULL,
    "payment_method" TEXT,
    "notify_days_before" INTEGER NOT NULL DEFAULT 7,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_ledger_entries" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL DEFAULT '',
    "debit_account" TEXT NOT NULL,
    "credit_account" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "reference_type" TEXT,
    "memo" TEXT,

    CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_month_closes" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "total_revenue" INTEGER,
    "total_expense" INTEGER,
    "net_income" INTEGER,
    "uncategorized_count" INTEGER,
    "notes" TEXT,

    CONSTRAINT "finance_month_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_tax_invoices" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "project_id" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'sales',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "supplier_corp_num" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "buyer_corp_num" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "supply_amount" INTEGER NOT NULL DEFAULT 0,
    "vat_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "raw_response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_tax_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_chat_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '새 대화',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "content" TEXT NOT NULL DEFAULT '',
    "tool_name" TEXT,
    "tool_result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_accounts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'bank',
    "organization" TEXT NOT NULL DEFAULT '',
    "account_name" TEXT NOT NULL,
    "account_num" TEXT,
    "connected_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "color_agent_profiles" (
    "id" TEXT NOT NULL,
    "agent_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "color_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_color_agents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_color_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kanban_handoff_cards" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source_agent_id" TEXT,
    "target_agent_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kanban_handoff_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_events" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handoff_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_service_line_items" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_service_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_assets" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "purchase_date" TIMESTAMP(3),
    "warranty_end" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_sla_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responseTimeHrs" INTEGER,
    "resolutionTimeHrs" INTEGER,
    "severity" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_certifications" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "level" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineer_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_opportunities" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "renewal_type" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "renewed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_golden_answers" (
    "id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "rationale" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_golden_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_quality_results" (
    "id" TEXT NOT NULL,
    "golden_answer_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "model_answer" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_quality_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_company_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_company_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_change_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_role" TEXT NOT NULL,
    "to_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_editions" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "product_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_skus" (
    "id" TEXT NOT NULL,
    "edition_id" TEXT NOT NULL,
    "sku_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2),
    "unit_cost" DECIMAL(12,2),
    "license_metric" TEXT,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_metrics" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "license_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sizing_templates" (
    "id" TEXT NOT NULL,
    "product_family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config_json" JSONB NOT NULL,

    CONSTRAINT "sizing_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compatibility_rules" (
    "id" TEXT NOT NULL,
    "source_sku_id" TEXT NOT NULL,
    "target_sku_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "config_json" JSONB NOT NULL,

    CONSTRAINT "compatibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "total_revenue" DECIMAL(14,2) NOT NULL,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "margin_pct" DECIMAL(8,2) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "margin_pct" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_requests" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "requested_discount" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by" TEXT,

    CONSTRAINT "discount_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_requests" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "request_type" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "details_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,

    CONSTRAINT "vendor_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT,

    CONSTRAINT "vendor_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_projects" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "project_id" TEXT,
    "customer_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "amount" DECIMAL(12,2),
    "amount_quote_id" TEXT,
    "summary_markdown" TEXT,
    "converted_at" TIMESTAMP(3),
    "converted_from_stage" TEXT,
    "sow_approved_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "delivery_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_checklist_items" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "delivery_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_notes" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT,
    "engagement_id" TEXT,
    "customer_id" TEXT,
    "mail_insight_thread_id" TEXT,
    "title" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body_markdown" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "sla_deadline" TIMESTAMP(3),
    "assigned_to" TEXT,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_escalations" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "resolution" TEXT,

    CONSTRAINT "vendor_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_licenses" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "license_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "asset_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_contracts" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "maintenance_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "model_id" TEXT,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "allowed_data_classification" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_datasets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "golden_answer_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_evaluation_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_runs" (
    "id" TEXT NOT NULL,
    "prompt_template_id" TEXT NOT NULL,
    "input_json" JSONB NOT NULL,
    "output_json" JSONB NOT NULL,
    "tokens_used" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_by" TEXT,

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_access_events" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_type" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "color_review_requirements" (
    "id" TEXT NOT NULL,
    "handoff_card_id" TEXT NOT NULL,
    "color_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "color_review_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "color_agent_decisions" (
    "id" TEXT NOT NULL,
    "handoff_card_id" TEXT NOT NULL,
    "color_key" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "decided_by" TEXT,

    CONSTRAINT "color_agent_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_qualifications_opportunity_id_key" ON "deal_qualifications"("opportunity_id");

-- CreateIndex
CREATE INDEX "mail_evidence_links_mail_derived_candidate_id_idx" ON "mail_evidence_links"("mail_derived_candidate_id");

-- CreateIndex
CREATE INDEX "mail_evidence_links_target_entity_type_target_entity_id_idx" ON "mail_evidence_links"("target_entity_type", "target_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_evidence_links_mail_derived_candidate_id_target_entity_key" ON "mail_evidence_links"("mail_derived_candidate_id", "target_entity_type", "target_entity_id", "link_type");

-- CreateIndex
CREATE INDEX "command_notification_events_command_run_id_idx" ON "command_notification_events"("command_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_month_closes_year_month_key" ON "finance_month_closes"("year", "month");

-- CreateIndex
CREATE INDEX "finance_chat_messages_session_id_idx" ON "finance_chat_messages"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "color_agent_profiles_agent_key_key" ON "color_agent_profiles"("agent_key");

-- CreateIndex
CREATE UNIQUE INDEX "project_color_agents_project_id_agent_id_key" ON "project_color_agents"("project_id", "agent_id");

-- CreateIndex
CREATE INDEX "kanban_handoff_cards_project_id_status_idx" ON "kanban_handoff_cards"("project_id", "status");

-- CreateIndex
CREATE INDEX "handoff_events_card_id_idx" ON "handoff_events"("card_id");

-- CreateIndex
CREATE INDEX "quote_service_line_items_opportunity_id_idx" ON "quote_service_line_items"("opportunity_id");

-- CreateIndex
CREATE INDEX "customer_assets_customer_id_idx" ON "customer_assets"("customer_id");

-- CreateIndex
CREATE INDEX "renewal_opportunities_customer_id_idx" ON "renewal_opportunities"("customer_id");

-- CreateIndex
CREATE INDEX "renewal_opportunities_status_idx" ON "renewal_opportunities"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_golden_answers_question_key_version_key" ON "ai_golden_answers"("question_key", "version");

-- CreateIndex
CREATE INDEX "ai_quality_results_golden_answer_id_idx" ON "ai_quality_results"("golden_answer_id");

-- CreateIndex
CREATE INDEX "ai_quality_results_run_id_idx" ON "ai_quality_results"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "companies_tenant_id_idx" ON "companies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_roles_user_id_company_id_role_key" ON "user_company_roles"("user_id", "company_id", "role");

-- CreateIndex
CREATE INDEX "role_change_requests_user_id_status_idx" ON "role_change_requests"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "personas_company_id_key_key" ON "personas"("company_id", "key");

-- CreateIndex
CREATE INDEX "product_editions_family_id_idx" ON "product_editions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_skus_sku_code_key" ON "product_skus"("sku_code");

-- CreateIndex
CREATE INDEX "product_skus_edition_id_idx" ON "product_skus"("edition_id");

-- CreateIndex
CREATE UNIQUE INDEX "license_metrics_key_key" ON "license_metrics"("key");

-- CreateIndex
CREATE INDEX "sizing_templates_product_family_id_idx" ON "sizing_templates"("product_family_id");

-- CreateIndex
CREATE INDEX "compatibility_rules_source_sku_id_idx" ON "compatibility_rules"("source_sku_id");

-- CreateIndex
CREATE INDEX "compatibility_rules_target_sku_id_idx" ON "compatibility_rules"("target_sku_id");

-- CreateIndex
CREATE INDEX "quotes_opportunity_id_idx" ON "quotes"("opportunity_id");

-- CreateIndex
CREATE INDEX "quotes_company_id_status_idx" ON "quotes"("company_id", "status");

-- CreateIndex
CREATE INDEX "quote_line_items_quote_id_idx" ON "quote_line_items"("quote_id");

-- CreateIndex
CREATE INDEX "discount_requests_quote_id_idx" ON "discount_requests"("quote_id");

-- CreateIndex
CREATE INDEX "vendor_requests_opportunity_id_idx" ON "vendor_requests"("opportunity_id");

-- CreateIndex
CREATE INDEX "vendor_requests_status_idx" ON "vendor_requests"("status");

-- CreateIndex
CREATE INDEX "vendor_request_events_request_id_idx" ON "vendor_request_events"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_projects_opportunity_id_key" ON "delivery_projects"("opportunity_id");

-- CreateIndex
CREATE INDEX "delivery_checklist_items_delivery_id_idx" ON "delivery_checklist_items"("delivery_id");

-- CreateIndex
CREATE INDEX "meeting_notes_opportunity_id_idx" ON "meeting_notes"("opportunity_id");

-- CreateIndex
CREATE INDEX "meeting_notes_engagement_id_idx" ON "meeting_notes"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_notes_opportunity_id_mail_insight_thread_id_key" ON "meeting_notes"("opportunity_id", "mail_insight_thread_id");

-- CreateIndex
CREATE INDEX "support_cases_customer_id_idx" ON "support_cases"("customer_id");

-- CreateIndex
CREATE INDEX "support_cases_status_severity_idx" ON "support_cases"("status", "severity");

-- CreateIndex
CREATE INDEX "vendor_escalations_case_id_idx" ON "vendor_escalations"("case_id");

-- CreateIndex
CREATE INDEX "asset_licenses_asset_id_idx" ON "asset_licenses"("asset_id");

-- CreateIndex
CREATE INDEX "subscriptions_asset_id_idx" ON "subscriptions"("asset_id");

-- CreateIndex
CREATE INDEX "subscriptions_end_date_status_idx" ON "subscriptions"("end_date", "status");

-- CreateIndex
CREATE INDEX "maintenance_contracts_asset_id_idx" ON "maintenance_contracts"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_key_key" ON "ai_prompt_templates"("key");

-- CreateIndex
CREATE INDEX "ai_prompt_runs_prompt_template_id_idx" ON "ai_prompt_runs"("prompt_template_id");

-- CreateIndex
CREATE INDEX "artifact_access_events_artifact_id_idx" ON "artifact_access_events"("artifact_id");

-- CreateIndex
CREATE INDEX "color_review_requirements_handoff_card_id_idx" ON "color_review_requirements"("handoff_card_id");

-- CreateIndex
CREATE INDEX "color_agent_decisions_handoff_card_id_idx" ON "color_agent_decisions"("handoff_card_id");

-- CreateIndex
CREATE INDEX "audit_logs_event_type_created_at_idx" ON "audit_logs"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "generated_documents_opportunity_id_idx" ON "generated_documents"("opportunity_id");

-- CreateIndex
CREATE INDEX "generated_documents_engagement_id_idx" ON "generated_documents"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_external_id_key" ON "mail_messages"("external_id");

-- CreateIndex
CREATE INDEX "mail_messages_conversation_id_idx" ON "mail_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "notification_events_company_id_event_type_idx" ON "notification_events"("company_id", "event_type");

-- CreateIndex
CREATE INDEX "opportunities_project_id_stage_idx" ON "opportunities"("project_id", "stage");

-- CreateIndex
CREATE INDEX "poc_projects_opportunity_id_idx" ON "poc_projects"("opportunity_id");

-- AddForeignKey
ALTER TABLE "deal_qualifications" ADD CONSTRAINT "deal_qualifications_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_evidence_links" ADD CONSTRAINT "mail_evidence_links_mail_derived_candidate_id_fkey" FOREIGN KEY ("mail_derived_candidate_id") REFERENCES "mail_derived_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_invoices" ADD CONSTRAINT "finance_invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "finance_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "finance_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_cashflows" ADD CONSTRAINT "finance_cashflows_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "finance_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_tax_invoices" ADD CONSTRAINT "finance_tax_invoices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "finance_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_chat_messages" ADD CONSTRAINT "finance_chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "finance_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_color_agents" ADD CONSTRAINT "project_color_agents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "color_agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_events" ADD CONSTRAINT "handoff_events_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "kanban_handoff_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_service_line_items" ADD CONSTRAINT "quote_service_line_items_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assets" ADD CONSTRAINT "customer_assets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_quality_results" ADD CONSTRAINT "ai_quality_results_golden_answer_id_fkey" FOREIGN KEY ("golden_answer_id") REFERENCES "ai_golden_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_editions" ADD CONSTRAINT "product_editions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "product_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "product_editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sizing_templates" ADD CONSTRAINT "sizing_templates_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_rules" ADD CONSTRAINT "compatibility_rules_source_sku_id_fkey" FOREIGN KEY ("source_sku_id") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compatibility_rules" ADD CONSTRAINT "compatibility_rules_target_sku_id_fkey" FOREIGN KEY ("target_sku_id") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_requests" ADD CONSTRAINT "vendor_requests_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_request_events" ADD CONSTRAINT "vendor_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vendor_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_projects" ADD CONSTRAINT "delivery_projects_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_checklist_items" ADD CONSTRAINT "delivery_checklist_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "delivery_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_escalations" ADD CONSTRAINT "vendor_escalations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "customer_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_licenses" ADD CONSTRAINT "asset_licenses_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "customer_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_contracts" ADD CONSTRAINT "maintenance_contracts_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "customer_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_runs" ADD CONSTRAINT "ai_prompt_runs_prompt_template_id_fkey" FOREIGN KEY ("prompt_template_id") REFERENCES "ai_prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "color_review_requirements" ADD CONSTRAINT "color_review_requirements_handoff_card_id_fkey" FOREIGN KEY ("handoff_card_id") REFERENCES "kanban_handoff_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "color_agent_decisions" ADD CONSTRAINT "color_agent_decisions_handoff_card_id_fkey" FOREIGN KEY ("handoff_card_id") REFERENCES "kanban_handoff_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "mail_derived_candidates_knowledge_document_id_candidate_type_ke" RENAME TO "mail_derived_candidates_knowledge_document_id_candidate_typ_key";

-- RenameIndex
ALTER INDEX "mail_derived_candidates_mail_insight_thread_id_candidate_type_k" RENAME TO "mail_derived_candidates_mail_insight_thread_id_candidate_ty_key";

