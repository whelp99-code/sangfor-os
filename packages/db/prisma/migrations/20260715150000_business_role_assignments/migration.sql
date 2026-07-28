-- U015/SEC-02a: persist BusinessRole company-role assignments and project-assignment lifecycle.
-- Additive only: new nullable columns with named lifecycle CHECKs, one grandfathered "for new
-- rows" role-code CHECK, one nullable audit FK, and supporting indexes. No DROP, no type
-- narrowing, no destructive backfill. Every ADD COLUMN ... DEFAULT below leaves every pre-existing
-- row "legacy_pending" (inactive) — this migration never blanket-activates anything. U015 adds no
-- Prisma model: user_company_roles and project_members both already exist.

DO $$
DECLARE
  v_major integer;
  v_encoding text;
BEGIN
  SELECT current_setting('server_version_num')::integer / 10000 INTO v_major;
  IF v_major <> 16 THEN
    RAISE EXCEPTION 'business_role_assignments migration requires PostgreSQL major version 16, got %', v_major;
  END IF;

  SELECT current_setting('server_encoding') INTO v_encoding;
  IF v_encoding <> 'UTF8' THEN
    RAISE EXCEPTION 'business_role_assignments migration requires server_encoding=UTF8, got %', v_encoding;
  END IF;
END $$;

-- Step 1: additive UserCompanyRole lifecycle + assignment metadata columns.
ALTER TABLE "user_company_roles" ADD COLUMN "status" TEXT DEFAULT 'legacy_pending';
ALTER TABLE "user_company_roles" ADD COLUMN "valid_from" TIMESTAMP(3);
ALTER TABLE "user_company_roles" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "user_company_roles" ADD COLUMN "revoked_at" TIMESTAMP(3);
ALTER TABLE "user_company_roles" ADD COLUMN "assigned_by_id" TEXT;
ALTER TABLE "user_company_roles" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- Step 2: named lifecycle CHECK. Validates immediately — every existing row just received
-- status='legacy_pending', revoked_at=NULL from Step 1, which satisfies every clause below.
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_status_lifecycle_check" CHECK (
  (status IS NULL OR status IN ('active', 'revoked', 'expired', 'legacy_pending'))
  AND (status IS DISTINCT FROM 'revoked' OR revoked_at IS NOT NULL)
  AND (status IS DISTINCT FROM 'active' OR revoked_at IS NULL)
);

-- Step 3: assigned_by_id is an audit/attribution FK only (who made the assignment), never a scope
-- root — ON DELETE SET NULL so deleting the assigning user never blocks deleting that row.
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: role stays Prisma-unconstrained (String) but the DB forbids a NEW row from carrying a
-- role outside the ten @sangfor/auth BusinessRole codes. A row created before this migration's
-- watermark is grandfathered (this validates immediately, true for every existing row by
-- construction, including the campaign's synthetic "member" fixtures) — only rows written at/after
-- the watermark must use a canonical code.
DO $$
DECLARE
  v_watermark timestamptz := clock_timestamp();
BEGIN
  EXECUTE format(
    'ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_role_ten_codes_for_new_rows_check" CHECK (created_at < %L OR role IN (%s))',
    v_watermark,
    '''ceo'',''sales_manager'',''account_manager'',''presales_engineer'',''solution_architect'',''finance_manager'',''delivery_engineer'',''support_engineer'',''security_officer'',''system_admin'''
  );
END $$;

CREATE INDEX "user_company_roles_user_id_company_id_status_idx" ON "user_company_roles"("user_id", "company_id", "status");

-- Step 5: ProjectMember gets the identical fail-closed lifecycle shape (status/valid_from/
-- expires_at/revoked_at), for project ABAC. Company role and project assignment stay distinct
-- concepts — no FK between this table and user_company_roles; `role` here is untouched (stays
-- unconstrained, e.g. "member") since only UserCompanyRole.role is BusinessRole-typed.
ALTER TABLE "project_members" ADD COLUMN "status" TEXT DEFAULT 'legacy_pending';
ALTER TABLE "project_members" ADD COLUMN "valid_from" TIMESTAMP(3);
ALTER TABLE "project_members" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "project_members" ADD COLUMN "revoked_at" TIMESTAMP(3);

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_status_lifecycle_check" CHECK (
  (status IS NULL OR status IN ('active', 'revoked', 'expired', 'legacy_pending'))
  AND (status IS DISTINCT FROM 'revoked' OR revoked_at IS NOT NULL)
  AND (status IS DISTINCT FROM 'active' OR revoked_at IS NULL)
);

CREATE INDEX "project_members_user_id_status_idx" ON "project_members"("user_id", "status");
