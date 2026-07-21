-- U018/APR-01a: extend ApprovalRequest so every CANONICAL approval is pinned to one immutable
-- ArtifactVersion/action/policy snapshot, add the revision/CAS substrate, add a separate mutable
-- ApprovalCurrentValidity projection, and preserve append-only ApprovalDecision history. This
-- migration adds NO approve/reject/evaluation runtime and grants NO authority to legacy rows:
-- the pre-U022 writer (packages/business/src/governance/approval-db.ts) stays byte-identical and
-- its insert omits every canonical column below, so every existing/legacy row keeps
-- legacy_unbound=true and zero canonical fields. U022 is the only later card allowed to insert a
-- legacy_unbound=false row or execute the ApprovalCurrentValidity state transitions.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'version_bound_approval migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'version_bound_approval migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- Already installed by migration 20260715110000 (U011) — idempotent restate, same reuse pattern
-- as every sibling migration in this campaign.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 1: the PG-authoritative validation-snapshot digest function. Canonical bytes are exactly
-- PostgreSQL-16 jsonb::text converted to UTF-8 — no JSON.stringify, locale, whitespace-preserving
-- input, alternate key sort, or JS crypto hash is authoritative for this value. jsonb::text is
-- Postgres's own canonical (key-order-independent) serialization: two jsonb values built from
-- differently-ordered object-literal source text produce byte-identical ::text output, which is
-- exactly what makes this function's result reproducible for reordered/nested JSON callers.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sangfor_validation_snapshot_sha256(v jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT encode(public.digest(pg_catalog.convert_to((v)::text, 'UTF8'), 'sha256'), 'hex');
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2: extend approval_requests additively. Existing command_run_id/pull_request_id/reason/
-- status/created_at and every existing row are untouched. Every new scalar column below is
-- nullable at the DDL layer (Prisma "nullable-for-expand"); the canonical-shape guard trigger in
-- Step 6, not a DB NOT NULL, is what actually requires them non-null together on a canonical row.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "approval_requests" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "company_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "project_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "artifact_version_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "action" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "artifact_hash_snapshot" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "requested_by_assignment_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "requested_session_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "owner_assignment_id" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "approval_requests" ADD COLUMN "policy_key" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "policy_version" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "policy_hash" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "validation_snapshot" JSONB;
ALTER TABLE "approval_requests" ADD COLUMN "validation_snapshot_hash" TEXT;
ALTER TABLE "approval_requests" ADD COLUMN "required_quorum" INTEGER;
ALTER TABLE "approval_requests" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "approval_requests" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "approval_requests" ADD COLUMN "resolved_at" TIMESTAMP(3);

-- legacy_unbound: added nullable, EXPLICITLY backfilled to true for every pre-existing row, THEN
-- made NOT NULL — never inferred from legacy status/reason/command_run_id/pull_request_id. This
-- is the dispatch's required explicit-backfill-before-NOT-NULL sequence, same shape as U011's
-- role_change_requests.company_id closure (migration 20260715120000) SET NOT NULL step.
ALTER TABLE "approval_requests" ADD COLUMN "legacy_unbound" BOOLEAN;
UPDATE "approval_requests" SET "legacy_unbound" = true WHERE "legacy_unbound" IS NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "legacy_unbound" SET NOT NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "legacy_unbound" SET DEFAULT true;

-- updated_at: same backfill-then-NOT-NULL shape as legacy_unbound above. No DB-level default
-- afterward — every write goes through the Prisma client, which populates @updatedAt fields on
-- both create and update (same as artifacts.updated_at in migration 20260715170000); this
-- migration's own raw-SQL fixtures always supply it explicitly.
ALTER TABLE "approval_requests" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "approval_requests" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "approval_requests" ALTER COLUMN "updated_at" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3: new tables (Prisma-managed shape — copied verbatim from what `prisma migrate dev` would
-- produce for these two models; the custom triggers/CHECK constraints below are additive and
-- outside Prisma's DSL, same pattern as every sibling migration in this campaign).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "request_revision" INTEGER NOT NULL,
    "artifact_version_id" TEXT NOT NULL,
    "artifact_hash_snapshot" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "actor_assignment_id" TEXT NOT NULL,
    "actor_session_id" TEXT NOT NULL,
    "actor_role_snapshot" TEXT NOT NULL,
    "policy_hash_snapshot" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_current_validity" (
    "approval_request_id" TEXT NOT NULL,
    "request_revision" INTEGER NOT NULL,
    "artifact_version_id" TEXT NOT NULL,
    "artifact_hash_snapshot" TEXT NOT NULL,
    "policy_hash_snapshot" TEXT NOT NULL,
    "required_quorum" INTEGER NOT NULL,
    "satisfied_quorum" INTEGER NOT NULL,
    "last_decision_sequence" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "evaluated_at" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "reason_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_current_validity_pkey" PRIMARY KEY ("approval_request_id")
);

