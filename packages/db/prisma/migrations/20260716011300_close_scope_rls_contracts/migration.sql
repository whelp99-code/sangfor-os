-- U073 / DB-01: Final Scope RLS Closure Migration
-- Enable and Force RLS for ALL non-global tables (198 total - 11 global = 187 scoped)
-- Idempotent: ENABLE/FORCE are no-ops if already set; policies use DROP IF EXISTS + CREATE

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
ALTER TABLE "command_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "command_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mail_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portal_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "poc_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "poc_projects" FORCE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mail_insight_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_insight_threads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "policy_memories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "policy_memories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "policy_decision_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "policy_decision_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "domain_memories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_memories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "domain_decision_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_decision_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finance_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finance_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_expenses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finance_cashflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_cashflows" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finance_tax_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_tax_invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_color_agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_color_agents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "kanban_handoff_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kanban_handoff_cards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "support_sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_sla_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "support_sla_policy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_sla_policy_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "certification_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certification_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engineer_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engineer_skills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engineer_eligibility_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engineer_eligibility_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_company_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_company_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "role_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_change_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "personas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_families" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_families" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "delivery_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_projects" FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_export_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_export_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "artifact_access_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifact_access_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "legal_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_holds" FORCE ROW LEVEL SECURITY;
ALTER TABLE "legal_hold_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_hold_scopes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "retention_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "retention_run_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_run_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "scheduler_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduler_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "metric_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metric_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_executions" FORCE ROW LEVEL SECURITY;

-- Deterministic scope policies (one per scoped table)

