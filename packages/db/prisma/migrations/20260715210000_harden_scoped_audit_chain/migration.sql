-- U021/AUD-01b: harden the existing AuditLog/audit_logs into a scoped, concurrency-safe,
-- append-only, hash-chained audit log. Extends `audit_logs` ONLY — no AuditChainHead/
-- AuditScopeHead/sequence model (forbidden by the U021 contract). Confirmed defects this fixes:
-- `audit-db.ts` read-latest-then-insert without serialization (race -> duplicate predecessors);
-- `AuditLog` had no scope/sequence/DB immutability; `audit.ts` could commit domain state and audit
-- state separately.
--
-- Shape, in order:
--   Step 1: add new nullable-for-now scope/chain columns (backfill target).
--   Step 2: deterministic legacy backfill — resolve scope from canonical resource ownership,
--            assign chain_scope_key + stable per-scope order + hashes, guarded by a NAMED
--            unresolved-count precondition that runs BEFORE any SET NOT NULL/validation below.
--   Step 3: tighten columns to NOT NULL now that every row (if any) is fully resolved.
--   Step 4: named CHECK constraints (scope vocabulary, nullability matrix, hash format, sequence).
--   Step 5: composite scope-closure FKs (tenant/company/project), reusing U012's composite unique
--            keys — same pattern as artifacts/approval_requests/workflow_definitions/auth_sessions.
--   Step 6: unique (chain_scope_key, sequence) and partial unique (chain_scope_key,
--            idempotency_key) WHERE idempotency_key IS NOT NULL.
--   Step 7: named trigger deriving/verifying chain_scope_key + nullability on INSERT.
--   Step 8: named trigger verifying genesis/predecessor hash continuity and the exact
--            sangfor.audit-chain/v1 RFC 8785 JCS byte + SHA-256 digest, reusing U017's PostgreSQL
--            parity functions (sangfor_rfc8785_jcs_v1/sangfor_sha256_utf8) — never PostgreSQL
--            jsonb::text hashing.
--   Step 9: append-only — deny UPDATE/DELETE, reusing the existing sangfor_deny_mutation()
--            function from migration 20260715170000.
--   Step 10: sangfor_app gets INSERT/SELECT only on audit_logs (U016 grant convention) — no
--            UPDATE/DELETE grant, defense-in-depth alongside the deny triggers above.
--
-- Concurrency safety (contract point 2) is NOT implemented by anything in this file: Postgres
-- triggers cannot serialize concurrent transactions against each other by themselves. The
-- serialization is `pg_advisory_xact_lock(hashtextextended(chain_scope_key, 0))`, issued by the
-- application (packages/business/src/governance/audit-db.ts appendAuditEvent) INSIDE the same
-- Prisma transaction as the domain mutation, before it reads the current max sequence/last hash
-- for that chain_scope_key — this file's job is to make any row that nonetheless violates the
-- chain (duplicate sequence, wrong predecessor, tampered hash, direct UPDATE/DELETE) impossible to
-- persist, not to acquire the lock itself.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'harden_scoped_audit_chain migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'harden_scoped_audit_chain migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 1: new columns, all nullable for now (tightened in Step 3, after backfill).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "audit_logs"
  ADD COLUMN "tenant_id" TEXT,
  ADD COLUMN "scope_level" TEXT,
  ADD COLUMN "company_id" TEXT,
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "chain_scope_key" TEXT,
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "idempotency_key" TEXT;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2: deterministic legacy backfill.
--
-- resourceType convention this migration understands (documented, exhaustive): 'tenant' ->
-- tenants.id directly (TENANT scope); 'company' -> companies.id, scope inherited from
-- companies.tenant_id (COMPANY scope); 'opportunity' -> opportunities.id, scope resolved through
-- its OWN project (opportunities.project_id -> projects.company_id -> companies.tenant_id,
-- PROJECT scope, rejecting a project whose company_id is itself NULL — the same
-- correlation-only-bridge caveat documented on Project.companyId elsewhere in this schema). Any
-- other resource_type value, a resource_id that does not exist, or a resource_id whose chain is
-- incomplete (e.g. an opportunity whose project has no company) resolves to ZERO candidates and
-- fails the precondition below. This migration never defaults a tenant/company/project and never
-- declares an unresolved row valid — a real database carrying legacy audit_logs rows outside this
-- convention (for example pre-U021 GLOBAL_SHARED module_registry/connector rows, which structurally
-- cannot have a tenant) must be triaged/quarantined by an operator before this migration can run;
-- that is intentional fail-closed behavior per the U021 contract, not an oversight.
CREATE TEMP TABLE audit_scope_candidates (
  audit_log_id text PRIMARY KEY,
  tenant_candidate text NOT NULL,
  company_candidate text,
  project_candidate text,
  level_candidate text NOT NULL
) ON COMMIT DROP;

