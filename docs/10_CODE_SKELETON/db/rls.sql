-- Agentic Company OS V3.1 RLS policy skeleton.
-- Apply after schema.sql.
-- Runtime app_role must not own these tables and must not have BYPASSRLS.
-- The API layer MUST set app.tenant_id and app.company_id in every transaction.
-- current_setting(..., false) intentionally fails closed when the context is missing.

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_tenant_policy ON companies;
CREATE POLICY companies_tenant_policy
ON companies
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_policy ON users;
CREATE POLICY users_tenant_policy
ON users
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
);

ALTER TABLE user_company_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_company_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_company_roles_tenant_company_policy ON user_company_roles;
CREATE POLICY user_company_roles_tenant_company_policy
ON user_company_roles
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE role_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_change_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_change_requests_tenant_company_policy ON role_change_requests;
CREATE POLICY role_change_requests_tenant_company_policy
ON role_change_requests
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personas_tenant_company_policy ON personas;
CREATE POLICY personas_tenant_company_policy
ON personas
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE industry_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_packs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS industry_packs_tenant_company_policy ON industry_packs;
CREATE POLICY industry_packs_tenant_company_policy
ON industry_packs
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_definitions_tenant_company_policy ON workflow_definitions;
CREATE POLICY workflow_definitions_tenant_company_policy
ON workflow_definitions
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_runs_tenant_company_policy ON workflow_runs;
CREATE POLICY workflow_runs_tenant_company_policy
ON workflow_runs
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_tenant_company_policy ON tasks;
CREATE POLICY tasks_tenant_company_policy
ON tasks
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_tenant_company_policy ON customers;
CREATE POLICY customers_tenant_company_policy
ON customers
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS competitors_tenant_company_policy ON competitors;
CREATE POLICY competitors_tenant_company_policy
ON competitors
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunities_tenant_company_policy ON opportunities;
CREATE POLICY opportunities_tenant_company_policy
ON opportunities
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE deal_qualification_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_qualification_scores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_qualification_scores_tenant_company_policy ON deal_qualification_scores;
CREATE POLICY deal_qualification_scores_tenant_company_policy
ON deal_qualification_scores
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE product_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_families FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_families_tenant_company_policy ON product_families;
CREATE POLICY product_families_tenant_company_policy
ON product_families
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE license_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_metrics FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS license_metrics_tenant_company_policy ON license_metrics;
CREATE POLICY license_metrics_tenant_company_policy
ON license_metrics
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE product_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_skus FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_skus_tenant_company_policy ON product_skus;
CREATE POLICY product_skus_tenant_company_policy
ON product_skus
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE sizing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sizing_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sizing_templates_tenant_company_policy ON sizing_templates;
CREATE POLICY sizing_templates_tenant_company_policy
ON sizing_templates
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE compatibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compatibility_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compatibility_rules_tenant_company_policy ON compatibility_rules;
CREATE POLICY compatibility_rules_tenant_company_policy
ON compatibility_rules
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotes_tenant_company_policy ON quotes;
CREATE POLICY quotes_tenant_company_policy
ON quotes
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_line_items_tenant_company_policy ON quote_line_items;
CREATE POLICY quote_line_items_tenant_company_policy
ON quote_line_items
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE quote_service_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_service_line_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_service_line_items_tenant_company_policy ON quote_service_line_items;
CREATE POLICY quote_service_line_items_tenant_company_policy
ON quote_service_line_items
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE discount_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discount_requests_tenant_company_policy ON discount_requests;
CREATE POLICY discount_requests_tenant_company_policy
ON discount_requests
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE vendor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_requests_tenant_company_policy ON vendor_requests;
CREATE POLICY vendor_requests_tenant_company_policy
ON vendor_requests
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE vendor_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_request_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_request_events_tenant_company_policy ON vendor_request_events;
CREATE POLICY vendor_request_events_tenant_company_policy
ON vendor_request_events
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE poc_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE poc_projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poc_projects_tenant_company_policy ON poc_projects;
CREATE POLICY poc_projects_tenant_company_policy
ON poc_projects
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE poc_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE poc_resources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poc_resources_tenant_company_policy ON poc_resources;
CREATE POLICY poc_resources_tenant_company_policy
ON poc_resources
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE demo_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_licenses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_licenses_tenant_company_policy ON demo_licenses;
CREATE POLICY demo_licenses_tenant_company_policy
ON demo_licenses
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE delivery_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_projects_tenant_company_policy ON delivery_projects;
CREATE POLICY delivery_projects_tenant_company_policy
ON delivery_projects
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE customer_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_assets_tenant_company_policy ON customer_assets;
CREATE POLICY customer_assets_tenant_company_policy
ON customer_assets
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE asset_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_licenses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_licenses_tenant_company_policy ON asset_licenses;
CREATE POLICY asset_licenses_tenant_company_policy
ON asset_licenses
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_tenant_company_policy ON subscriptions;
CREATE POLICY subscriptions_tenant_company_policy
ON subscriptions
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE maintenance_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_contracts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_contracts_tenant_company_policy ON maintenance_contracts;
CREATE POLICY maintenance_contracts_tenant_company_policy
ON maintenance_contracts
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE renewal_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_opportunities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS renewal_opportunities_tenant_company_policy ON renewal_opportunities;
CREATE POLICY renewal_opportunities_tenant_company_policy
ON renewal_opportunities
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE support_sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sla_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_sla_policies_tenant_company_policy ON support_sla_policies;
CREATE POLICY support_sla_policies_tenant_company_policy
ON support_sla_policies
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_cases_tenant_company_policy ON support_cases;
CREATE POLICY support_cases_tenant_company_policy
ON support_cases
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE vendor_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_escalations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_escalations_tenant_company_policy ON vendor_escalations;
CREATE POLICY vendor_escalations_tenant_company_policy
ON vendor_escalations
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE engineer_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineer_certifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineer_certifications_tenant_company_policy ON engineer_certifications;
CREATE POLICY engineer_certifications_tenant_company_policy
ON engineer_certifications
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE skill_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_matrix FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_matrix_tenant_company_policy ON skill_matrix;
CREATE POLICY skill_matrix_tenant_company_policy
ON skill_matrix
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artifacts_tenant_company_policy ON artifacts;
CREATE POLICY artifacts_tenant_company_policy
ON artifacts
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artifact_versions_tenant_company_policy ON artifact_versions;
CREATE POLICY artifact_versions_tenant_company_policy
ON artifact_versions
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE artifact_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_access_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artifact_access_events_tenant_company_policy ON artifact_access_events;
CREATE POLICY artifact_access_events_tenant_company_policy
ON artifact_access_events
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE data_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_export_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_export_requests_tenant_company_policy ON data_export_requests;
CREATE POLICY data_export_requests_tenant_company_policy
ON data_export_requests
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approvals_tenant_company_policy ON approvals;
CREATE POLICY approvals_tenant_company_policy
ON approvals
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE approval_override_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_override_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_override_requests_tenant_company_policy ON approval_override_requests;
CREATE POLICY approval_override_requests_tenant_company_policy
ON approval_override_requests
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE ai_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_prompt_templates_tenant_company_policy ON ai_prompt_templates;
CREATE POLICY ai_prompt_templates_tenant_company_policy
ON ai_prompt_templates
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_models_tenant_company_policy ON ai_models;
CREATE POLICY ai_models_tenant_company_policy
ON ai_models
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE ai_evaluation_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_evaluation_datasets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_evaluation_datasets_tenant_company_policy ON ai_evaluation_datasets;
CREATE POLICY ai_evaluation_datasets_tenant_company_policy
ON ai_evaluation_datasets
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE ai_golden_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_golden_answers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_golden_answers_tenant_company_policy ON ai_golden_answers;
CREATE POLICY ai_golden_answers_tenant_company_policy
ON ai_golden_answers
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE ai_quality_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_quality_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_quality_results_tenant_company_policy ON ai_quality_results;
CREATE POLICY ai_quality_results_tenant_company_policy
ON ai_quality_results
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE ai_prompt_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_prompt_runs_tenant_company_policy ON ai_prompt_runs;
CREATE POLICY ai_prompt_runs_tenant_company_policy
ON ai_prompt_runs
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant_company_policy ON audit_logs;
CREATE POLICY audit_logs_tenant_company_policy
ON audit_logs
USING (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', false)
  AND company_id::text = current_setting('app.company_id', false)
);


-- Role hardening examples:
-- ALTER ROLE app_role NOBYPASSRLS;
-- REVOKE CREATE ON SCHEMA public FROM app_role;
-- REVOKE UPDATE, DELETE ON audit_logs FROM app_role;
-- GRANT INSERT ON audit_logs TO app_role;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_role;
-- Then explicitly REVOKE UPDATE/DELETE from append-only tables in migrations.
