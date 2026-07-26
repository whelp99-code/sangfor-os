-- U073 / DB-01: close RLS over the complete 198-model inventory.
-- Eleven GLOBAL_SHARED tables remain outside tenant scope. Every other model table receives
-- ENABLE + FORCE RLS and exactly one canonical FOR ALL policy for sangfor_app. CHILD_VIA_FK
-- policies inherit visibility only through their declared mandatory parent FK. Legacy roots
-- without a canonical tenant/company/project column fail closed with USING (false).

CREATE TEMP TABLE u073_child_scope_edges (
  child_table text PRIMARY KEY,
  parent_table text NOT NULL,
  child_fk_column text NOT NULL
) ON COMMIT DROP;

INSERT INTO u073_child_scope_edges (child_table, parent_table, child_fk_column) VALUES
  ('agent_assignments', 'workflow_steps', 'workflow_step_id'),
  ('agent_decision_logs', 'agent_assignments', 'agent_assignment_id'),
  ('agent_messages', 'agent_assignments', 'agent_assignment_id'),
  ('ai_execution_costs', 'ai_executions', 'ai_execution_id'),
  ('ai_model_snapshots', 'ai_quality_assessments', 'assessment_id'),
  ('ai_prompt_snapshots', 'ai_quality_assessments', 'assessment_id'),
  ('ai_provider_attempts', 'ai_executions', 'ai_execution_id'),
  ('ai_quality_assessments', 'artifact_versions', 'artifact_version_id'),
  ('ai_quality_evidence', 'ai_quality_assessments', 'assessment_id'),
  ('ai_quality_reviews', 'ai_quality_assessments', 'assessment_id'),
  ('ai_release_evaluations', 'ai_quality_assessments', 'assessment_id'),
  ('approval_current_validity', 'approval_requests', 'approval_request_id'),
  ('approval_decisions', 'approval_requests', 'approval_request_id'),
  ('artifact_versions', 'artifacts', 'artifact_id'),
  ('asset_licenses', 'customer_assets', 'asset_id'),
  ('branches', 'repositories', 'repository_id'),
  ('certification_evidence', 'artifact_versions', 'artifact_version_id'),
  ('changed_files', 'code_changes', 'code_change_id'),
  ('codex_task_logs', 'codex_tasks', 'codex_task_id'),
  ('color_agent_decisions', 'kanban_handoff_cards', 'handoff_card_id'),
  ('color_review_requirements', 'kanban_handoff_cards', 'handoff_card_id'),
  ('command_runs', 'projects', 'project_id'),
  ('customer_activity_logs', 'customers', 'customer_id'),
  ('customer_assets', 'customers', 'customer_id'),
  ('customer_partner_links', 'customers', 'customer_id'),
  ('deal_qualifications', 'opportunities', 'opportunity_id'),
  ('deal_registrations', 'opportunities', 'opportunity_id'),
  ('delivery_acceptances', 'delivery_projects', 'engagement_id'),
  ('delivery_checklist_items', 'delivery_projects', 'delivery_id'),
  ('delivery_projects', 'opportunities', 'opportunity_id'),
  ('demo_licenses', 'customers', 'customer_id'),
  ('discount_requests', 'quotes', 'quote_id'),
  ('document_versions', 'generated_documents', 'generated_document_id'),
  ('domain_decision_logs', 'projects', 'project_id'),
  ('domain_memories', 'projects', 'project_id'),
  ('engagement_capability_requirements', 'delivery_projects', 'engagement_id'),
  ('engineer_assignments', 'engagement_capability_requirements', 'requirement_id'),
  ('export_capabilities', 'data_export_requests', 'export_request_id'),
  ('finance_chat_messages', 'finance_chat_sessions', 'session_id'),
  ('generated_documents', 'document_templates', 'template_id'),
  ('handoff_events', 'kanban_handoff_cards', 'card_id'),
  ('intent_analyses', 'command_runs', 'command_run_id'),
  ('knowledge_chunks', 'knowledge_documents', 'document_id'),
  ('license_metrics', 'product_families', 'product_family_id'),
  ('mail_evidence_links', 'mail_derived_candidates', 'mail_derived_candidate_id'),
  ('mail_insight_threads', 'projects', 'project_id'),
  ('mail_messages', 'mail_accounts', 'account_id'),
  ('maintenance_contracts', 'customer_assets', 'asset_id'),
  ('metric_benchmark_versions', 'metric_definitions', 'metric_definition_id'),
  ('metric_daily_snapshots', 'metric_definitions', 'metric_definition_id'),
  ('opportunity_links', 'opportunities', 'opportunity_id'),
  ('opportunity_stage_events', 'opportunities', 'opportunity_id'),
  ('ownership_transfer_items', 'ownership_transfers', 'ownership_transfer_id'),
  ('ownership_transfers', 'user_company_roles', 'source_assignment_id'),
  ('personas', 'companies', 'company_id'),
  ('poc_checklist_items', 'poc_projects', 'poc_project_id'),
  ('poc_events', 'poc_projects', 'poc_project_id'),
  ('poc_issues', 'poc_projects', 'poc_project_id'),
  ('poc_requirements', 'poc_projects', 'poc_project_id'),
  ('poc_result_reports', 'poc_projects', 'poc_project_id'),
  ('product_editions', 'product_families', 'family_id'),
  ('product_skus', 'product_editions', 'edition_id'),
  ('compatibility_rules', 'product_skus', 'source_sku_id'),
  ('policy_decision_logs', 'projects', 'project_id'),
  ('policy_memories', 'projects', 'project_id'),
  ('project_members', 'projects', 'project_id'),
  ('pull_requests', 'repositories', 'repository_id'),
  ('quote_commercial_snapshots', 'quotes', 'quote_id'),
  ('quote_line_items', 'quotes', 'quote_id'),
  ('quote_service_line_items', 'opportunities', 'opportunity_id'),
  ('quotes', 'opportunities', 'opportunity_id'),
  ('renewal_opportunities', 'customers', 'customer_id'),
  ('renewal_reminder_events', 'renewal_opportunities', 'renewal_opportunity_id'),
  ('reports', 'validation_results', 'validation_result_id'),
  ('retention_assignments', 'retention_policy_versions', 'policy_version_id'),
  ('retention_policy_versions', 'retention_policies', 'policy_id'),
  ('retention_run_items', 'retention_runs', 'retention_run_id'),
  ('risk_analyses', 'command_runs', 'command_run_id'),
  ('role_change_requests', 'companies', 'company_id'),
  ('scheduler_run_attempts', 'scheduler_runs', 'run_id'),
  ('scheduler_runs', 'scheduler_jobs', 'job_id'),
  ('subscriptions', 'customer_assets', 'asset_id'),
  ('support_case_sla_snapshots', 'support_cases', 'support_case_id'),
  ('support_cases', 'customers', 'customer_id'),
  ('task_links', 'work_tasks', 'work_task_id'),
  ('task_status_events', 'work_tasks', 'work_task_id'),
  ('tool_calls', 'agent_assignments', 'agent_assignment_id'),
  ('user_company_roles', 'companies', 'company_id'),
  ('validation_checks', 'validation_plans', 'plan_id'),
  ('validation_results', 'workflow_steps', 'workflow_step_id'),
  ('vendor_escalations', 'support_cases', 'case_id'),
  ('vendor_request_events', 'vendor_requests', 'request_id'),
  ('workflow_run_artifacts', 'workflow_runs', 'workflow_run_id'),
  ('workflow_run_events', 'workflow_runs', 'workflow_run_id'),
  ('workflow_run_steps', 'workflow_runs', 'workflow_run_id'),
  ('workflow_steps', 'workflows', 'workflow_id'),
  ('workflows', 'command_runs', 'command_run_id');

