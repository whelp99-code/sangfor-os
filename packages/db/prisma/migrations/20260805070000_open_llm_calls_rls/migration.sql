-- Same U073 overshoot as state_transition_logs: llm_calls carries no
-- tenant/company/project columns, so its generated policy predicate fell to
-- `false` and every LLM telemetry write (recordLlmCall) failed in production
-- (the AI team page showed "LLM 호출 계측 0"). It is operational telemetry
-- without tenant data — exempt it like the other U073-exempt tables.
ALTER TABLE llm_calls DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sangfor_scope_llm_calls ON llm_calls;
