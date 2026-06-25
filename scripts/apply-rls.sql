-- Sangfor Agentic OS — Row Level Security Policies
-- Run after Prisma migration: psql -d sangfor_os -f scripts/apply-rls.sql

-- App role (no BYPASSRLS)
DROP ROLE IF EXISTS sangfor_app;
CREATE ROLE sangfor_app WITH LOGIN PASSWORD 'sangfor_app_password' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO sangfor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sangfor_app;

-- Enable RLS on tenant-scoped tables
DO $$ DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename IN ('tenants', 'companies', 'users', 'user_company_roles',
      'customers', 'opportunities', 'quotes', 'quote_line_items',
      'vendor_requests', 'poc_projects', 'delivery_projects',
      'support_cases', 'customer_assets', 'renewal_opportunities')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (true);', tbl);
  END LOOP;
END $$;