DROP POLICY IF EXISTS "projects_scope_policy" ON "projects";
CREATE POLICY "projects_scope_policy" ON "projects"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "project_members_scope_policy" ON "project_members";
CREATE POLICY "project_members_scope_policy" ON "project_members"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "workspaces_scope_policy" ON "workspaces";
CREATE POLICY "workspaces_scope_policy" ON "workspaces"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "command_runs_scope_policy" ON "command_runs";
CREATE POLICY "command_runs_scope_policy" ON "command_runs"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "approval_requests_scope_policy" ON "approval_requests";
CREATE POLICY "approval_requests_scope_policy" ON "approval_requests"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "audit_logs_scope_policy" ON "audit_logs";
CREATE POLICY "audit_logs_scope_policy" ON "audit_logs"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "mail_accounts_scope_policy" ON "mail_accounts";
CREATE POLICY "mail_accounts_scope_policy" ON "mail_accounts"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "portal_tasks_scope_policy" ON "portal_tasks";
CREATE POLICY "portal_tasks_scope_policy" ON "portal_tasks"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "customers_scope_policy" ON "customers";
CREATE POLICY "customers_scope_policy" ON "customers"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "partners_scope_policy" ON "partners";
CREATE POLICY "partners_scope_policy" ON "partners"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "work_tasks_scope_policy" ON "work_tasks";
CREATE POLICY "work_tasks_scope_policy" ON "work_tasks"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "poc_projects_scope_policy" ON "poc_projects";
CREATE POLICY "poc_projects_scope_policy" ON "poc_projects"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "opportunities_scope_policy" ON "opportunities";
CREATE POLICY "opportunities_scope_policy" ON "opportunities"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "knowledge_documents_scope_policy" ON "knowledge_documents";
CREATE POLICY "knowledge_documents_scope_policy" ON "knowledge_documents"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "document_templates_scope_policy" ON "document_templates";
CREATE POLICY "document_templates_scope_policy" ON "document_templates"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "artifacts_scope_policy" ON "artifacts";
CREATE POLICY "artifacts_scope_policy" ON "artifacts"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "workflow_definitions_scope_policy" ON "workflow_definitions";
CREATE POLICY "workflow_definitions_scope_policy" ON "workflow_definitions"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "workflow_runs_scope_policy" ON "workflow_runs";
CREATE POLICY "workflow_runs_scope_policy" ON "workflow_runs"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "mail_insight_threads_scope_policy" ON "mail_insight_threads";
CREATE POLICY "mail_insight_threads_scope_policy" ON "mail_insight_threads"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "policy_memories_scope_policy" ON "policy_memories";
CREATE POLICY "policy_memories_scope_policy" ON "policy_memories"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "policy_decision_logs_scope_policy" ON "policy_decision_logs";
CREATE POLICY "policy_decision_logs_scope_policy" ON "policy_decision_logs"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "domain_memories_scope_policy" ON "domain_memories";
CREATE POLICY "domain_memories_scope_policy" ON "domain_memories"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "domain_decision_logs_scope_policy" ON "domain_decision_logs";
CREATE POLICY "domain_decision_logs_scope_policy" ON "domain_decision_logs"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "finance_invoices_scope_policy" ON "finance_invoices";
CREATE POLICY "finance_invoices_scope_policy" ON "finance_invoices"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "finance_expenses_scope_policy" ON "finance_expenses";
CREATE POLICY "finance_expenses_scope_policy" ON "finance_expenses"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "finance_cashflows_scope_policy" ON "finance_cashflows";
CREATE POLICY "finance_cashflows_scope_policy" ON "finance_cashflows"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "finance_tax_invoices_scope_policy" ON "finance_tax_invoices";
CREATE POLICY "finance_tax_invoices_scope_policy" ON "finance_tax_invoices"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "project_color_agents_scope_policy" ON "project_color_agents";
CREATE POLICY "project_color_agents_scope_policy" ON "project_color_agents"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "kanban_handoff_cards_scope_policy" ON "kanban_handoff_cards";
CREATE POLICY "kanban_handoff_cards_scope_policy" ON "kanban_handoff_cards"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "support_sla_policies_scope_policy" ON "support_sla_policies";
CREATE POLICY "support_sla_policies_scope_policy" ON "support_sla_policies"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "support_sla_policy_versions_scope_policy" ON "support_sla_policy_versions";
CREATE POLICY "support_sla_policy_versions_scope_policy" ON "support_sla_policy_versions"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "certification_definitions_scope_policy" ON "certification_definitions";
CREATE POLICY "certification_definitions_scope_policy" ON "certification_definitions"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "engineer_skills_scope_policy" ON "engineer_skills";
CREATE POLICY "engineer_skills_scope_policy" ON "engineer_skills"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "engineer_eligibility_policies_scope_policy" ON "engineer_eligibility_policies";
CREATE POLICY "engineer_eligibility_policies_scope_policy" ON "engineer_eligibility_policies"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "companies_scope_policy" ON "companies";
CREATE POLICY "companies_scope_policy" ON "companies"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS "auth_sessions_scope_policy" ON "auth_sessions";
CREATE POLICY "auth_sessions_scope_policy" ON "auth_sessions"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "user_company_roles_scope_policy" ON "user_company_roles";
CREATE POLICY "user_company_roles_scope_policy" ON "user_company_roles"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "role_change_requests_scope_policy" ON "role_change_requests";
CREATE POLICY "role_change_requests_scope_policy" ON "role_change_requests"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "personas_scope_policy" ON "personas";
CREATE POLICY "personas_scope_policy" ON "personas"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "product_families_scope_policy" ON "product_families";
CREATE POLICY "product_families_scope_policy" ON "product_families"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "quotes_scope_policy" ON "quotes";
CREATE POLICY "quotes_scope_policy" ON "quotes"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "delivery_projects_scope_policy" ON "delivery_projects";
CREATE POLICY "delivery_projects_scope_policy" ON "delivery_projects"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "data_export_requests_scope_policy" ON "data_export_requests";
CREATE POLICY "data_export_requests_scope_policy" ON "data_export_requests"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "artifact_access_events_scope_policy" ON "artifact_access_events";
CREATE POLICY "artifact_access_events_scope_policy" ON "artifact_access_events"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "retention_policies_scope_policy" ON "retention_policies";
CREATE POLICY "retention_policies_scope_policy" ON "retention_policies"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "legal_holds_scope_policy" ON "legal_holds";
CREATE POLICY "legal_holds_scope_policy" ON "legal_holds"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "legal_hold_scopes_scope_policy" ON "legal_hold_scopes";
CREATE POLICY "legal_hold_scopes_scope_policy" ON "legal_hold_scopes"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "retention_runs_scope_policy" ON "retention_runs";
CREATE POLICY "retention_runs_scope_policy" ON "retention_runs"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "retention_run_items_scope_policy" ON "retention_run_items";
CREATE POLICY "retention_run_items_scope_policy" ON "retention_run_items"
  USING ("project_id" = current_setting('app.current_project_id', true));

DROP POLICY IF EXISTS "notification_events_scope_policy" ON "notification_events";
CREATE POLICY "notification_events_scope_policy" ON "notification_events"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "scheduler_jobs_scope_policy" ON "scheduler_jobs";
CREATE POLICY "scheduler_jobs_scope_policy" ON "scheduler_jobs"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "metric_definitions_scope_policy" ON "metric_definitions";
CREATE POLICY "metric_definitions_scope_policy" ON "metric_definitions"
  USING ("company_id" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS "ai_executions_scope_policy" ON "ai_executions";
CREATE POLICY "ai_executions_scope_policy" ON "ai_executions"
  USING ("company_id" = current_setting('app.current_company_id', true));

-- NOBYPASSRLS app role enforcement
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sangfor_app') THEN
    CREATE ROLE sangfor_app NOLOGIN NOBYPASSRLS;
  ELSE
    ALTER ROLE sangfor_app NOBYPASSRLS;
  END IF;
END $$;