CREATE UNIQUE INDEX "approval_decisions_approval_request_id_sequence_key" ON "approval_decisions"("approval_request_id", "sequence");
CREATE UNIQUE INDEX "approval_decisions_approval_request_id_actor_assignment_id_key" ON "approval_decisions"("approval_request_id", "actor_assignment_id");

-- Partial unique index: at most one OPEN (legacy_unbound=false AND status IN the two
-- non-terminal canonical states) request per (artifact_version_id, action, policy_hash). Never
-- applies to legacy_unbound=true rows, which carry NULL in every one of these columns anyway.
CREATE UNIQUE INDEX "approval_requests_open_unique_idx" ON "approval_requests"("artifact_version_id", "action", "policy_hash")
  WHERE "legacy_unbound" = false AND "status" IN ('pending', 'ready_for_human_approval');

-- ─────────────────────────────────────────────────────────────────────────
-- Step 4: foreign keys.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- U012-compatible composite scope-closure FKs (companies_tenant_id_id_key / projects_company_id_id_key
-- from migration 20260715120000), same pattern as AuthSession/Artifact: a forged/mismatched
-- tenant/company/project combination is rejected by Postgres itself. Every column here is
-- nullable, so a NULL scope (every legacy_unbound=true row) trivially satisfies the composite FK.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Distinct exact U012 composite assignment FKs (user_company_roles_id_company_id_key from U012)
-- — never an ID-only assignment FK: a requested_by/owner_assignment_id that names a real
-- user_company_roles.id belonging to a DIFFERENT company is rejected by Postgres itself.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_assignment_id_fkey" FOREIGN KEY ("requested_by_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_owner_assignment_id_fkey" FOREIGN KEY ("owner_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_current_validity" ADD CONSTRAINT "approval_current_validity_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 5: CHECK constraints (state invariants; OLD/NEW transition logic lives in the triggers in
-- Step 6, same split as artifact_identity's Step 3/Step 4).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_status_check" CHECK (status IN ('pending', 'ready_for_human_approval', 'approved', 'rejected', 'cancelled', 'expired'));
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_ownership_revision_check" CHECK (ownership_revision >= 0);
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_revision_check" CHECK (revision >= 0);
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_required_quorum_check" CHECK (required_quorum IS NULL OR required_quorum >= 1);
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_validation_snapshot_hash_check" CHECK (validation_snapshot_hash IS NULL OR validation_snapshot_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_artifact_hash_snapshot_check" CHECK (artifact_hash_snapshot IS NULL OR artifact_hash_snapshot ~ '^[0-9a-f]{64}$');
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_hash_check" CHECK (policy_hash IS NULL OR policy_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_sequence_check" CHECK (sequence > 0);
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_revision_check" CHECK (request_revision >= 0);
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decision_check" CHECK (decision IN ('approve', 'reject'));
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_artifact_hash_snapshot_check" CHECK (artifact_hash_snapshot ~ '^[0-9a-f]{64}$');
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_policy_hash_snapshot_check" CHECK (policy_hash_snapshot ~ '^[0-9a-f]{64}$');

ALTER TABLE "approval_current_validity" ADD CONSTRAINT "approval_current_validity_required_quorum_check" CHECK (required_quorum >= 1);
ALTER TABLE "approval_current_validity" ADD CONSTRAINT "approval_current_validity_satisfied_quorum_check" CHECK (satisfied_quorum >= 0 AND satisfied_quorum <= required_quorum);
ALTER TABLE "approval_current_validity" ADD CONSTRAINT "approval_current_validity_last_decision_sequence_check" CHECK (last_decision_sequence >= satisfied_quorum);
ALTER TABLE "approval_current_validity" ADD CONSTRAINT "approval_current_validity_state_check" CHECK (state IN ('pending', 'valid', 'invalid', 'stale', 'expired', 'revoked'));
ALTER TABLE "approval_current_validity" ADD CONSTRAINT "approval_current_validity_request_revision_check" CHECK (request_revision >= 0);

-- ─────────────────────────────────────────────────────────────────────────
-- Step 6: triggers.
-- ─────────────────────────────────────────────────────────────────────────

-- approval_request_validation_snapshot_guard: BEFORE INSERT OR UPDATE on approval_requests.
-- On INSERT, fills validation_snapshot_hash from sangfor_validation_snapshot_sha256(validation_snapshot)
-- when the caller omitted it; when the caller supplied it, requires byte equality with the
-- recomputed value or rejects the insert. On UPDATE, rejects any change to EITHER
-- validation_snapshot or validation_snapshot_hash — both stay immutable even when status/revision
-- change later. Deliberately named to sort alphabetically BEFORE
-- approval_requests_canonical_shape_guard_trg (Postgres fires same-event triggers in name order:
-- "approval_request_" < "approval_requests_" at the first differing byte, '_' < 's'), so the
-- shape guard's non-null check below always sees the FINAL (filled-if-omitted) hash, not the
-- caller's possibly-NULL input.
CREATE OR REPLACE FUNCTION public.approval_request_validation_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_recomputed text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.validation_snapshot IS DISTINCT FROM OLD.validation_snapshot
       OR NEW.validation_snapshot_hash IS DISTINCT FROM OLD.validation_snapshot_hash
    THEN
      RAISE EXCEPTION 'approval_requests: validation_snapshot/validation_snapshot_hash are immutable after insert'
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.validation_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  v_recomputed := public.sangfor_validation_snapshot_sha256(NEW.validation_snapshot);
  IF NEW.validation_snapshot_hash IS NULL THEN
    NEW.validation_snapshot_hash := v_recomputed;
  ELSIF NEW.validation_snapshot_hash IS DISTINCT FROM v_recomputed THEN
    RAISE EXCEPTION 'approval_requests: supplied validation_snapshot_hash does not equal sangfor_validation_snapshot_sha256(validation_snapshot)'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER approval_request_validation_snapshot_guard_trg
BEFORE INSERT OR UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION public.approval_request_validation_snapshot_guard();

-- approval_requests_canonical_shape_guard: BEFORE INSERT OR UPDATE on approval_requests. The
-- two-branch shape contract (legacy_unbound=true => every canonical field NULL and
-- ownership_revision=revision=0; legacy_unbound=false => every canonical field complete and
-- mutually consistent, status begins exactly 'pending' on INSERT), plus the immutable-after-insert
-- fields and the owner CAS rule (same +1-or-unchanged shape as artifacts.owner_assignment_id in
-- migration 20260715170000).
CREATE OR REPLACE FUNCTION public.approval_requests_canonical_shape_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_artifact RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.legacy_unbound IS DISTINCT FROM OLD.legacy_unbound THEN
      RAISE EXCEPTION 'approval_requests.legacy_unbound is immutable (old=%, new=%)', OLD.legacy_unbound, NEW.legacy_unbound
        USING ERRCODE = '22023';
    END IF;
    IF NEW.requested_by_assignment_id IS DISTINCT FROM OLD.requested_by_assignment_id THEN
      RAISE EXCEPTION 'approval_requests.requested_by_assignment_id is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.requested_session_id IS DISTINCT FROM OLD.requested_session_id THEN
      RAISE EXCEPTION 'approval_requests.requested_session_id is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.artifact_version_id IS DISTINCT FROM OLD.artifact_version_id THEN
      RAISE EXCEPTION 'approval_requests.artifact_version_id is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.action IS DISTINCT FROM OLD.action THEN
      RAISE EXCEPTION 'approval_requests.action is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.artifact_hash_snapshot IS DISTINCT FROM OLD.artifact_hash_snapshot THEN
      RAISE EXCEPTION 'approval_requests.artifact_hash_snapshot is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'approval_requests: scope (tenant_id/company_id/project_id) is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.policy_key IS DISTINCT FROM OLD.policy_key OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.policy_hash IS DISTINCT FROM OLD.policy_hash THEN
      RAISE EXCEPTION 'approval_requests: policy snapshot (policy_key/policy_version/policy_hash) is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.required_quorum IS DISTINCT FROM OLD.required_quorum THEN
      RAISE EXCEPTION 'approval_requests.required_quorum is immutable' USING ERRCODE = '22023';
    END IF;

    IF NEW.owner_assignment_id IS DISTINCT FROM OLD.owner_assignment_id THEN
      IF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision + 1 THEN
        RAISE EXCEPTION 'approval_requests: owner_assignment_id change must increment ownership_revision by exactly 1 (old=%, new=%)', OLD.ownership_revision, NEW.ownership_revision
          USING ERRCODE = '22023';
      END IF;
    ELSIF NEW.ownership_revision IS DISTINCT FROM OLD.ownership_revision THEN
      RAISE EXCEPTION 'approval_requests: ownership_revision changed without a corresponding owner_assignment_id change' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.legacy_unbound THEN
    IF NEW.tenant_id IS NOT NULL OR NEW.company_id IS NOT NULL OR NEW.project_id IS NOT NULL
       OR NEW.artifact_version_id IS NOT NULL OR NEW.action IS NOT NULL
       OR NEW.requested_by_assignment_id IS NOT NULL OR NEW.requested_session_id IS NOT NULL
       OR NEW.owner_assignment_id IS NOT NULL OR NEW.artifact_hash_snapshot IS NOT NULL
       OR NEW.policy_key IS NOT NULL OR NEW.policy_version IS NOT NULL OR NEW.policy_hash IS NOT NULL
       OR NEW.validation_snapshot IS NOT NULL OR NEW.validation_snapshot_hash IS NOT NULL
       OR NEW.required_quorum IS NOT NULL
       OR NEW.ownership_revision <> 0 OR NEW.revision <> 0
    THEN
      RAISE EXCEPTION 'approval_requests: legacy_unbound=true rows must have every canonical field NULL and ownership_revision=revision=0'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.tenant_id IS NULL OR NEW.company_id IS NULL OR NEW.project_id IS NULL
       OR NEW.artifact_version_id IS NULL OR NEW.action IS NULL
       OR NEW.requested_by_assignment_id IS NULL OR NEW.requested_session_id IS NULL
       OR NEW.owner_assignment_id IS NULL OR NEW.artifact_hash_snapshot IS NULL
       OR NEW.policy_key IS NULL OR NEW.policy_version IS NULL OR NEW.policy_hash IS NULL
       OR NEW.validation_snapshot IS NULL OR NEW.validation_snapshot_hash IS NULL
       OR NEW.required_quorum IS NULL
    THEN
      RAISE EXCEPTION 'approval_requests: legacy_unbound=false rows require every canonical field to be complete'
        USING ERRCODE = '22023';
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'approval_requests: a new canonical (legacy_unbound=false) row must begin status=pending, got %', NEW.status
        USING ERRCODE = '22023';
    END IF;

    SELECT av.content_hash AS content_hash, a.tenant_id AS tenant_id, a.company_id AS company_id, a.project_id AS project_id
    INTO v_artifact
    FROM artifact_versions av
    JOIN artifacts a ON a.id = av.artifact_id
    WHERE av.id = NEW.artifact_version_id;

    IF v_artifact.content_hash IS NULL THEN
      RAISE EXCEPTION 'approval_requests: artifact_version_id % does not reference an existing artifact_versions row', NEW.artifact_version_id
        USING ERRCODE = '23503';
    END IF;

    IF v_artifact.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR v_artifact.company_id IS DISTINCT FROM NEW.company_id
       OR v_artifact.project_id IS DISTINCT FROM NEW.project_id
    THEN
      RAISE EXCEPTION 'approval_requests: tenant/company/project scope does not match the referenced ArtifactVersion''s parent Artifact (scope mismatch)'
        USING ERRCODE = '22023';
    END IF;

    IF v_artifact.content_hash IS DISTINCT FROM NEW.artifact_hash_snapshot THEN
      RAISE EXCEPTION 'approval_requests: artifact_hash_snapshot does not match the referenced ArtifactVersion''s content_hash (version/hash mismatch)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER approval_requests_canonical_shape_guard_trg
BEFORE INSERT OR UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION public.approval_requests_canonical_shape_guard();

-- Status vocabulary/graph enforcement — applies ONLY when legacy_unbound=false on BOTH sides of
-- an UPDATE (a legacy_unbound=true row's status is zero-authority and pre-dates this graph; the
-- unchanged pre-U022 approval-db.ts writer must keep updating it exactly as before). The exact
-- vocabulary itself is already DB-enforced unconditionally by approval_requests_status_check
-- above (every legacy string in live use — pending/approved/rejected — is a subset of it).
CREATE OR REPLACE FUNCTION public.sangfor_approval_requests_status_graph_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_allowed_next text[];
BEGIN
  IF NOT OLD.legacy_unbound AND NOT NEW.legacy_unbound THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_allowed_next := CASE OLD.status
        WHEN 'pending' THEN ARRAY['ready_for_human_approval', 'cancelled', 'expired']
        WHEN 'ready_for_human_approval' THEN ARRAY['approved', 'rejected', 'cancelled', 'expired']
        ELSE ARRAY[]::text[]
      END;
      IF NOT (NEW.status = ANY(v_allowed_next)) THEN
        RAISE EXCEPTION 'approval_requests: illegal canonical status transition % -> %', OLD.status, NEW.status
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_approval_requests_status_graph_guard_trg
BEFORE UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION public.sangfor_approval_requests_status_graph_guard();

-- approval_decisions parent-guard insert trigger: joins approval_request_id -> approval_requests
-- (company_id, legacy_unbound, artifact_version_id, artifact_hash_snapshot, policy_hash,
-- revision), rejects an actor_assignment_id outside that company, rejects any decision recorded
-- against a legacy_unbound=true parent (it has no canonical scope/version/hash to record
-- against), and rejects a decision whose artifact_version_id/artifact_hash_snapshot/
-- policy_hash_snapshot/request_revision does not match the parent's current values.
CREATE OR REPLACE FUNCTION public.sangfor_approval_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_request RECORD;
  v_actor_ok boolean;
BEGIN
  SELECT id, company_id, legacy_unbound, artifact_version_id, artifact_hash_snapshot, policy_hash, revision
  INTO v_request
  FROM approval_requests
  WHERE id = NEW.approval_request_id;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'approval_decisions: approval_request_id % does not reference an existing approval_requests row', NEW.approval_request_id
      USING ERRCODE = '23503';
  END IF;

  IF v_request.legacy_unbound THEN
    RAISE EXCEPTION 'approval_decisions: approval_request_id % is legacy_unbound=true and confers no canonical authority; no decision may be recorded against it', NEW.approval_request_id
      USING ERRCODE = '22023';
  END IF;

  IF NEW.artifact_version_id IS DISTINCT FROM v_request.artifact_version_id THEN
    RAISE EXCEPTION 'approval_decisions: artifact_version_id does not match the parent approval_requests row (version mismatch)' USING ERRCODE = '22023';
  END IF;

  IF NEW.artifact_hash_snapshot IS DISTINCT FROM v_request.artifact_hash_snapshot THEN
    RAISE EXCEPTION 'approval_decisions: artifact_hash_snapshot does not match the parent approval_requests row (hash mismatch)' USING ERRCODE = '22023';
  END IF;

  IF NEW.policy_hash_snapshot IS DISTINCT FROM v_request.policy_hash THEN
    RAISE EXCEPTION 'approval_decisions: policy_hash_snapshot does not match the parent approval_requests row (policy mismatch)' USING ERRCODE = '22023';
  END IF;

  IF NEW.request_revision IS DISTINCT FROM v_request.revision THEN
    RAISE EXCEPTION 'approval_decisions: request_revision % does not match the parent approval_requests current revision % (request-revision mismatch)', NEW.request_revision, v_request.revision
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_company_roles WHERE id = NEW.actor_assignment_id AND company_id = v_request.company_id
  ) INTO v_actor_ok;
  IF NOT v_actor_ok THEN
    RAISE EXCEPTION 'approval_decisions: actor_assignment_id % is not a business-role assignment in the parent request''s own company %', NEW.actor_assignment_id, v_request.company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_approval_decision_guard_trg
