-- U016/DB-01: transaction-bound RLS pilot for six tables (companies, projects,
-- user_company_roles, project_members, customers, opportunities). No PASSWORD appears anywhere in
-- this file — sangfor_app_login's connection secret is generated and set out-of-band, per row, by
-- the test/deploy harness (see scripts/lib/isolated-postgres.mjs applicationRoleMode="required");
-- production credential provisioning/rotation is an external operations responsibility.

-- Step 1: the two roles. sangfor_app is the NOLOGIN policy role every scoped query runs as (after
-- an explicit SET ROLE); sangfor_app_login is the LOGIN connection role with no privileges of its
-- own, so a direct connection as sangfor_app_login (without SET ROLE) can reach no pilot table.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sangfor_app') THEN
    CREATE ROLE sangfor_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sangfor_app_login') THEN
    CREATE ROLE sangfor_app_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- SET TRUE without INHERIT TRUE: sangfor_app_login may SET ROLE sangfor_app explicitly, but never
-- automatically inherits sangfor_app's privileges just by being a member.
GRANT sangfor_app TO sangfor_app_login WITH INHERIT FALSE, SET TRUE;

-- Step 2: fail-closed schema/table/sequence grants — exact, no ALL TABLES/SEQUENCES, no default
-- privileges. sangfor_app_login receives no direct grant at all (below is defensive/explicit).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM sangfor_app;
REVOKE CREATE ON SCHEMA public FROM sangfor_app_login;
GRANT USAGE ON SCHEMA public TO sangfor_app;

REVOKE ALL ON TABLE
  companies, projects, user_company_roles, project_members, customers, opportunities
FROM sangfor_app_login;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  companies, projects, user_company_roles, project_members, customers, opportunities
TO sangfor_app;

-- Grant USAGE/SELECT only on sequences actually owned by these six tables' columns (none of the
-- six use a serial/identity id today — every id is an app-generated cuid — so this loop currently
-- grants nothing; it stays dynamic rather than hardcoding a sequence name so it keeps being exact
-- if that ever changes).
DO $$
DECLARE
  seq RECORD;
BEGIN
  FOR seq IN
    SELECT n.nspname AS schema_name, c.relname AS seq_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
    JOIN pg_class owner_tbl ON owner_tbl.oid = d.refobjid
    WHERE c.relkind = 'S'
      AND owner_tbl.relname IN ('companies', 'projects', 'user_company_roles', 'project_members', 'customers', 'opportunities')
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %I.%I FROM sangfor_app_login', seq.schema_name, seq.seq_name);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO sangfor_app', seq.schema_name, seq.seq_name);
  END LOOP;
END $$;

-- Step 3: ENABLE + FORCE ROW LEVEL SECURITY on all six, then the six exact named policies. Every
-- policy is FOR ALL with identical USING/WITH CHECK (never USING (true)); project-root tables
-- compare project_id to app.project_id, never app.company_id — see packages/db/src/rls.ts
-- (RLS_PILOT_POLICIES) for the same predicates as importable/testable TypeScript strings.

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_companies ON companies;
CREATE POLICY sangfor_scope_companies ON companies
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    AND id = current_setting('app.company_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    AND id = current_setting('app.company_id', true)
  );

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_projects ON projects;
CREATE POLICY sangfor_scope_projects ON projects
  FOR ALL
  USING (
    company_id = current_setting('app.company_id', true)
    AND id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = projects.company_id
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    company_id = current_setting('app.company_id', true)
    AND id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = projects.company_id
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE user_company_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_company_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_user_company_roles ON user_company_roles;
CREATE POLICY sangfor_scope_user_company_roles ON user_company_roles
  FOR ALL
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_project_members ON project_members;
CREATE POLICY sangfor_scope_project_members ON project_members
  FOR ALL
  USING (
    project_id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE projects.id = project_members.project_id
        AND projects.company_id = current_setting('app.company_id', true)
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    project_id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE projects.id = project_members.project_id
        AND projects.company_id = current_setting('app.company_id', true)
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_customers ON customers;
CREATE POLICY sangfor_scope_customers ON customers
  FOR ALL
  USING (
    project_id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE projects.id = customers.project_id
        AND projects.company_id = current_setting('app.company_id', true)
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    project_id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE projects.id = customers.project_id
        AND projects.company_id = current_setting('app.company_id', true)
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_opportunities ON opportunities;
CREATE POLICY sangfor_scope_opportunities ON opportunities
  FOR ALL
  USING (
    project_id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE projects.id = opportunities.project_id
        AND projects.company_id = current_setting('app.company_id', true)
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    project_id = current_setting('app.project_id', true)
    AND EXISTS (
      SELECT 1 FROM projects
      JOIN companies ON companies.id = projects.company_id
      WHERE projects.id = opportunities.project_id
        AND projects.company_id = current_setting('app.company_id', true)
        AND companies.tenant_id = current_setting('app.tenant_id', true)
    )
  );