INSERT INTO audit_scope_candidates (audit_log_id, tenant_candidate, company_candidate, project_candidate, level_candidate)
SELECT al.id, tt.id, NULL, NULL, 'TENANT'
FROM audit_logs al
JOIN tenants tt ON al.resource_type = 'tenant' AND tt.id = al.resource_id

UNION ALL

SELECT al.id, cc.tenant_id, cc.id, NULL, 'COMPANY'
FROM audit_logs al
JOIN companies cc ON al.resource_type = 'company' AND cc.id = al.resource_id

UNION ALL

SELECT al.id, co.tenant_id, p.company_id, p.id, 'PROJECT'
FROM audit_logs al
JOIN opportunities o ON al.resource_type = 'opportunity' AND o.id = al.resource_id
JOIN projects p ON p.id = o.project_id AND p.company_id IS NOT NULL
JOIN companies co ON co.id = p.company_id;

-- NAMED PRECONDITION: audit_logs_legacy_scope_unresolved_precondition. Runs BEFORE any SET NOT
-- NULL/CHECK/trigger/validation below. Reports unresolved ids as hashes/counts only (never the raw
-- id list) — same discipline as U011/U020's quarantine receipts.
DO $$
DECLARE
  v_unresolved_count integer;
  v_unresolved_id_hashes text;
