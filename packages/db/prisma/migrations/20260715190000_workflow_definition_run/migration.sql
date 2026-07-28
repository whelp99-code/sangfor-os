-- U019/WF-01a: canonical, versioned M6 workflow persistence — WorkflowDefinition, WorkflowRun,
-- WorkflowRunStep, WorkflowRunArtifact, WorkflowRunEvent. Schema only: this migration installs the
-- named status/CHECK/transition guards as DB triggers/CHECK constraints but performs ZERO
-- transition itself — it seeds no row, activates no definition, increments no revision beyond the
-- Prisma-managed table defaults, and starts no run. U025 is the first runtime consumer
-- (activation/start/step execution/approval-validity evaluation); U020 is the first unit to write
-- a legacy_disabled definition / legacy_imported run and the restricted legacy_unreviewed
-- ArtifactVersion they require. The pre-existing command-simulation `workflows`/`workflow_steps`
-- and placeholder `workflow_templates` tables are untouched by this migration.
--
-- Every WorkflowDefinition's own content-hash envelope reuses U017's existing
-- sangfor_rfc8785_jcs_v1/sangfor_sha256_utf8 PostgreSQL functions and
-- packages/db/src/canonical-content-hash.ts on the JS side exclusively — this migration installs
-- NO second serializer/hash envelope. Append-only workflow_run_events reuses U017's existing
-- sangfor_deny_mutation() function verbatim (no redefinition).

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'workflow_definition_run migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'workflow_definition_run migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 1: tables (Prisma-managed shape — mirrors schema.prisma exactly; the custom
-- functions/triggers/CHECK constraints below are additive and outside Prisma's DSL, same pattern
-- as every sibling migration in this campaign).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "workflow_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "definition_artifact_version_id" TEXT NOT NULL,
    "definition_hash_version" TEXT NOT NULL,
    "definition_hash" TEXT NOT NULL,
    "definition_json" JSONB NOT NULL,
    "created_by_assignment_id" TEXT NOT NULL,
    "activation_approval_request_id" TEXT,
    "activation_approval_request_revision" INTEGER,
    "activation_approval_artifact_version_id" TEXT,
    "activation_approval_artifact_hash" TEXT,
    "activation_approval_policy_hash" TEXT,
    "activation_approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "workflow_definition_id" TEXT NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "definition_artifact_version_id" TEXT NOT NULL,
    "definition_artifact_hash_version" TEXT NOT NULL,
    "definition_artifact_hash" TEXT NOT NULL,
    "activation_approval_request_id" TEXT,
    "activation_approval_request_revision" INTEGER,
    "activation_approval_artifact_version_id" TEXT,
    "activation_approval_artifact_hash" TEXT,
    "activation_approval_policy_hash" TEXT,
    "activation_approved_at" TIMESTAMP(3),
    "run_approval_request_id" TEXT,
    "run_approval_request_revision" INTEGER,
    "run_approval_artifact_version_id" TEXT,
    "run_approval_artifact_hash" TEXT,
    "run_approval_policy_hash" TEXT,
    "run_approved_at" TIMESTAMP(3),
    "requested_by_assignment_id" TEXT NOT NULL,
    "requested_session_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input_json" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "legacy_source_type" TEXT,
    "legacy_source_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_run_steps" (
    "id" TEXT NOT NULL,
    "workflow_run_id" TEXT NOT NULL,
    "step_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "definition_json" JSONB,
    "input_json" JSONB,
    "output_json" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_run_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_run_artifacts" (
    "id" TEXT NOT NULL,
    "workflow_run_id" TEXT NOT NULL,
    "artifact_version_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_run_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_run_events" (
    "id" TEXT NOT NULL,
    "workflow_run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_assignment_id" TEXT,
    "actor_session_id" TEXT,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_run_events_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2: indexes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "workflow_definitions_project_id_workflow_key_version_key" ON "workflow_definitions"("project_id", "workflow_key", "version");
CREATE INDEX "workflow_definitions_company_id_project_id_workflow_key_idx" ON "workflow_definitions"("company_id", "project_id", "workflow_key");
-- Partial unique: at most one ACTIVE version per (project_id, workflow_key). Never applies to any
-- other status — duplicate draft/retired/legacy_disabled rows for the same key are unaffected.
CREATE UNIQUE INDEX "workflow_definitions_one_active_per_key_idx" ON "workflow_definitions"("project_id", "workflow_key") WHERE "status" = 'active';

CREATE UNIQUE INDEX "workflow_runs_project_id_idempotency_key_key" ON "workflow_runs"("project_id", "idempotency_key");
CREATE UNIQUE INDEX "workflow_runs_legacy_source_key" ON "workflow_runs"("legacy_source_type", "legacy_source_id");
CREATE INDEX "workflow_runs_company_id_project_id_workflow_definition_id_idx" ON "workflow_runs"("company_id", "project_id", "workflow_definition_id");
CREATE INDEX "workflow_runs_workflow_definition_id_status_idx" ON "workflow_runs"("workflow_definition_id", "status");

CREATE UNIQUE INDEX "workflow_run_steps_workflow_run_id_step_key_key" ON "workflow_run_steps"("workflow_run_id", "step_key");
CREATE INDEX "workflow_run_steps_workflow_run_id_sort_order_idx" ON "workflow_run_steps"("workflow_run_id", "sort_order");

CREATE UNIQUE INDEX "workflow_run_artifacts_run_id_artifact_version_role_key" ON "workflow_run_artifacts"("workflow_run_id", "artifact_version_id", "role");

CREATE UNIQUE INDEX "workflow_run_events_workflow_run_id_sequence_key" ON "workflow_run_events"("workflow_run_id", "sequence");

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3: foreign keys.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- U012-compatible composite scope-closure FKs, same pattern as Artifact/ApprovalRequest.
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_definition_artifact_version_id_fkey" FOREIGN KEY ("definition_artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Distinct exact U012 composite assignment FK (user_company_roles_id_company_id_key) — never an
-- ID-only assignment FK: a created_by_assignment_id naming a real user_company_roles.id belonging
-- to a DIFFERENT company is rejected by Postgres itself.
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_assignment_id_fkey" FOREIGN KEY ("created_by_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_requested_by_assignment_id_fkey" FOREIGN KEY ("requested_by_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_run_artifacts" ADD CONSTRAINT "workflow_run_artifacts_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_run_artifacts" ADD CONSTRAINT "workflow_run_artifacts_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 4: CHECK constraints (state invariants expressible without a subquery; OLD/NEW and
-- cross-row logic lives in the triggers in Step 5, same split as artifact_identity's Step 3/4).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_version_positive_check" CHECK (version > 0);
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_revision_check" CHECK (revision >= 0);
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_status_check" CHECK (status IN ('draft', 'active', 'retired', 'legacy_disabled'));
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_definition_hash_version_check" CHECK (definition_hash_version = 'artifact-content/rfc8785-jcs-sha256/v1');
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_definition_hash_format_check" CHECK (definition_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_activation_request_revision_check" CHECK (activation_approval_request_revision IS NULL OR activation_approval_request_revision >= 0);
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_activation_artifact_hash_format_check" CHECK (activation_approval_artifact_hash IS NULL OR activation_approval_artifact_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_activation_policy_hash_format_check" CHECK (activation_approval_policy_hash IS NULL OR activation_approval_policy_hash ~ '^[0-9a-f]{64}$');
-- All-or-none activation snapshot (same row, no subquery).
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_activation_all_or_none_check" CHECK (
  (activation_approval_request_id IS NULL AND activation_approval_request_revision IS NULL AND activation_approval_artifact_version_id IS NULL AND activation_approval_artifact_hash IS NULL AND activation_approval_policy_hash IS NULL AND activation_approved_at IS NULL)
  OR
  (activation_approval_request_id IS NOT NULL AND activation_approval_request_revision IS NOT NULL AND activation_approval_artifact_version_id IS NOT NULL AND activation_approval_artifact_hash IS NOT NULL AND activation_approval_policy_hash IS NOT NULL AND activation_approved_at IS NOT NULL)
);
-- An `active` row's activation snapshot must be complete (combined with the all-or-none CHECK
-- above, this forces every one of the six fields non-null exactly when status='active').
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_active_requires_snapshot_check" CHECK (status <> 'active' OR activation_approval_request_id IS NOT NULL);
-- The activation snapshot's artifact-version/hash must byte-match THIS row's own definition
-- artifact identity ("matching its exact definition ArtifactVersion") — same row, no subquery.
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_activation_artifact_version_matches_check" CHECK (activation_approval_artifact_version_id IS NULL OR activation_approval_artifact_version_id = definition_artifact_version_id);
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_activation_artifact_hash_matches_check" CHECK (activation_approval_artifact_hash IS NULL OR activation_approval_artifact_hash = definition_hash);

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_definition_version_positive_check" CHECK (definition_version > 0);
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_revision_check" CHECK (revision >= 0);
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_status_check" CHECK (status IN ('pending', 'running', 'blocked', 'succeeded', 'failed', 'cancelled', 'legacy_imported'));
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_definition_artifact_hash_version_check" CHECK (definition_artifact_hash_version = 'artifact-content/rfc8785-jcs-sha256/v1');
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_definition_artifact_hash_format_check" CHECK (definition_artifact_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_activation_request_revision_check" CHECK (activation_approval_request_revision IS NULL OR activation_approval_request_revision >= 0);
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_activation_artifact_hash_format_check" CHECK (activation_approval_artifact_hash IS NULL OR activation_approval_artifact_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_activation_policy_hash_format_check" CHECK (activation_approval_policy_hash IS NULL OR activation_approval_policy_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_activation_all_or_none_check" CHECK (
  (activation_approval_request_id IS NULL AND activation_approval_request_revision IS NULL AND activation_approval_artifact_version_id IS NULL AND activation_approval_artifact_hash IS NULL AND activation_approval_policy_hash IS NULL AND activation_approved_at IS NULL)
  OR
  (activation_approval_request_id IS NOT NULL AND activation_approval_request_revision IS NOT NULL AND activation_approval_artifact_version_id IS NOT NULL AND activation_approval_artifact_hash IS NOT NULL AND activation_approval_policy_hash IS NOT NULL AND activation_approved_at IS NOT NULL)
);
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_run_gate_request_revision_check" CHECK (run_approval_request_revision IS NULL OR run_approval_request_revision >= 0);
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_run_gate_artifact_hash_format_check" CHECK (run_approval_artifact_hash IS NULL OR run_approval_artifact_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_run_gate_policy_hash_format_check" CHECK (run_approval_policy_hash IS NULL OR run_approval_policy_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_run_gate_all_or_none_check" CHECK (
  (run_approval_request_id IS NULL AND run_approval_request_revision IS NULL AND run_approval_artifact_version_id IS NULL AND run_approval_artifact_hash IS NULL AND run_approval_policy_hash IS NULL AND run_approved_at IS NULL)
  OR
  (run_approval_request_id IS NOT NULL AND run_approval_request_revision IS NOT NULL AND run_approval_artifact_version_id IS NOT NULL AND run_approval_artifact_hash IS NOT NULL AND run_approval_policy_hash IS NOT NULL AND run_approved_at IS NOT NULL)
);

ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_status_check" CHECK (status IN ('pending', 'running', 'blocked', 'succeeded', 'failed', 'skipped', 'cancelled'));
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_revision_check" CHECK (revision >= 0);
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_sort_order_check" CHECK (sort_order >= 0);

ALTER TABLE "workflow_run_artifacts" ADD CONSTRAINT "workflow_run_artifacts_direction_check" CHECK (direction IN ('input', 'output'));

ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_sequence_positive_check" CHECK (sequence > 0);

-- ─────────────────────────────────────────────────────────────────────────
-- Step 5: triggers.
-- ─────────────────────────────────────────────────────────────────────────

-- workflow_definitions guard: definition-artifact join/consistency at INSERT (and whenever
-- definition_artifact_version_id changes while still draft), full identity immutability once the
-- row leaves draft (except the single active->retired status transition), the exactly-plus-one
-- revision CAS on every UPDATE, the `active` structural ApprovalCurrentValidity existence check
-- (never asserts state=valid — U025 does), and the `legacy_disabled` restricted
-- legacy_unreviewed-ArtifactVersion requirement.
CREATE OR REPLACE FUNCTION public.sangfor_workflow_definition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_artifact RECORD;
  v_check_artifact boolean := false;
  v_gate_request RECORD;
  v_def_artifact_status text;
  v_allowed_next text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_check_artifact := true;
    IF NEW.revision <> 0 THEN
      RAISE EXCEPTION 'workflow_definitions: a new row must begin at revision 0, got %', NEW.revision
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.definition_artifact_version_id IS DISTINCT FROM OLD.definition_artifact_version_id THEN
      v_check_artifact := true;
    END IF;

    IF OLD.status <> 'draft' THEN
      -- Immutable once left draft, except the exact status transition below and updated_at.
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.company_id IS DISTINCT FROM OLD.company_id
         OR NEW.project_id IS DISTINCT FROM OLD.project_id
         OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.definition_artifact_version_id IS DISTINCT FROM OLD.definition_artifact_version_id
         OR NEW.definition_hash_version IS DISTINCT FROM OLD.definition_hash_version
         OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
         OR NEW.definition_json IS DISTINCT FROM OLD.definition_json
         OR NEW.created_by_assignment_id IS DISTINCT FROM OLD.created_by_assignment_id
         OR NEW.activation_approval_request_id IS DISTINCT FROM OLD.activation_approval_request_id
         OR NEW.activation_approval_request_revision IS DISTINCT FROM OLD.activation_approval_request_revision
         OR NEW.activation_approval_artifact_version_id IS DISTINCT FROM OLD.activation_approval_artifact_version_id
         OR NEW.activation_approval_artifact_hash IS DISTINCT FROM OLD.activation_approval_artifact_hash
         OR NEW.activation_approval_policy_hash IS DISTINCT FROM OLD.activation_approval_policy_hash
         OR NEW.activation_approved_at IS DISTINCT FROM OLD.activation_approved_at
      THEN
        RAISE EXCEPTION 'workflow_definitions: a definition row/version cannot be edited after leaving draft (identity/snapshot is immutable)'
          USING ERRCODE = '22023';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_allowed_next := CASE OLD.status
          WHEN 'active' THEN ARRAY['retired']
          ELSE ARRAY[]::text[]
        END;
        IF NOT (NEW.status = ANY(v_allowed_next)) THEN
          RAISE EXCEPTION 'workflow_definitions: illegal status transition % -> %', OLD.status, NEW.status
            USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      -- Still draft on OLD: only draft->draft, draft->active, draft->legacy_disabled are legal.
      IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('draft', 'active', 'legacy_disabled') THEN
        RAISE EXCEPTION 'workflow_definitions: illegal status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
      RAISE EXCEPTION 'workflow_definitions: revision must increment by exactly 1 on every UPDATE (old=%, new=%)', OLD.revision, NEW.revision
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_check_artifact THEN
    SELECT av.content_hash_version AS content_hash_version, av.content_hash AS content_hash, av.content_json AS content_json,
           a.tenant_id AS tenant_id, a.company_id AS company_id, a.project_id AS project_id, a.artifact_type AS artifact_type
    INTO v_artifact
    FROM artifact_versions av
    JOIN artifacts a ON a.id = av.artifact_id
    WHERE av.id = NEW.definition_artifact_version_id;

    IF v_artifact.content_hash IS NULL THEN
      RAISE EXCEPTION 'workflow_definitions: definition_artifact_version_id % does not reference an existing artifact_versions row', NEW.definition_artifact_version_id
        USING ERRCODE = '23503';
    END IF;

    IF v_artifact.artifact_type IS DISTINCT FROM 'workflow-definition' THEN
      RAISE EXCEPTION 'workflow_definitions: definition_artifact_version_id % does not reference a workflow-definition artifact (found artifact_type=%)', NEW.definition_artifact_version_id, v_artifact.artifact_type
        USING ERRCODE = '22023';
    END IF;

    IF v_artifact.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR v_artifact.company_id IS DISTINCT FROM NEW.company_id
       OR v_artifact.project_id IS DISTINCT FROM NEW.project_id
    THEN
      RAISE EXCEPTION 'workflow_definitions: tenant/company/project scope does not match the referenced ArtifactVersion''s parent Artifact (scope mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_artifact.content_hash_version IS DISTINCT FROM NEW.definition_hash_version THEN
      RAISE EXCEPTION 'workflow_definitions: definition_hash_version does not match the referenced ArtifactVersion''s content_hash_version (hash-version mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_artifact.content_hash IS DISTINCT FROM NEW.definition_hash THEN
      RAISE EXCEPTION 'workflow_definitions: definition_hash does not match the referenced ArtifactVersion''s content_hash (digest mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_artifact.content_json IS DISTINCT FROM NEW.definition_json THEN
      RAISE EXCEPTION 'workflow_definitions: definition_json does not match the referenced ArtifactVersion''s content_json (JSON mismatch)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.status = 'active' THEN
    SELECT ar.tenant_id AS tenant_id, ar.company_id AS company_id, ar.project_id AS project_id
    INTO v_gate_request
    FROM approval_current_validity acv
    JOIN approval_requests ar ON ar.id = acv.approval_request_id
    WHERE acv.approval_request_id = NEW.activation_approval_request_id
      AND acv.request_revision = NEW.activation_approval_request_revision;

    IF v_gate_request.tenant_id IS NULL THEN
      RAISE EXCEPTION 'workflow_definitions: status=active requires an ApprovalCurrentValidity row at the exact activation_approval_request_revision (structural existence only — this does NOT assert state=valid; U025 re-evaluates validity)'
        USING ERRCODE = '22023';
    END IF;

    IF v_gate_request.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR v_gate_request.company_id IS DISTINCT FROM NEW.company_id
       OR v_gate_request.project_id IS DISTINCT FROM NEW.project_id
    THEN
      RAISE EXCEPTION 'workflow_definitions: the referenced ApprovalRequest''s scope does not match this row''s own scope (cross-scope link)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.status = 'legacy_disabled' THEN
    SELECT status INTO v_def_artifact_status FROM artifact_versions WHERE id = NEW.definition_artifact_version_id;
    IF v_def_artifact_status IS DISTINCT FROM 'legacy_unreviewed' THEN
      RAISE EXCEPTION 'workflow_definitions: status=legacy_disabled requires definition_artifact_version_id to reference a legacy_unreviewed ArtifactVersion'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_workflow_definition_guard_trg
BEFORE INSERT OR UPDATE ON workflow_definitions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_workflow_definition_guard();

-- workflow_runs guard: full identity/snapshot immutability after insert, the exact-run/step status
-- graph + terminal guard (legacy_imported has no inbound transition), the exactly-plus-one revision
-- CAS on every UPDATE, the parent-WorkflowDefinition join/snapshot-match at INSERT (definition
-- version/artifact/hash-version/hash, and the byte-for-byte activation-snapshot copy for every
-- non-legacy_imported row), the legacy_imported restricted legacy_unreviewed-ArtifactVersion
-- requirement, the run-gate existence/match check against the LIVE approval_requests row, and the
-- succeeded/failed step-aggregate guards.
CREATE OR REPLACE FUNCTION public.sangfor_workflow_run_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_def RECORD;
  v_check_def boolean := false;
  v_def_artifact_status text;
  v_gate RECORD;
  v_allowed_next text[];
  v_nonterminal_count integer;
  v_failed_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_check_def := true;
    IF NEW.revision <> 0 THEN
      RAISE EXCEPTION 'workflow_runs: a new row must begin at revision 0, got %', NEW.revision
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.workflow_definition_id IS DISTINCT FROM OLD.workflow_definition_id
       OR NEW.definition_version IS DISTINCT FROM OLD.definition_version
       OR NEW.definition_artifact_version_id IS DISTINCT FROM OLD.definition_artifact_version_id
       OR NEW.definition_artifact_hash_version IS DISTINCT FROM OLD.definition_artifact_hash_version
       OR NEW.definition_artifact_hash IS DISTINCT FROM OLD.definition_artifact_hash
       OR NEW.activation_approval_request_id IS DISTINCT FROM OLD.activation_approval_request_id
       OR NEW.activation_approval_request_revision IS DISTINCT FROM OLD.activation_approval_request_revision
       OR NEW.activation_approval_artifact_version_id IS DISTINCT FROM OLD.activation_approval_artifact_version_id
       OR NEW.activation_approval_artifact_hash IS DISTINCT FROM OLD.activation_approval_artifact_hash
       OR NEW.activation_approval_policy_hash IS DISTINCT FROM OLD.activation_approval_policy_hash
       OR NEW.activation_approved_at IS DISTINCT FROM OLD.activation_approved_at
       OR NEW.run_approval_request_id IS DISTINCT FROM OLD.run_approval_request_id
       OR NEW.run_approval_request_revision IS DISTINCT FROM OLD.run_approval_request_revision
       OR NEW.run_approval_artifact_version_id IS DISTINCT FROM OLD.run_approval_artifact_version_id
       OR NEW.run_approval_artifact_hash IS DISTINCT FROM OLD.run_approval_artifact_hash
       OR NEW.run_approval_policy_hash IS DISTINCT FROM OLD.run_approval_policy_hash
       OR NEW.run_approved_at IS DISTINCT FROM OLD.run_approved_at
       OR NEW.requested_by_assignment_id IS DISTINCT FROM OLD.requested_by_assignment_id
       OR NEW.requested_session_id IS DISTINCT FROM OLD.requested_session_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.legacy_source_type IS DISTINCT FROM OLD.legacy_source_type
       OR NEW.legacy_source_id IS DISTINCT FROM OLD.legacy_source_id
    THEN
      RAISE EXCEPTION 'workflow_runs: identity/snapshot columns are immutable after insert'
        USING ERRCODE = '22023';
    END IF;

    IF OLD.status IN ('succeeded', 'failed', 'cancelled', 'legacy_imported') THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'workflow_runs: % is terminal; no further transition is permitted (attempted -> %)', OLD.status, NEW.status
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_allowed_next := CASE OLD.status
        WHEN 'pending' THEN ARRAY['running', 'cancelled']
        WHEN 'running' THEN ARRAY['blocked', 'succeeded', 'failed', 'cancelled']
        WHEN 'blocked' THEN ARRAY['running', 'failed', 'cancelled']
        ELSE ARRAY[]::text[]
      END;
      IF NOT (NEW.status = ANY(v_allowed_next)) THEN
        RAISE EXCEPTION 'workflow_runs: illegal run status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
      RAISE EXCEPTION 'workflow_runs: revision must increment by exactly 1 on every UPDATE (old=%, new=%)', OLD.revision, NEW.revision
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_check_def THEN
    SELECT tenant_id, company_id, project_id, version, definition_artifact_version_id, definition_hash_version, definition_hash,
           activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id,
           activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at
    INTO v_def
    FROM workflow_definitions
    WHERE id = NEW.workflow_definition_id;

    IF v_def.version IS NULL THEN
      RAISE EXCEPTION 'workflow_runs: workflow_definition_id % does not reference an existing workflow_definitions row', NEW.workflow_definition_id
        USING ERRCODE = '23503';
    END IF;

    IF v_def.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR v_def.company_id IS DISTINCT FROM NEW.company_id
       OR v_def.project_id IS DISTINCT FROM NEW.project_id
    THEN
      RAISE EXCEPTION 'workflow_runs: tenant/company/project scope does not match the parent WorkflowDefinition (scope mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_def.version IS DISTINCT FROM NEW.definition_version THEN
      RAISE EXCEPTION 'workflow_runs: definition_version does not match the parent WorkflowDefinition''s current version (version mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_def.definition_artifact_version_id IS DISTINCT FROM NEW.definition_artifact_version_id THEN
      RAISE EXCEPTION 'workflow_runs: definition_artifact_version_id does not match the parent WorkflowDefinition''s current definitionArtifactVersionId (artifact mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_def.definition_hash_version IS DISTINCT FROM NEW.definition_artifact_hash_version THEN
      RAISE EXCEPTION 'workflow_runs: definition_artifact_hash_version does not match the parent WorkflowDefinition''s definitionHashVersion (hash-version mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_def.definition_hash IS DISTINCT FROM NEW.definition_artifact_hash THEN
      RAISE EXCEPTION 'workflow_runs: definition_artifact_hash does not match the parent WorkflowDefinition''s definitionHash (digest mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.status IS DISTINCT FROM 'legacy_imported' THEN
      IF NEW.activation_approval_request_id IS DISTINCT FROM v_def.activation_approval_request_id
         OR NEW.activation_approval_request_revision IS DISTINCT FROM v_def.activation_approval_request_revision
         OR NEW.activation_approval_artifact_version_id IS DISTINCT FROM v_def.activation_approval_artifact_version_id
         OR NEW.activation_approval_artifact_hash IS DISTINCT FROM v_def.activation_approval_artifact_hash
         OR NEW.activation_approval_policy_hash IS DISTINCT FROM v_def.activation_approval_policy_hash
         OR NEW.activation_approved_at IS DISTINCT FROM v_def.activation_approved_at
      THEN
        RAISE EXCEPTION 'workflow_runs: a non-legacy_imported run must copy the parent WorkflowDefinition''s activation snapshot byte-for-byte (dropped or changed activation field)'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      SELECT status INTO v_def_artifact_status FROM artifact_versions WHERE id = NEW.definition_artifact_version_id;
      IF v_def_artifact_status IS DISTINCT FROM 'legacy_unreviewed' THEN
        RAISE EXCEPTION 'workflow_runs: status=legacy_imported requires definition_artifact_version_id to reference a legacy_unreviewed ArtifactVersion'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF NEW.run_approval_request_id IS NOT NULL THEN
    SELECT id, revision, artifact_version_id, artifact_hash_snapshot, policy_hash, legacy_unbound, tenant_id, company_id, project_id
    INTO v_gate
    FROM approval_requests
    WHERE id = NEW.run_approval_request_id;

    IF v_gate.id IS NULL THEN
      RAISE EXCEPTION 'workflow_runs: run_approval_request_id % does not reference an existing approval_requests row', NEW.run_approval_request_id
        USING ERRCODE = '23503';
    END IF;

    IF v_gate.legacy_unbound THEN
      RAISE EXCEPTION 'workflow_runs: run_approval_request_id % is legacy_unbound=true and confers no canonical authority; no run gate may reference it', NEW.run_approval_request_id
        USING ERRCODE = '22023';
    END IF;

    IF v_gate.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR v_gate.company_id IS DISTINCT FROM NEW.company_id
       OR v_gate.project_id IS DISTINCT FROM NEW.project_id
    THEN
      RAISE EXCEPTION 'workflow_runs: the referenced run-gate ApprovalRequest''s scope does not match this run''s own scope (cross-scope link)'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.run_approval_request_revision IS DISTINCT FROM v_gate.revision THEN
      RAISE EXCEPTION 'workflow_runs: run_approval_request_revision does not match the referenced ApprovalRequest''s current revision (revision mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.run_approval_artifact_version_id IS DISTINCT FROM v_gate.artifact_version_id THEN
      RAISE EXCEPTION 'workflow_runs: run_approval_artifact_version_id does not match the referenced ApprovalRequest''s artifact_version_id (version mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.run_approval_artifact_hash IS DISTINCT FROM v_gate.artifact_hash_snapshot THEN
      RAISE EXCEPTION 'workflow_runs: run_approval_artifact_hash does not match the referenced ApprovalRequest''s artifact_hash_snapshot (hash mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.run_approval_policy_hash IS DISTINCT FROM v_gate.policy_hash THEN
      RAISE EXCEPTION 'workflow_runs: run_approval_policy_hash does not match the referenced ApprovalRequest''s policy_hash (policy mismatch)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.status = 'succeeded' THEN
    SELECT count(*) INTO v_nonterminal_count FROM workflow_run_steps WHERE workflow_run_id = NEW.id AND status NOT IN ('succeeded', 'skipped');
    IF v_nonterminal_count > 0 THEN
      RAISE EXCEPTION 'workflow_runs: status=succeeded requires every step to be succeeded|skipped (% step(s) are not)', v_nonterminal_count
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.status = 'failed' THEN
    SELECT count(*) INTO v_failed_count FROM workflow_run_steps WHERE workflow_run_id = NEW.id AND status = 'failed';
    IF v_failed_count = 0 THEN
      RAISE EXCEPTION 'workflow_runs: status=failed requires at least one failed step'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_workflow_run_guard_trg
BEFORE INSERT OR UPDATE ON workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.sangfor_workflow_run_guard();

-- Cancellation cascade: when a run transitions to cancelled, atomically CAS-cancel every
-- nonterminal (pending/running/blocked) step in the SAME statement's trigger invocation — no
-- separate application-level transaction is required for this invariant to hold.
CREATE OR REPLACE FUNCTION public.sangfor_workflow_run_cascade_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE workflow_run_steps
    SET status = 'cancelled', revision = revision + 1
    WHERE workflow_run_id = NEW.id
      AND status NOT IN ('succeeded', 'failed', 'skipped', 'cancelled');
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER sangfor_workflow_run_cascade_cancel_trg
AFTER UPDATE ON workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.sangfor_workflow_run_cascade_cancel();

-- workflow_run_steps guard: immutable workflow_run_id/step_key, the exact step status graph +
-- terminal guard, and the exactly-plus-one revision CAS on every UPDATE (including the cascade
-- cancel above, which sets revision = revision + 1 in its own UPDATE statement).
CREATE OR REPLACE FUNCTION public.sangfor_workflow_run_step_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_allowed_next text[];
BEGIN
  IF TG_OP = 'INSERT' AND NEW.revision <> 0 THEN
    RAISE EXCEPTION 'workflow_run_steps: a new row must begin at revision 0, got %', NEW.revision
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.workflow_run_id IS DISTINCT FROM OLD.workflow_run_id THEN
      RAISE EXCEPTION 'workflow_run_steps.workflow_run_id is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.step_key IS DISTINCT FROM OLD.step_key THEN
      RAISE EXCEPTION 'workflow_run_steps.step_key is immutable' USING ERRCODE = '22023';
    END IF;

    IF OLD.status IN ('succeeded', 'failed', 'skipped', 'cancelled') THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'workflow_run_steps: % is terminal; no further transition is permitted (attempted -> %)', OLD.status, NEW.status
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_allowed_next := CASE OLD.status
        WHEN 'pending' THEN ARRAY['running', 'skipped', 'cancelled']
        WHEN 'running' THEN ARRAY['blocked', 'succeeded', 'failed', 'cancelled']
        WHEN 'blocked' THEN ARRAY['running', 'failed', 'cancelled']
        ELSE ARRAY[]::text[]
      END;
      IF NOT (NEW.status = ANY(v_allowed_next)) THEN
        RAISE EXCEPTION 'workflow_run_steps: illegal step status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
      RAISE EXCEPTION 'workflow_run_steps: revision must increment by exactly 1 on every UPDATE (old=%, new=%)', OLD.revision, NEW.revision
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_workflow_run_step_guard_trg
BEFORE INSERT OR UPDATE ON workflow_run_steps
FOR EACH ROW EXECUTE FUNCTION public.sangfor_workflow_run_step_guard();

-- workflow_run_artifacts named insert guard: the referenced ArtifactVersion's parent Artifact must
-- share the SAME scope (tenant/company/project) as the parent WorkflowRun — a cross-scope link is
-- rejected by Postgres itself, not only by an application-level check.
CREATE OR REPLACE FUNCTION public.sangfor_workflow_run_artifact_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_run RECORD;
  v_artifact RECORD;
BEGIN
  SELECT tenant_id, company_id, project_id INTO v_run FROM workflow_runs WHERE id = NEW.workflow_run_id;
  IF v_run.tenant_id IS NULL THEN
    RAISE EXCEPTION 'workflow_run_artifacts: workflow_run_id % does not reference an existing workflow_runs row', NEW.workflow_run_id
      USING ERRCODE = '23503';
  END IF;

  SELECT a.tenant_id AS tenant_id, a.company_id AS company_id, a.project_id AS project_id
  INTO v_artifact
  FROM artifact_versions av
  JOIN artifacts a ON a.id = av.artifact_id
  WHERE av.id = NEW.artifact_version_id;

  IF v_artifact.tenant_id IS NULL THEN
    RAISE EXCEPTION 'workflow_run_artifacts: artifact_version_id % does not reference an existing artifact_versions row', NEW.artifact_version_id
      USING ERRCODE = '23503';
  END IF;

  IF v_artifact.tenant_id IS DISTINCT FROM v_run.tenant_id
     OR v_artifact.company_id IS DISTINCT FROM v_run.company_id
     OR v_artifact.project_id IS DISTINCT FROM v_run.project_id
  THEN
    RAISE EXCEPTION 'workflow_run_artifacts: the referenced ArtifactVersion''s scope does not match the parent WorkflowRun''s scope (cross-scope link)'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_workflow_run_artifact_guard_trg
BEFORE INSERT ON workflow_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.sangfor_workflow_run_artifact_guard();

-- workflow_run_events named insert guard: joins workflow_run_id -> workflow_runs.company_id and
-- rejects an actor_assignment_id (when supplied) outside that company, same pattern as
-- ApprovalDecision's parent-guard trigger.
CREATE OR REPLACE FUNCTION public.sangfor_workflow_run_event_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_company_id text;
  v_actor_ok boolean;
BEGIN
  SELECT company_id INTO v_company_id FROM workflow_runs WHERE id = NEW.workflow_run_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'workflow_run_events: workflow_run_id % does not reference an existing workflow_runs row', NEW.workflow_run_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.actor_assignment_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM user_company_roles WHERE id = NEW.actor_assignment_id AND company_id = v_company_id
    ) INTO v_actor_ok;
    IF NOT v_actor_ok THEN
      RAISE EXCEPTION 'workflow_run_events: actor_assignment_id % is not a business-role assignment in the parent run''s own company %', NEW.actor_assignment_id, v_company_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_workflow_run_event_guard_trg
BEFORE INSERT ON workflow_run_events
FOR EACH ROW EXECUTE FUNCTION public.sangfor_workflow_run_event_guard();

-- Append-only: reuses the existing public.sangfor_deny_mutation() function installed by migration
-- 20260715170000 (U017) — no redefinition, same reuse pattern as approval_decisions/
-- artifact_versions above.
CREATE TRIGGER sangfor_workflow_run_events_deny_update_trg
BEFORE UPDATE ON workflow_run_events
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();

CREATE TRIGGER sangfor_workflow_run_events_deny_delete_trg
BEFORE DELETE ON workflow_run_events
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();