CREATE TEMP TABLE u073_root_scope_categories (
  table_name text PRIMARY KEY,
  scope_category text NOT NULL CHECK (scope_category IN ('TENANT_ROOT', 'COMPANY_ROOT', 'COMPANY_DIRECT', 'PROJECT_ROOT'))
) ON COMMIT DROP;

INSERT INTO u073_root_scope_categories (table_name, scope_category) VALUES
  ('audit_logs', 'TENANT_ROOT'),
  ('tenants', 'TENANT_ROOT'),
  ('agent_assignment_rules', 'COMPANY_ROOT'),
  ('agent_playbooks', 'COMPANY_ROOT'),
  ('ai_evaluation_datasets', 'COMPANY_ROOT'),
  ('ai_models', 'COMPANY_ROOT'),
  ('autonomy_policies', 'COMPANY_ROOT'),
  ('certification_definitions', 'COMPANY_ROOT'),
  ('companies', 'COMPANY_ROOT'),
  ('connector_registry', 'COMPANY_ROOT'),
  ('engineer_certifications', 'COMPANY_ROOT'),
  ('engineer_eligibility_policies', 'COMPANY_ROOT'),
  ('engineer_skills', 'COMPANY_ROOT'),
  ('error_events', 'COMPANY_ROOT'),
  ('execution_policies', 'COMPANY_ROOT'),
  ('finance_accounts', 'COMPANY_ROOT'),
  ('finance_cashflows', 'COMPANY_ROOT'),
  ('finance_chat_sessions', 'COMPANY_ROOT'),
  ('finance_company_settings', 'COMPANY_ROOT'),
  ('finance_expenses', 'COMPANY_ROOT'),
  ('finance_invoices', 'COMPANY_ROOT'),
  ('finance_ledger_entries', 'COMPANY_ROOT'),
  ('finance_month_closes', 'COMPANY_ROOT'),
  ('finance_projects', 'COMPANY_ROOT'),
  ('finance_subscriptions', 'COMPANY_ROOT'),
  ('finance_tax_invoices', 'COMPANY_ROOT'),
  ('legal_holds', 'COMPANY_ROOT'),
  ('memory_items', 'COMPANY_ROOT'),
  ('metric_definitions', 'COMPANY_ROOT'),
  ('notification_events', 'COMPANY_ROOT'),
  ('product_families', 'COMPANY_ROOT'),
  ('quality_gates', 'COMPANY_ROOT'),
  ('repositories', 'COMPANY_ROOT'),
  ('retention_policies', 'COMPANY_ROOT'),
  ('runtime_policies', 'COMPANY_ROOT'),
  ('scheduler_jobs', 'COMPANY_ROOT'),
  ('sizing_templates', 'COMPANY_ROOT'),
  ('skill_catalog_items', 'COMPANY_ROOT'),
  ('support_sla_policies', 'COMPANY_ROOT'),
  ('support_sla_policy_versions', 'COMPANY_ROOT'),
  ('artifact_access_events', 'COMPANY_DIRECT'),
  ('data_export_requests', 'COMPANY_DIRECT'),
  ('legal_hold_scopes', 'COMPANY_DIRECT'),
  ('retention_runs', 'COMPANY_DIRECT'),
  ('ai_executions', 'PROJECT_ROOT'),
  ('ai_prompt_runs', 'PROJECT_ROOT'),
  ('ai_quality_results', 'PROJECT_ROOT'),
  ('approval_requests', 'PROJECT_ROOT'),
  ('artifacts', 'PROJECT_ROOT'),
  ('auth_sessions', 'PROJECT_ROOT'),
  ('block_registry', 'PROJECT_ROOT'),
  ('build_runs', 'PROJECT_ROOT'),
  ('canvases', 'PROJECT_ROOT'),
  ('code_changes', 'PROJECT_ROOT'),
  ('codex_tasks', 'PROJECT_ROOT'),
  ('command_notification_events', 'PROJECT_ROOT'),
  ('config_values', 'PROJECT_ROOT'),
  ('contacts', 'PROJECT_ROOT'),
  ('cost_events', 'PROJECT_ROOT'),
  ('cursor_sessions', 'PROJECT_ROOT'),
  ('customers', 'PROJECT_ROOT'),
  ('document_templates', 'PROJECT_ROOT'),
  ('github_issues', 'PROJECT_ROOT'),
  ('improvement_candidates', 'PROJECT_ROOT'),
  ('kanban_handoff_cards', 'PROJECT_ROOT'),
  ('knowledge_documents', 'PROJECT_ROOT'),
  ('layout_slots', 'PROJECT_ROOT'),
  ('llm_calls', 'PROJECT_ROOT'),
  ('mail_accounts', 'PROJECT_ROOT'),
  ('mail_derived_candidates', 'PROJECT_ROOT'),
  ('meeting_notes', 'PROJECT_ROOT'),
  ('node_registry', 'PROJECT_ROOT'),
  ('opportunities', 'PROJECT_ROOT'),
  ('outbox_events', 'PROJECT_ROOT'),
  ('partners', 'PROJECT_ROOT'),
  ('poc_projects', 'PROJECT_ROOT'),
  ('portal_tasks', 'PROJECT_ROOT'),
  ('project_color_agents', 'PROJECT_ROOT'),
  ('projects', 'PROJECT_ROOT'),
  ('query_registry', 'PROJECT_ROOT'),
  ('review_threads', 'PROJECT_ROOT'),
  ('run_timeline_items', 'PROJECT_ROOT'),
  ('skill_runs', 'PROJECT_ROOT'),
  ('state_transition_logs', 'PROJECT_ROOT'),
  ('test_runs', 'PROJECT_ROOT'),
  ('validation_plans', 'PROJECT_ROOT'),
  ('vendor_requests', 'PROJECT_ROOT'),
  ('work_breakdown_items', 'PROJECT_ROOT'),
  ('work_tasks', 'PROJECT_ROOT'),
  ('workflow_definitions', 'PROJECT_ROOT'),
  ('workflow_runs', 'PROJECT_ROOT'),
  ('workflow_templates', 'PROJECT_ROOT'),
  ('workspaces', 'PROJECT_ROOT');