BEGIN
  SELECT count(*), string_agg(encode(public.digest(convert_to(al.id, 'UTF8'), 'sha256'), 'hex'), ',' ORDER BY al.id COLLATE "C")
  INTO v_unresolved_count, v_unresolved_id_hashes
  FROM audit_logs al
  LEFT JOIN audit_scope_candidates c ON c.audit_log_id = al.id
  WHERE c.audit_log_id IS NULL;

  IF v_unresolved_count > 0 THEN
    RAISE EXCEPTION 'audit_logs_legacy_scope_unresolved_precondition: % legacy audit_logs row(s) have zero (or ambiguous) tenant/company/project candidates and cannot be scoped deterministically (sha256(id) hashes: %) -- migration fails closed, no constraint below is validated', v_unresolved_count, v_unresolved_id_hashes
      USING ERRCODE = '22023';
  END IF;

  -- Defense-in-depth: the UNION ALL above structurally cannot produce more than one candidate row
  -- per audit_logs.id (each branch joins on that branch's own primary key), but this guards the
  -- invariant explicitly rather than assuming it silently holds.
  IF EXISTS (SELECT 1 FROM audit_scope_candidates GROUP BY audit_log_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'audit_logs_legacy_scope_unresolved_precondition: at least one legacy audit_logs row resolved to multiple inconsistent scope candidates -- migration fails closed'
      USING ERRCODE = '22023';
  END IF;
END $$;

-- Apply resolved scope to the real columns.
UPDATE audit_logs al
SET tenant_id = c.tenant_candidate,
    company_id = c.company_candidate,
    project_id = c.project_candidate,
    scope_level = c.level_candidate
FROM audit_scope_candidates c
WHERE c.audit_log_id = al.id;

-- chain_scope_key: tenant:<tenantId> | company:<tenantId>:<companyId> | project:<tenantId>:<companyId>:<projectId>.
UPDATE audit_logs
SET chain_scope_key = CASE scope_level
  WHEN 'TENANT' THEN 'tenant:' || tenant_id
  WHEN 'COMPANY' THEN 'company:' || tenant_id || ':' || company_id
  WHEN 'PROJECT' THEN 'project:' || tenant_id || ':' || company_id || ':' || project_id
END
WHERE scope_level IS NOT NULL;

-- Stable per-scope sequence: ORDER BY timestamp ASC, created_at ASC, id COLLATE "C" ASC — the
-- immutable primary key is the final mandatory tie-break so equal timestamps never depend on
-- heap/scan order (U021 contract point 5).
WITH ordered AS (
  SELECT id, row_number() OVER (
    PARTITION BY chain_scope_key
    ORDER BY "timestamp" ASC, created_at ASC, id COLLATE "C" ASC
  ) AS seq
  FROM audit_logs
  WHERE chain_scope_key IS NOT NULL
)
UPDATE audit_logs al
SET sequence = ordered.seq
FROM ordered
WHERE ordered.id = al.id;

-- Hashes: computed row-by-row in sequence order per chain_scope_key, since each row's hash depends
-- on its predecessor's. Reuses U017's sangfor_rfc8785_jcs_v1/sangfor_sha256_utf8 exclusively — the
-- exact same envelope shape/field set/version the sangfor_audit_logs_hash_guard_trg trigger
-- (Step 8) re-verifies on every future INSERT, so a legacy-backfilled row and a freshly-appended
-- row are byte-for-byte indistinguishable in how their hash was derived.
DO $$
DECLARE
  r RECORD;
  v_prev_hash text;
  v_current_scope text := NULL;
  v_envelope jsonb;
  v_occurred_at text;
  v_event_hash text;
BEGIN
  FOR r IN
    SELECT id, chain_scope_key, scope_level, tenant_id, company_id, project_id, "sequence",
           event_type, actor_id, resource_type, resource_id, details, "timestamp"
    FROM audit_logs
    WHERE chain_scope_key IS NOT NULL
    ORDER BY chain_scope_key COLLATE "C" ASC, "sequence" ASC
  LOOP
    IF v_current_scope IS DISTINCT FROM r.chain_scope_key THEN
      v_prev_hash := repeat('0', 64);
      v_current_scope := r.chain_scope_key;
    END IF;

    v_occurred_at := to_char(r."timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

    v_envelope := jsonb_build_object(
      'actorId', r.actor_id,
      'chainScopeKey', r.chain_scope_key,
      'details', r.details,
      'eventType', r.event_type,
      'occurredAt', v_occurred_at,
      'previousHash', v_prev_hash,
      'resourceId', r.resource_id,
      'resourceType', r.resource_type,
      'scope', jsonb_build_object('companyId', r.company_id, 'level', r.scope_level, 'projectId', r.project_id, 'tenantId', r.tenant_id),
      'sequence', r."sequence",
      'version', 'sangfor.audit-chain/v1'
    );

    v_event_hash := public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(v_envelope));

    UPDATE audit_logs SET previous_hash = v_prev_hash, event_hash = v_event_hash WHERE id = r.id;

    v_prev_hash := v_event_hash;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3: tighten to NOT NULL now that every row (if any) is fully resolved and hashed.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "scope_level" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "chain_scope_key" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "previous_hash" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "event_hash" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 4: named CHECK constraints.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_scope_level_check" CHECK (scope_level IN ('TENANT', 'COMPANY', 'PROJECT'));

-- Exact nullability matrix (U021 contract point 1): TENANT => both null; COMPANY => company set,
-- project null; PROJECT => both set.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_scope_nullability_check" CHECK (
  (scope_level = 'TENANT' AND company_id IS NULL AND project_id IS NULL)
  OR (scope_level = 'COMPANY' AND company_id IS NOT NULL AND project_id IS NULL)
  OR (scope_level = 'PROJECT' AND company_id IS NOT NULL AND project_id IS NOT NULL)
);

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_sequence_positive_check" CHECK (sequence > 0);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_event_hash_format_check" CHECK (event_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_previous_hash_format_check" CHECK (previous_hash ~ '^[0-9a-f]{64}$');

-- ─────────────────────────────────────────────────────────────────────────
-- Step 5: composite scope-closure FKs — same pattern as artifacts/approval_requests/
-- workflow_definitions/auth_sessions (U012's companies_tenant_id_id_key / projects_company_id_id_key).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 6: uniqueness. Full unique (chain_scope_key, sequence) is Prisma-representable (declared in
-- schema.prisma as @@unique) — created here as a CREATE UNIQUE INDEX to match Prisma's own naming
-- convention byte-for-byte. The partial unique (chain_scope_key, idempotency_key) WHERE
-- idempotency_key IS NOT NULL is NOT representable in the Prisma DSL (no partial-index support) —
-- raw SQL only, same pattern as approval_requests_open_unique_idx (migration 20260715180000).
-- ─────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "audit_logs_chain_scope_key_sequence_key" ON "audit_logs"("chain_scope_key", "sequence");
CREATE UNIQUE INDEX "audit_logs_chain_scope_key_idempotency_key_key" ON "audit_logs"("chain_scope_key", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- ─────────────────────────────────────────────────────────────────────────
-- Step 7: named trigger deriving/verifying chain_scope_key + nullability on INSERT. UPDATE is
-- handled exclusively by the deny-mutation trigger in Step 9 (append-only — there is no "verify on
-- UPDATE" branch to reach).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sangfor_audit_logs_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_expected_key text;
BEGIN
  IF NEW.scope_level = 'TENANT' THEN
    IF NEW.company_id IS NOT NULL OR NEW.project_id IS NOT NULL THEN
      RAISE EXCEPTION 'audit_logs: TENANT scope_level requires company_id and project_id both NULL' USING ERRCODE = '22023';
    END IF;
    v_expected_key := 'tenant:' || NEW.tenant_id;
  ELSIF NEW.scope_level = 'COMPANY' THEN
    IF NEW.company_id IS NULL OR NEW.project_id IS NOT NULL THEN
      RAISE EXCEPTION 'audit_logs: COMPANY scope_level requires company_id set and project_id NULL' USING ERRCODE = '22023';
    END IF;
    v_expected_key := 'company:' || NEW.tenant_id || ':' || NEW.company_id;
  ELSIF NEW.scope_level = 'PROJECT' THEN
    IF NEW.company_id IS NULL OR NEW.project_id IS NULL THEN
      RAISE EXCEPTION 'audit_logs: PROJECT scope_level requires company_id and project_id both set' USING ERRCODE = '22023';
    END IF;
    v_expected_key := 'project:' || NEW.tenant_id || ':' || NEW.company_id || ':' || NEW.project_id;
  ELSE
    RAISE EXCEPTION 'audit_logs: unknown scope_level %', NEW.scope_level USING ERRCODE = '22023';
  END IF;

  IF NEW.chain_scope_key IS NULL THEN
    NEW.chain_scope_key := v_expected_key;
  ELSIF NEW.chain_scope_key IS DISTINCT FROM v_expected_key THEN
    RAISE EXCEPTION 'audit_logs: chain_scope_key % does not match the derived key % for this row''s tenant_id/company_id/project_id', NEW.chain_scope_key, v_expected_key
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_audit_logs_scope_guard_trg
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION public.sangfor_audit_logs_scope_guard();

-- ─────────────────────────────────────────────────────────────────────────
-- Step 8: named trigger verifying genesis/predecessor hash continuity and the exact byte-exact
-- sangfor.audit-chain/v1 envelope + digest, independently of whatever the application computed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sangfor_audit_logs_hash_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_predecessor_hash text;
  v_occurred_at text;
  v_envelope jsonb;
  v_recomputed_hash text;
BEGIN
  IF NEW."sequence" = 1 THEN
    IF NEW.previous_hash IS DISTINCT FROM repeat('0', 64) THEN
      RAISE EXCEPTION 'audit_logs: genesis row (sequence=1) for chain_scope_key % must have previous_hash = 64 zeroes, got %', NEW.chain_scope_key, NEW.previous_hash
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT event_hash INTO v_predecessor_hash FROM audit_logs WHERE chain_scope_key = NEW.chain_scope_key AND "sequence" = NEW."sequence" - 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'audit_logs: no predecessor row found for chain_scope_key % at sequence % (sequences must be assigned contiguously starting at 1)', NEW.chain_scope_key, NEW."sequence" - 1
        USING ERRCODE = '22023';
    END IF;
    IF NEW.previous_hash IS DISTINCT FROM v_predecessor_hash THEN
      RAISE EXCEPTION 'audit_logs: previous_hash does not equal the predecessor row''s event_hash for chain_scope_key % sequence %', NEW.chain_scope_key, NEW."sequence"
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_occurred_at := to_char(NEW."timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  v_envelope := jsonb_build_object(
    'actorId', NEW.actor_id,
    'chainScopeKey', NEW.chain_scope_key,
    'details', NEW.details,
    'eventType', NEW.event_type,
    'occurredAt', v_occurred_at,
    'previousHash', NEW.previous_hash,
    'resourceId', NEW.resource_id,
    'resourceType', NEW.resource_type,
    'scope', jsonb_build_object('companyId', NEW.company_id, 'level', NEW.scope_level, 'projectId', NEW.project_id, 'tenantId', NEW.tenant_id),
    'sequence', NEW."sequence",
    'version', 'sangfor.audit-chain/v1'
  );

  v_recomputed_hash := public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(v_envelope));
  IF NEW.event_hash IS DISTINCT FROM v_recomputed_hash THEN
    RAISE EXCEPTION 'audit_logs: event_hash does not equal sha256(RFC 8785 JCS(sangfor.audit-chain/v1 envelope)) recomputed server-side for chain_scope_key % sequence %', NEW.chain_scope_key, NEW."sequence"
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER sangfor_audit_logs_hash_guard_trg
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION public.sangfor_audit_logs_hash_guard();

-- ─────────────────────────────────────────────────────────────────────────
-- Step 9: append-only. Reuses the existing sangfor_deny_mutation() function (migration
-- 20260715170000) — RAISES on any UPDATE/DELETE, including Prisma raw SQL, with ERRCODE 0A000
-- (feature_not_supported).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TRIGGER sangfor_audit_logs_deny_update_trg
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();

CREATE TRIGGER sangfor_audit_logs_deny_delete_trg
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION public.sangfor_deny_mutation();

-- ─────────────────────────────────────────────────────────────────────────
-- Step 10: app-role grants — INSERT/SELECT only, exactly as U016 (migration 20260715160000)
-- established for its pilot tables. No UPDATE/DELETE grant (defense-in-depth alongside Step 9's
-- deny triggers, which apply regardless of role). sangfor_app_login itself continues to receive no
-- direct grant at all (it may only act via SET ROLE sangfor_app, per U016).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sangfor_app') THEN
    REVOKE ALL ON TABLE audit_logs FROM sangfor_app_login;
    GRANT SELECT, INSERT ON TABLE audit_logs TO sangfor_app;
  END IF;
END $$;
