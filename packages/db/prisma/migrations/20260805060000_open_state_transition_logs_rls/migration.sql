-- U073 (close_scope_rls_contracts) classified state_transition_logs as
-- PROJECT_ROOT, but the table carries no tenant/company/project columns, so the
-- generated policy predicate fell through to `false` — every logStateTransition
-- INSERT (POC creation, workflow/task/cursor/codex state transitions) fails in
-- production with "new row violates row-level security policy".
--
-- state_transition_logs is an operational event log without tenant data; it
-- belongs with the U073-exempt tables (ai_golden_answers, commands, …). Open it
-- the same way: disable RLS and drop the deny-all policy. The existing
-- GRANT … TO sangfor_app from U073 remains in effect.
ALTER TABLE state_transition_logs DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_state_transition_logs ON state_transition_logs;