DO $$
DECLARE
  scoped_count integer;
  scoped record;
  existing_policy record;
  edge record;
  root_category text;
  predicate_sql text;
  has_tenant boolean;
  has_company boolean;
  has_project boolean;
BEGIN
  SELECT count(*) INTO scoped_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name <> '_prisma_migrations'
    AND table_name NOT IN (
      'ai_golden_answers', 'ai_prompt_templates', 'color_agent_profiles', 'commands',
      'config_profiles', 'module_registry', 'scope_backfill_quarantine', 'users'
    );

  IF scoped_count <> 190 THEN
    RAISE EXCEPTION 'U073 scoped table denominator mismatch: expected 190, got %', scoped_count;
  END IF;

  IF (SELECT count(*) FROM u073_child_scope_edges) <> 97 THEN
    RAISE EXCEPTION 'U073 CHILD_VIA_FK denominator mismatch';
  END IF;
  IF (SELECT count(*) FROM u073_root_scope_categories) <> 93 THEN
    RAISE EXCEPTION 'U073 root scope denominator mismatch';
  END IF;

  FOR scoped IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
      AND table_name NOT IN (
        'ai_golden_answers', 'ai_prompt_templates', 'color_agent_profiles', 'commands',
        'config_profiles', 'module_registry', 'scope_backfill_quarantine', 'users'
      )
    ORDER BY table_name
  LOOP
    FOR existing_policy IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = scoped.table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON %I', existing_policy.policyname, scoped.table_name);
    END LOOP;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', scoped.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', scoped.table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM sangfor_app_login', scoped.table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO sangfor_app', scoped.table_name);

    SELECT * INTO edge FROM u073_child_scope_edges WHERE child_table = scoped.table_name;
    IF FOUND THEN
      predicate_sql := format(
        'EXISTS (SELECT 1 FROM %I AS scope_parent WHERE scope_parent.id = %I.%I)',
        edge.parent_table,
        scoped.table_name,
        edge.child_fk_column
      );
    ELSE
      SELECT scope_category INTO root_category FROM u073_root_scope_categories WHERE table_name = scoped.table_name;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'U073 scoped table lacks root/child classification: %', scoped.table_name;
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = scoped.table_name AND column_name = 'tenant_id'
      ) INTO has_tenant;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = scoped.table_name AND column_name = 'company_id'
      ) INTO has_company;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = scoped.table_name AND column_name = 'project_id'
      ) INTO has_project;

      IF scoped.table_name = 'tenants' THEN
        predicate_sql := format('%I.id = current_setting(''app.tenant_id'', true)', scoped.table_name);
      ELSIF scoped.table_name = 'companies' THEN
        predicate_sql := format('%I.id = current_setting(''app.company_id'', true) AND %I.tenant_id = current_setting(''app.tenant_id'', true)', scoped.table_name, scoped.table_name);
      ELSIF scoped.table_name = 'projects' THEN
        predicate_sql := format(
          '%I.id = current_setting(''app.project_id'', true) AND %I.company_id = current_setting(''app.company_id'', true) AND EXISTS (SELECT 1 FROM companies AS scope_company WHERE scope_company.id = %I.company_id AND scope_company.tenant_id = current_setting(''app.tenant_id'', true))',
          scoped.table_name,
          scoped.table_name,
          scoped.table_name
        );
      ELSIF root_category = 'PROJECT_ROOT' AND has_project THEN
        predicate_sql := format(
          '%I.project_id = current_setting(''app.project_id'', true) AND EXISTS (SELECT 1 FROM projects AS scope_project JOIN companies AS scope_company ON scope_company.id = scope_project.company_id WHERE scope_project.id = %I.project_id AND scope_project.company_id = current_setting(''app.company_id'', true) AND scope_company.tenant_id = current_setting(''app.tenant_id'', true))',
          scoped.table_name,
          scoped.table_name
        );
      ELSIF root_category IN ('COMPANY_ROOT', 'COMPANY_DIRECT') AND has_company THEN
        predicate_sql := format(
          '%I.company_id = current_setting(''app.company_id'', true) AND EXISTS (SELECT 1 FROM companies AS scope_company WHERE scope_company.id = %I.company_id AND scope_company.tenant_id = current_setting(''app.tenant_id'', true))',
          scoped.table_name,
          scoped.table_name
        );
      ELSIF root_category = 'TENANT_ROOT' AND has_tenant THEN
        predicate_sql := format('%I.tenant_id = current_setting(''app.tenant_id'', true)', scoped.table_name);
      ELSE
        predicate_sql := 'false';
      END IF;
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO sangfor_app USING (%s) WITH CHECK (%s)',
      'sangfor_scope_' || scoped.table_name,
      scoped.table_name,
      predicate_sql,
      predicate_sql
    );
  END LOOP;
END $$;

ALTER ROLE sangfor_app NOBYPASSRLS;
ALTER ROLE sangfor_app_login NOBYPASSRLS;
