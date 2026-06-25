CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Agentic Company OS for SANGFOR Partner Pack V3.1
-- Contractor-ready PostgreSQL schema skeleton.
-- Principle:
--   1. Tenant/company scoped business tables.
--   2. Composite FK whenever a child references tenant/company data.
--   3. Quote margin is calculated from line items, not trusted input.
--   4. Audit/access events are append-only by permission policy.
-- ============================================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  mfa_required BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id)
);

CREATE TABLE user_company_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role_key TEXT NOT NULL,
  granted_by_user_id UUID,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_approval','expired','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, user_id, role_key),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE role_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL,
  requested_roles TEXT[] NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  second_approver_user_id UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id),
  FOREIGN KEY (tenant_id, target_user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  persona_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  default_role_key TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, persona_key),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);

CREATE TABLE industry_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  pack_key TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  config_schema JSONB NOT NULL DEFAULT '{}',
  signature TEXT,
  publisher TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_security_review','active','deprecated','rejected')),
  installed_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, pack_key, version),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);

CREATE TABLE workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  industry_pack_id UUID,
  workflow_key TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  definition_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','active','retired','rejected')),
  created_by_user_id UUID,
  approved_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, workflow_key, version),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, industry_pack_id)
    REFERENCES industry_packs (tenant_id, company_id, id)
);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  workflow_definition_id UUID NOT NULL,
  workflow_definition_version INT NOT NULL,
  definition_snapshot JSONB NOT NULL,
  definition_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','blocked','completed','failed','cancelled')),
  current_step_key TEXT,
  started_by_user_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, workflow_definition_id)
    REFERENCES workflow_definitions (tenant_id, company_id, id)
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  assigned_user_id UUID,
  assigned_persona_key TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, workflow_run_id)
    REFERENCES workflow_runs (tenant_id, company_id, id)
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  segment TEXT,
  industry TEXT,
  primary_contact JSONB,
  classification TEXT NOT NULL DEFAULT 'confidential'
    CHECK (classification IN ('public','internal','confidential','restricted','regulated_personal_data')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);

CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  vendor_category TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, name),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead','qualified','discovery','solution_mapping','quote','commercial_approval','proposal','poc','delivery','support','renewal','won','lost')),
  estimated_revenue NUMERIC(14,2),
  expected_close_date DATE,
  close_probability NUMERIC(5,2) CHECK (close_probability IS NULL OR (close_probability >= 0 AND close_probability <= 100)),
  deal_source TEXT,
  decision_maker TEXT,
  technical_influencer TEXT,
  procurement_stage TEXT,
  competitor_id UUID,
  product_family_keys TEXT[] NOT NULL DEFAULT '{}',
  pain_points TEXT[] NOT NULL DEFAULT '{}',
  owner_user_id UUID,
  classification TEXT NOT NULL DEFAULT 'confidential'
    CHECK (classification IN ('public','internal','confidential','restricted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_id)
    REFERENCES customers (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, competitor_id)
    REFERENCES competitors (tenant_id, company_id, id)
);

CREATE TABLE deal_qualification_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  budget_score INT NOT NULL CHECK (budget_score BETWEEN 0 AND 5),
  authority_score INT NOT NULL CHECK (authority_score BETWEEN 0 AND 5),
  need_score INT NOT NULL CHECK (need_score BETWEEN 0 AND 5),
  timeline_score INT NOT NULL CHECK (timeline_score BETWEEN 0 AND 5),
  technical_fit_score INT NOT NULL CHECK (technical_fit_score BETWEEN 0 AND 5),
  strategic_fit_score INT NOT NULL CHECK (strategic_fit_score BETWEEN 0 AND 5),
  competitive_risk TEXT NOT NULL CHECK (competitive_risk IN ('low','medium','high')),
  total_score INT GENERATED ALWAYS AS (
    budget_score + authority_score + need_score + timeline_score + technical_fit_score + strategic_fit_score
  ) STORED,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('proceed','nurture','reject','needs_review')),
  notes TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opportunity_id)
    REFERENCES opportunities (tenant_id, company_id, id)
);

CREATE TABLE product_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  vendor_key TEXT NOT NULL,
  family_key TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('cybersecurity','cloud_infrastructure','service','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, vendor_key, family_key),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE license_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  metric_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, metric_key),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE product_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  product_family_id UUID NOT NULL,
  license_metric_id UUID,
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  edition TEXT,
  license_metric TEXT NOT NULL,
  term_months INT,
  deployment_type TEXT,
  support_level TEXT,
  list_price NUMERIC(14,2),
  base_cost NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'KRW',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, sku_code),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_family_id)
    REFERENCES product_families (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, license_metric_id)
    REFERENCES license_metrics (tenant_id, company_id, id)
);