BEFORE INSERT ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_approval_decision_guard();

-- Append-only: reuses the existing public.sangfor_deny_mutation() function installed by migration
-- 20260715170000 (U017) — no redefinition, same reuse pattern as this campaign's other
-- append-only child tables.
CREATE TRIGGER sangfor_approval_decisions_deny_update_trg
BEFORE UPDATE ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();

CREATE TRIGGER sangfor_approval_decisions_deny_delete_trg
BEFORE DELETE ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();

-- approval_current_validity guard: snapshot fields (request_revision/artifact_version_id/
-- artifact_hash_snapshot/policy_hash_snapshot/required_quorum) must match the CURRENT parent
-- approval_requests row; the parent must be legacy_unbound=false (no projection is permitted
-- against a legacy row — the authority-zero invariant U020 proves); the projection graph is
-- pending -> valid|invalid|stale|expired, valid -> stale|expired|revoked, with no resurrection
-- out of a terminal state; and valid/invalid/expired each carry their own structural
-- precondition against the parent request's status, independent of which unit writes the row.
CREATE OR REPLACE FUNCTION public.sangfor_approval_current_validity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_request RECORD;
  v_allowed_next text[];
BEGIN
  SELECT id, legacy_unbound, status, revision, artifact_version_id, artifact_hash_snapshot, policy_hash, required_quorum
  INTO v_request
  FROM approval_requests
  WHERE id = NEW.approval_request_id;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'approval_current_validity: approval_request_id % does not reference an existing approval_requests row', NEW.approval_request_id
      USING ERRCODE = '23503';
  END IF;

  IF v_request.legacy_unbound THEN
    RAISE EXCEPTION 'approval_current_validity: approval_request_id % is legacy_unbound=true and confers no canonical authority; no projection is permitted', NEW.approval_request_id
      USING ERRCODE = '22023';
  END IF;

  IF NEW.request_revision IS DISTINCT FROM v_request.revision
     OR NEW.artifact_version_id IS DISTINCT FROM v_request.artifact_version_id
     OR NEW.artifact_hash_snapshot IS DISTINCT FROM v_request.artifact_hash_snapshot
     OR NEW.policy_hash_snapshot IS DISTINCT FROM v_request.policy_hash
     OR NEW.required_quorum IS DISTINCT FROM v_request.required_quorum
  THEN
    RAISE EXCEPTION 'approval_current_validity: snapshot fields do not match the current approval_requests row (revision/version/hash/policy/quorum mismatch)'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id THEN
      RAISE EXCEPTION 'approval_current_validity.approval_request_id is immutable' USING ERRCODE = '22023';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      v_allowed_next := CASE OLD.state
        WHEN 'pending' THEN ARRAY['valid', 'invalid', 'stale', 'expired']
        WHEN 'valid' THEN ARRAY['stale', 'expired', 'revoked']
        ELSE ARRAY[]::text[]
      END;
      IF NOT (NEW.state = ANY(v_allowed_next)) THEN
        RAISE EXCEPTION 'approval_current_validity: illegal projection transition % -> %', OLD.state, NEW.state
          USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    IF NEW.state = 'revoked' THEN
      RAISE EXCEPTION 'approval_current_validity: a new row cannot start directly at revoked (only reachable from valid)'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.state = 'valid' THEN
    IF v_request.status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'approval_current_validity: state=valid requires the parent request status=approved' USING ERRCODE = '22023';
    END IF;
    IF NEW.satisfied_quorum IS NULL OR NEW.satisfied_quorum < 1 OR NEW.satisfied_quorum < NEW.required_quorum THEN
      RAISE EXCEPTION 'approval_current_validity: state=valid requires satisfied_quorum >= required_quorum and > 0 (distinct quorum)' USING ERRCODE = '22023';
    END IF;
    IF NEW.evaluated_at IS NULL THEN
      RAISE EXCEPTION 'approval_current_validity: state=valid requires a non-null evaluatedAt' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.state = 'invalid' THEN
    IF v_request.status NOT IN ('rejected', 'cancelled') THEN
      RAISE EXCEPTION 'approval_current_validity: state=invalid requires the parent request status IN (rejected,cancelled)' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.state = 'expired' THEN
    IF NOT (v_request.status = 'expired' OR (v_request.status = 'approved' AND NEW.valid_until IS NOT NULL AND NEW.valid_until <= now())) THEN
      RAISE EXCEPTION 'approval_current_validity: state=expired requires the parent request status=expired, or an approved request whose validUntil has elapsed' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_approval_current_validity_guard_trg
BEFORE INSERT OR UPDATE ON approval_current_validity
FOR EACH ROW EXECUTE FUNCTION public.sangfor_approval_current_validity_guard();
