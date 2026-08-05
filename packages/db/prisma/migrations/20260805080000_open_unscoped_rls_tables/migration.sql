-- U073 (close_scope_rls_contracts) classified every table lacking
-- tenant/company/project columns as PROJECT_ROOT, whose generated predicate
-- fell through to `false` — a deny-all policy. 50 tables (the whole CFO
-- finance module, orchestration/telemetry/AI-infra tables) are therefore
-- unwritable by the application roles in production. None of them carry
-- scope columns, so the scoped contract cannot be enforced on them; the
-- original migration exempted a similar 9-table set for exactly this reason.
-- Exempt them the same way: disable RLS and drop the deny-all policy.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND qual::text = 'false'
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS sangfor_scope_%I ON %I', t.tablename, t.tablename);
  END LOOP;
END $$;