CREATE TABLE sizing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  product_family_id UUID NOT NULL,
  template_key TEXT NOT NULL,
  input_schema JSONB NOT NULL,
  sizing_rules JSONB NOT NULL,
  required_fields TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, template_key),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_family_id)
    REFERENCES product_families (tenant_id, company_id, id)
);

CREATE TABLE compatibility_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  product_family_id UUID,
  product_sku_id UUID,
  rule_key TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('requires','conflicts','minimum_version','deployment_constraint','certification_required')),
  rule_payload JSONB NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','blocking')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, rule_key),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_family_id)
    REFERENCES product_families (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_sku_id)
    REFERENCES product_skus (tenant_id, company_id, id)
);

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','auto_failed','ready_for_commercial_approval','approved','rejected','sent','expired')),
  currency TEXT NOT NULL DEFAULT 'KRW',
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  margin_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
  payment_terms TEXT,
  valid_until DATE,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opportunity_id)
    REFERENCES opportunities (tenant_id, company_id, id)
);

CREATE TABLE quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL,
  product_sku_id UUID,
  line_type TEXT NOT NULL CHECK (line_type IN ('product','service','discount','expense')),
  description TEXT NOT NULL,
  quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, quote_id)
    REFERENCES quotes (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_sku_id)
    REFERENCES product_skus (tenant_id, company_id, id)
);

CREATE TABLE quote_service_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('implementation','migration','training','support','managed_service','travel','other')),
  description TEXT NOT NULL,
  engineer_days NUMERIC(8,2) NOT NULL DEFAULT 0,
  bill_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, quote_id)
    REFERENCES quotes (tenant_id, company_id, id)
);

CREATE TABLE discount_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  quote_id UUID NOT NULL,
  requested_discount_percent NUMERIC(5,2) NOT NULL CHECK (requested_discount_percent >= 0 AND requested_discount_percent <= 100),
  reason TEXT NOT NULL,
  vendor_required BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','vendor_submitted','approved','rejected','expired')),
  requested_by_user_id UUID,
  decided_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, quote_id)
    REFERENCES quotes (tenant_id, company_id, id)
);

CREATE TABLE vendor_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  opportunity_id UUID,
  quote_id UUID,
  request_type TEXT NOT NULL CHECK (request_type IN ('deal_registration','special_discount','demo_license','nfr_asset','technical_escalation','partner_portal_request','training_request')),
  vendor_key TEXT NOT NULL DEFAULT 'sangfor',
  external_reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','waiting_vendor','approved','rejected','cancelled','completed')),
  requested_by_user_id UUID,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opportunity_id)
    REFERENCES opportunities (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, quote_id)
    REFERENCES quotes (tenant_id, company_id, id)
);

CREATE TABLE vendor_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  vendor_request_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, vendor_request_id)
    REFERENCES vendor_requests (tenant_id, company_id, id)
);

CREATE TABLE poc_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ready','in_progress','completed','failed','cancelled')),
  success_criteria JSONB NOT NULL DEFAULT '[]',
  test_scenarios JSONB NOT NULL DEFAULT '[]',
  customer_approver TEXT,
  start_date DATE,
  end_date DATE,
  conversion_probability NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opportunity_id)
    REFERENCES opportunities (tenant_id, company_id, id)
);

CREATE TABLE poc_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  poc_project_id UUID NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('engineer','demo_license','nfr_asset','appliance','lab_environment')),
  resource_id UUID,
  resource_name TEXT NOT NULL,
  reservation_start DATE,
  reservation_end DATE,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('requested','reserved','in_use','released','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, poc_project_id)
    REFERENCES poc_projects (tenant_id, company_id, id)
);

CREATE TABLE demo_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  vendor_request_id UUID,
  product_sku_id UUID,
  customer_id UUID,
  license_key_ref TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','issued','active','expired','revoked')),
  start_date DATE,
  end_date DATE,
  issued_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, vendor_request_id)
    REFERENCES vendor_requests (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_sku_id)
    REFERENCES product_skus (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_id)
    REFERENCES customers (tenant_id, company_id, id)
);

CREATE TABLE delivery_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  opportunity_id UUID NOT NULL,
  quote_id UUID,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ready','in_progress','blocked','accepted','cancelled')),
  sow_artifact_id UUID,
  project_manager_user_id UUID,
  planned_start DATE,
  planned_end DATE,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opportunity_id)
    REFERENCES opportunities (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, quote_id)
    REFERENCES quotes (tenant_id, company_id, id)
);

