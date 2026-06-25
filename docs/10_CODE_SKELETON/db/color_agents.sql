-- V3.2 Color Agent Organization schema skeleton

CREATE TABLE IF NOT EXISTS color_agent_profiles (
    id UUID PRIMARY KEY,
    color_key TEXT NOT NULL CHECK (color_key IN ('blue', 'red', 'orange', 'gray', 'teal', 'purple')),
    display_name TEXT NOT NULL,
    responsibility TEXT NOT NULL,
    handoff_triggers JSONB NOT NULL DEFAULT '[]',
    output_contract JSONB NOT NULL DEFAULT '{}',
    is_core BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (color_key)
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    industry_pack_id UUID,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    context_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_color_agents (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id),
    color_agent_profile_id UUID NOT NULL REFERENCES color_agent_profiles(id),
    context_summary TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, color_agent_profile_id)
);

CREATE TABLE IF NOT EXISTS color_review_requirements (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    workflow_definition_id UUID,
    artifact_type TEXT,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    required_colors TEXT[] NOT NULL,
    optional_colors TEXT[] NOT NULL DEFAULT '{}',
    requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kanban_handoff_cards (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id),
    workflow_run_id UUID,
    linked_approval_id UUID,
    from_color TEXT NOT NULL CHECK (from_color IN ('blue', 'red', 'orange', 'gray', 'teal', 'purple')),
    to_color TEXT NOT NULL CHECK (to_color IN ('blue', 'red', 'orange', 'gray', 'teal', 'purple')),
    type TEXT NOT NULL CHECK (type IN ('review', 'decision', 'clarification', 'risk_check', 'ux_check', 'evidence_check')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'accepted', 'in_review', 'changes_requested', 'resolved', 'rejected', 'archived', 'escalated')),
    context TEXT NOT NULL,
    decision_needed TEXT NOT NULL,
    constraints JSONB NOT NULL DEFAULT '[]',
    suggested_answer TEXT,
    required_output JSONB NOT NULL DEFAULT '[]',
    linked_artifact_ids UUID[] NOT NULL DEFAULT '{}',
    due_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL,
    assigned_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handoff_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    handoff_card_id UUID NOT NULL REFERENCES kanban_handoff_cards(id),
    actor_user_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS color_agent_decisions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    company_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id),
    color_key TEXT NOT NULL CHECK (color_key IN ('blue', 'red', 'orange', 'gray', 'teal', 'purple')),
    artifact_id UUID,
    artifact_version_id UUID,
    approval_id UUID,
    decision TEXT NOT NULL CHECK (decision IN ('passed', 'failed', 'not_required', 'changes_requested')),
    rationale TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}',
    decided_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_color_agents_scope ON project_color_agents (tenant_id, company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_handoff_cards_scope_status ON kanban_handoff_cards (tenant_id, company_id, status);
CREATE INDEX IF NOT EXISTS idx_handoff_cards_to_color ON kanban_handoff_cards (tenant_id, company_id, to_color, status);
CREATE INDEX IF NOT EXISTS idx_color_decisions_artifact ON color_agent_decisions (tenant_id, company_id, artifact_id, artifact_version_id);

-- RLS should be enabled and forced for all tenant/company scoped tables.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_color_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_color_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE color_review_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE color_review_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE kanban_handoff_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_handoff_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE handoff_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_events FORCE ROW LEVEL SECURITY;
ALTER TABLE color_agent_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE color_agent_decisions FORCE ROW LEVEL SECURITY;

-- Policy example. Exact policies should be generated consistently with existing V3.1 rls.sql.
-- CREATE POLICY tenant_company_scope_projects ON projects
-- USING (
--   tenant_id::text = current_setting('app.tenant_id', true)
--   AND company_id::text = current_setting('app.company_id', true)
-- );
