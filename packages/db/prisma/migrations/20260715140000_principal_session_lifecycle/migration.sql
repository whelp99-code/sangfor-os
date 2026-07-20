-- U014/SEC-01: persist principal/session lifecycle. Additive only: new nullable User columns
-- with a named lifecycle CHECK, and a new auth_sessions table whose scoped FKs follow U012's
-- composite scope-closure constraints (companies_tenant_id_id_key / projects_company_id_id_key).
-- No DROP, no type narrowing, no destructive backfill. This migration NEVER writes "active" into
-- any existing row: the ADD COLUMN ... DEFAULT below assigns every pre-existing row the inactive
-- "legacy_pending" value, exactly matching the CHECK constraint added in the same migration.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'principal_session_lifecycle migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'principal_session_lifecycle migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- Step 1: additive User lifecycle columns. DEFAULT 'legacy_pending' means every existing row
-- (and any future row that omits the column) becomes/remains "legacy_pending" — never NULL-by
-- omission-turned-active, and never blanket-activated. disabled_at/disabled_reason stay NULL for
-- every existing row (no existing row is retroactively marked disabled either).
ALTER TABLE "users" ADD COLUMN "status" TEXT DEFAULT 'legacy_pending';
ALTER TABLE "users" ADD COLUMN "disabled_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "disabled_reason" TEXT;

-- Step 2: named lifecycle CHECK. Validates immediately (safe by construction: every existing row
-- just received status='legacy_pending', disabled_at=NULL from Step 1, which satisfies every
-- clause below). "active" requires disabled_at IS NULL; "disabled" requires disabled_at IS NOT
-- NULL; NULL/legacy_pending/active/disabled are the only allowed non-NULL values.
ALTER TABLE "users" ADD CONSTRAINT "users_status_lifecycle_check" CHECK (
  (status IS NULL OR status IN ('active', 'disabled', 'legacy_pending'))
  AND (status IS DISTINCT FROM 'disabled' OR disabled_at IS NOT NULL)
  AND (status IS DISTINCT FROM 'active' OR disabled_at IS NULL)
);

-- Step 3: auth_sessions. `id` is the JWT `jti` — a plain TEXT primary key supplied by the
-- application at INSERT time (no @default), never a separate surrogate id. No raw JWT column
-- exists anywhere on this table.
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "mfa_verified_at" TIMESTAMP(3),
    "mfa_method" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite FKs: company_id must actually belong to tenant_id (companies_tenant_id_id_key from
-- U012), and project_id must actually belong to company_id (projects_company_id_id_key from
-- U012). A session row that names a real tenant/company/project which do not form one consistent
-- scope chain is rejected by Postgres itself at INSERT/UPDATE time.
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_project_id_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "projects"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