CREATE TABLE customer_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  product_family_id UUID,
  product_sku_id UUID,
  delivery_project_id UUID,
  asset_name TEXT NOT NULL,
  serial_number TEXT,
  activation_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','suspended','retired')),
  installed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_id)
    REFERENCES customers (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_family_id)
    REFERENCES product_families (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_sku_id)
    REFERENCES product_skus (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, delivery_project_id)
    REFERENCES delivery_projects (tenant_id, company_id, id)
);

CREATE TABLE asset_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_asset_id UUID NOT NULL,
  product_sku_id UUID,
  license_key_ref TEXT,
  license_metric TEXT,
  licensed_quantity NUMERIC(14,2),
  activated_at DATE,
  expires_at DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','expired','revoked','renewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_asset_id)
    REFERENCES customer_assets (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, product_sku_id)
    REFERENCES product_skus (tenant_id, company_id, id)
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_asset_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','renewal_due','expired','cancelled','renewed')),
  renewal_owner_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_asset_id)
    REFERENCES customer_assets (tenant_id, company_id, id)
);

CREATE TABLE maintenance_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_asset_id UUID NOT NULL,
  support_level TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled','renewed')),
  contract_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_asset_id)
    REFERENCES customer_assets (tenant_id, company_id, id)
);

CREATE TABLE renewal_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  customer_asset_id UUID,
  subscription_id UUID,
  opportunity_id UUID,
  renewal_due_date DATE NOT NULL,
  forecast_amount NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','quoted','won','lost','churn_risk')),
  reminder_90_sent BOOLEAN NOT NULL DEFAULT false,
  reminder_60_sent BOOLEAN NOT NULL DEFAULT false,
  reminder_30_sent BOOLEAN NOT NULL DEFAULT false,
  owner_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_id)
    REFERENCES customers (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_asset_id)
    REFERENCES customer_assets (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, subscription_id)
    REFERENCES subscriptions (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opportunity_id)
    REFERENCES opportunities (tenant_id, company_id, id)
);

CREATE TABLE support_sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  response_minutes INT NOT NULL,
  resolution_minutes INT NOT NULL,
  vendor_escalation_minutes INT,
  customer_update_minutes INT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, severity),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE support_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  customer_asset_id UUID,
  sla_policy_id UUID,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_customer','waiting_vendor','resolved','closed','cancelled')),
  affected_service TEXT,
  response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_id)
    REFERENCES customers (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, customer_asset_id)
    REFERENCES customer_assets (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, sla_policy_id)
    REFERENCES support_sla_policies (tenant_id, company_id, id)
);

CREATE TABLE vendor_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  support_case_id UUID NOT NULL,
  vendor_request_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','waiting_vendor','resolved','closed','cancelled')),
  severity TEXT NOT NULL DEFAULT 'medium',
  external_ticket_ref TEXT,
  submitted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, support_case_id)
    REFERENCES support_cases (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, vendor_request_id)
    REFERENCES vendor_requests (tenant_id, company_id, id)
);

CREATE TABLE engineer_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  vendor_key TEXT NOT NULL DEFAULT 'sangfor',
  certification_key TEXT NOT NULL,
  certification_name TEXT NOT NULL,
  product_family_id UUID,
  issued_at DATE,
  expires_at DATE,
  evidence_artifact_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, user_id, certification_key),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, product_family_id)
    REFERENCES product_families (tenant_id, company_id, id)
);

CREATE TABLE skill_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  product_family_id UUID NOT NULL,
  skill_level TEXT NOT NULL CHECK (skill_level IN ('awareness','associate','professional','expert')),
  can_presales BOOLEAN NOT NULL DEFAULT false,
  can_delivery BOOLEAN NOT NULL DEFAULT false,
  can_support BOOLEAN NOT NULL DEFAULT false,
  updated_by_user_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, user_id, product_family_id),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, product_family_id)
    REFERENCES product_families (tenant_id, company_id, id)
);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ai_draft','human_reviewed','approved','rejected','expired','superseded')),
  classification TEXT NOT NULL DEFAULT 'confidential'
    CHECK (classification IN ('public','internal','confidential','restricted','regulated_personal_data')),
  current_version INT NOT NULL DEFAULT 1,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  watermark_required BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  artifact_id UUID NOT NULL,
  version INT NOT NULL,
  body_markdown TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  body_ciphertext BYTEA,
  evidence_links JSONB NOT NULL DEFAULT '[]',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, artifact_id, version),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, artifact_id)
    REFERENCES artifacts (tenant_id, company_id, id)
);

CREATE TABLE artifact_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  artifact_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('view','copy','download','export','share','print')),
  approved_by_user_id UUID,
  reason TEXT,
  ip_address INET,
  user_agent TEXT,
  watermark_applied BOOLEAN NOT NULL DEFAULT false,
  redacted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, artifact_id)
    REFERENCES artifacts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, actor_user_id)
    REFERENCES users (tenant_id, id)
);

