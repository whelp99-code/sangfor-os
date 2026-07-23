-- Representative, non-secret pre-U032 fixture.  It is deliberately loaded before U032:
-- no U032+ columns, tables, constraints, or triggers are referenced here.
-- The rows are intentionally deterministic so the first U040 backfill changes data and the
-- second pass is a zero-change proof.
INSERT INTO tenants (id, name, slug, status) VALUES ('u040_tenant', 'U040 Tenant', 'u040-tenant', 'active') ON CONFLICT DO NOTHING;
INSERT INTO companies (id, tenant_id, name, slug) VALUES ('u040_company', 'u040_tenant', 'U040 Company', 'u040-company') ON CONFLICT DO NOTHING;
INSERT INTO projects (id, company_id, slug, name, description, updated_at) VALUES ('u040_project', 'u040_company', 'u040-project', 'U040 Project', 'synthetic', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, name, updated_at) VALUES
  ('u040_owner', 'u040-owner@example.invalid', 'U040 Owner', CURRENT_TIMESTAMP),
  ('u040_engineer', 'u040-engineer@example.invalid', 'U040 Engineer', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
INSERT INTO user_company_roles (id, user_id, company_id, role, status, revision) VALUES
  ('u040_owner_role', 'u040_owner', 'u040_company', 'account_manager', 'active', 0),
  ('u040_engineer_role', 'u040_engineer', 'u040_company', 'support_engineer', 'active', 0)
ON CONFLICT DO NOTHING;

INSERT INTO customers (id, project_id, name, updated_at) VALUES
  ('u040_customer', 'u040_project', 'U040 Customer', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
INSERT INTO opportunities (id, project_id, customer_id, title, owner_id, updated_at) VALUES
  ('u040_opportunity', 'u040_project', 'u040_customer', 'U040 deterministic owner', 'u040_owner', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- A quote-line SKU is the exact company bridge for the formerly global ProductFamily, and the
-- matching legacy metric text is the exact bridge for LicenseMetric plus ProductSku.metricId.
INSERT INTO product_families (id, vendor, name) VALUES
  ('u040_product_family', 'U040 Vendor', 'U040 Product')
ON CONFLICT DO NOTHING;
INSERT INTO product_editions (id, family_id, name, version) VALUES
  ('u040_product_edition', 'u040_product_family', 'U040 Edition', '1')
ON CONFLICT DO NOTHING;
INSERT INTO product_skus (id, edition_id, sku_code, name, unit_price, unit_cost, license_metric) VALUES
  ('u040_product_sku', 'u040_product_edition', 'U040-SKU', 'U040 SKU', 100, 60, 'seats')
ON CONFLICT DO NOTHING;
INSERT INTO license_metrics (id, key, name, unit) VALUES
  ('u040_license_metric', 'seats', 'Seats', 'seat')
ON CONFLICT DO NOTHING;
INSERT INTO quotes (id, opportunity_id, company_id, status, version, total_revenue, total_cost, margin_pct, created_by, created_at) VALUES
  ('u040_quote', 'u040_opportunity', 'u040_company', 'draft', 1, 100, 60, 40, 'u040-fixture', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
INSERT INTO quote_line_items (id, quote_id, sku_id, quantity, unit_price, cost_price, revenue, cost, margin_pct) VALUES
  ('u040_quote_line', 'u040_quote', 'u040_product_sku', 1, 100, 60, 100, 60, 40)
ON CONFLICT DO NOTHING;

-- U034 labels this legacy BANT record without rewriting its four original scores, technical-fit,
-- or total.  U038 derives both canonical certification links from the exact role/family match.
INSERT INTO deal_qualifications (id, opportunity_id, budget_score, authority_score, need_score, timeline_score, weighted_score, passed) VALUES
  ('u040_qualification', 'u040_opportunity', 10, 10, 12, 8, 40, true)
ON CONFLICT DO NOTHING;
INSERT INTO engineer_certifications (id, "engineerId", "productName", level, "isValid", "updatedAt") VALUES
  ('u040_certification', 'u040_engineer', 'U040 Product', 'professional', true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- U037 sees a valid legacy renewal asset (never guessed, nulled, or repointed).
INSERT INTO customer_assets (id, customer_id, asset_type, name, updated_at) VALUES
  ('u040_asset', 'u040_customer', 'subscription_product', 'U040 installed asset', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
INSERT INTO renewal_opportunities (id, customer_id, asset_id, renewal_type, updated_at) VALUES
  ('u040_renewal', 'u040_customer', 'u040_asset', 'subscription', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- One legacy SLA policy/case has an explicit deadline and receives a deterministic default
-- snapshot.  The no-deadline case is intentionally left without a snapshot rather than inferred.
INSERT INTO support_sla_policies (id, name, "responseTimeHrs", "resolutionTimeHrs", severity, "isActive", "updatedAt") VALUES
  ('u040_sla_policy', 'U040 Legacy SLA', 4, 24, 'medium', true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
INSERT INTO support_cases (id, customer_id, subject, severity, status, sla_deadline) VALUES
  ('u040_support_started', 'u040_customer', 'U040 started support', 'medium', 'open', CURRENT_TIMESTAMP + INTERVAL '1 day'),
  ('u040_support_no_start', 'u040_customer', 'U040 no start support', 'medium', 'open', NULL)
ON CONFLICT DO NOTHING;