CREATE TABLE data_export_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  requested_by_user_id UUID NOT NULL,
  export_format TEXT NOT NULL CHECK (export_format IN ('pdf','docx','xlsx','csv','json','zip')),
  classification TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','completed')),
  approved_by_user_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, requested_by_user_id)
    REFERENCES users (tenant_id, id)
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  workflow_run_id UUID,
  artifact_id UUID,
  artifact_version INT,
  gate_key TEXT NOT NULL,
  required_role_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','auto_validating','auto_failed','remediation_required','ready_for_human_approval','approved','rejected','change_requested','override_requested','override_approved')),
  decided_by_user_id UUID,
  decision_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, workflow_run_id)
    REFERENCES workflow_runs (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, artifact_id)
    REFERENCES artifacts (tenant_id, company_id, id)
);

CREATE TABLE approval_override_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  approval_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL,
  second_approver_user_id UUID,
  reason TEXT NOT NULL,
  risk_acceptance TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, approval_id)
    REFERENCES approvals (tenant_id, company_id, id)
);

CREATE TABLE ai_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  template_key TEXT NOT NULL,
  purpose TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  template_text TEXT NOT NULL,
  expected_schema JSONB NOT NULL DEFAULT '{}',
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  approved_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, template_key, version),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT,
  allowed_data_classification TEXT[] NOT NULL DEFAULT ARRAY['public','internal','confidential'],
  max_context_tokens INT,
  cost_per_1k_input NUMERIC(14,6),
  cost_per_1k_output NUMERIC(14,6),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','disabled','experimental')),
  approved_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, provider, model_name, model_version),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE ai_evaluation_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  dataset_key TEXT NOT NULL,
  purpose TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, dataset_key, version),
  UNIQUE (tenant_id, company_id, id)
);

CREATE TABLE ai_golden_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  dataset_id UUID NOT NULL,
  case_key TEXT NOT NULL,
  input_payload JSONB NOT NULL,
  expected_output JSONB NOT NULL,
  evaluation_rubric JSONB NOT NULL DEFAULT '{}',
  artifact_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, dataset_id, case_key),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, dataset_id)
    REFERENCES ai_evaluation_datasets (tenant_id, company_id, id)
);

CREATE TABLE ai_quality_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  artifact_id UUID,
  prompt_template_id UUID,
  ai_model_id UUID,
  score NUMERIC(5,2) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  confidence TEXT CHECK (confidence IN ('low','medium','high')),
  source_coverage NUMERIC(5,2),
  missing_fields TEXT[] NOT NULL DEFAULT '{}',
  known_gaps TEXT[] NOT NULL DEFAULT '{}',
  risk_flags TEXT[] NOT NULL DEFAULT '{}',
  customer_send_allowed BOOLEAN NOT NULL DEFAULT false,
  evaluated_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, artifact_id)
    REFERENCES artifacts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, prompt_template_id)
    REFERENCES ai_prompt_templates (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, ai_model_id)
    REFERENCES ai_models (tenant_id, company_id, id)
);

CREATE TABLE ai_prompt_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  prompt_template_id UUID,
  ai_model_id UUID,
  actor_user_id UUID,
  resource_type TEXT,
  resource_id UUID,
  input_redacted JSONB NOT NULL DEFAULT '{}',
  output_redacted JSONB NOT NULL DEFAULT '{}',
  token_input INT,
  token_output INT,
  cost_amount NUMERIC(14,6),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','blocked','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, prompt_template_id)
    REFERENCES ai_prompt_templates (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, ai_model_id)
    REFERENCES ai_models (tenant_id, company_id, id)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  actor_user_id UUID,
  actor_role TEXT,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  action TEXT NOT NULL,
  request_id TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  redacted_payload JSONB NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes for MVP dashboards and background jobs.
CREATE INDEX idx_opportunities_stage ON opportunities (tenant_id, company_id, stage, expected_close_date);
CREATE INDEX idx_quotes_status ON quotes (tenant_id, company_id, status, created_at);
CREATE INDEX idx_approvals_status ON approvals (tenant_id, company_id, status, created_at);
CREATE INDEX idx_artifacts_resource ON artifacts (tenant_id, company_id, resource_type, resource_id);
CREATE INDEX idx_subscriptions_end_date ON subscriptions (tenant_id, company_id, end_date, status);
CREATE INDEX idx_renewal_due ON renewal_opportunities (tenant_id, company_id, renewal_due_date, status);
CREATE INDEX idx_support_cases_status ON support_cases (tenant_id, company_id, severity, status, created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs (tenant_id, company_id, resource_type, resource_id, created_at);
