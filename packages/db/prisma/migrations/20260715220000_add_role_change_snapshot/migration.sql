-- U024 / SEC-02b. U012 has already proven required company scope; do not read quarantine here.
ALTER TABLE "role_change_requests"
  ADD COLUMN "legacy_unbound" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "legacy_status" TEXT,
  ADD COLUMN "tenant_id" TEXT,
  ADD COLUMN "target_membership_id" TEXT,
  ADD COLUMN "requested_by_assignment_id" TEXT,
  ADD COLUMN "expected_membership_revision" INTEGER,
  ADD COLUMN "artifact_version_id" TEXT,
  ADD COLUMN "approval_request_id" TEXT,
  ADD COLUMN "snapshot_hash" TEXT,
  ADD COLUMN "policy_version" TEXT,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "request_idempotency_key" TEXT,
  ADD COLUMN "request_input_hash" TEXT,
  ADD COLUMN "terminal_at" TIMESTAMP(3),
  ADD COLUMN "terminal_reason_code" TEXT,
  ADD COLUMN "applied_at" TIMESTAMP(3),
  ADD COLUMN "applied_by_assignment_id" TEXT,
  ADD COLUMN "applied_membership_revision" INTEGER,
  ADD COLUMN "applied_approval_revision" INTEGER,
  ADD COLUMN "applied_decision_sequence" INTEGER,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Byte-for-byte legacy status preservation and fail-closed freeze. No canonical identity is invented.
UPDATE "role_change_requests"
SET "legacy_status" = "status", "legacy_unbound" = true, "status" = 'legacy_unbound';
ALTER TABLE "role_change_requests" ALTER COLUMN "status" SET DEFAULT 'legacy_unbound';

ALTER TABLE "role_change_requests"
  ADD CONSTRAINT "role_change_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "role_change_requests_target_membership_id_fkey" FOREIGN KEY ("target_membership_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "role_change_requests_requested_by_assignment_id_fkey" FOREIGN KEY ("requested_by_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "role_change_requests_applied_by_assignment_id_fkey" FOREIGN KEY ("applied_by_assignment_id", "company_id") REFERENCES "user_company_roles"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "role_change_requests_artifact_version_id_fkey" FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "role_change_requests_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "role_change_requests_artifact_version_id_key" ON "role_change_requests"("artifact_version_id");
CREATE UNIQUE INDEX "role_change_requests_approval_request_id_key" ON "role_change_requests"("approval_request_id");
CREATE UNIQUE INDEX "role_change_requests_request_idempotency_uidx" ON "role_change_requests"("company_id", "requested_by_assignment_id", "request_idempotency_key") WHERE "legacy_unbound" = false;
CREATE UNIQUE INDEX "role_change_requests_open_target_uidx" ON "role_change_requests"("company_id", "target_membership_id") WHERE "legacy_unbound" = false AND "status" = 'pending_approval';

ALTER TABLE "role_change_requests"
  ADD CONSTRAINT "role_change_requests_status_chk" CHECK ("status" IN ('legacy_unbound','pending_approval','applied','rejected','cancelled','expired')),
  ADD CONSTRAINT "role_change_requests_revision_chk" CHECK ("revision" IN (0, 1)),
  ADD CONSTRAINT "role_change_requests_request_input_hash_chk" CHECK ("request_input_hash" IS NULL OR "request_input_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "role_change_requests_idempotency_key_chk" CHECK ("request_idempotency_key" IS NULL OR "request_idempotency_key" ~ '^[!-~]{16,128}$'),
  ADD CONSTRAINT "role_change_requests_canonical_shape_chk" CHECK (("legacy_unbound" = true AND "status" = 'legacy_unbound') OR ("legacy_unbound" = false AND "status" <> 'legacy_unbound' AND "legacy_status" IS NULL AND "tenant_id" IS NOT NULL AND "target_membership_id" IS NOT NULL AND "requested_by_assignment_id" IS NOT NULL AND "expected_membership_revision" IS NOT NULL AND "artifact_version_id" IS NOT NULL AND "approval_request_id" IS NOT NULL AND "snapshot_hash" ~ '^[0-9a-f]{64}$' AND "policy_version" IS NOT NULL AND "expires_at" IS NOT NULL AND "request_idempotency_key" IS NOT NULL AND "request_input_hash" IS NOT NULL)),
  ADD CONSTRAINT "role_change_requests_application_shape_chk" CHECK (("status" = 'pending_approval' AND "revision" = 0 AND "terminal_at" IS NULL AND "terminal_reason_code" IS NULL AND "applied_at" IS NULL AND "applied_by_assignment_id" IS NULL AND "applied_membership_revision" IS NULL AND "applied_approval_revision" IS NULL AND "applied_decision_sequence" IS NULL) OR ("status" = 'applied' AND "revision" = 1 AND "terminal_at" = "applied_at" AND "terminal_reason_code" IS NULL AND "applied_at" IS NOT NULL AND "applied_by_assignment_id" IS NOT NULL AND "applied_membership_revision" = "expected_membership_revision" + 1 AND "applied_approval_revision" > 0 AND "applied_decision_sequence" > 0) OR ("status" IN ('rejected','cancelled','expired') AND "revision" = 1 AND "terminal_at" IS NOT NULL AND "terminal_reason_code" = CASE "status" WHEN 'rejected' THEN 'APPROVAL_REJECTED' WHEN 'cancelled' THEN 'GOVERNANCE_CANCELLED' ELSE 'REQUEST_EXPIRED' END AND "applied_at" IS NULL AND "applied_by_assignment_id" IS NULL AND "applied_membership_revision" IS NULL AND "applied_approval_revision" IS NULL AND "applied_decision_sequence" IS NULL) OR ("status" = 'legacy_unbound' AND "legacy_unbound" = true));

CREATE OR REPLACE FUNCTION sangfor_role_change_request_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.legacy_unbound THEN RAISE EXCEPTION 'new legacy_unbound role change requests are forbidden'; END IF;
  IF NEW.status <> 'pending_approval' OR NEW.revision <> 0 OR NEW.legacy_status IS NOT NULL THEN RAISE EXCEPTION 'canonical role change insert must be pending_approval@0'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "companies" c WHERE c.id = NEW.company_id AND c.tenant_id = NEW.tenant_id) OR NOT EXISTS (SELECT 1 FROM "artifact_versions" av JOIN "artifacts" a ON a.id = av.artifact_id WHERE av.id = NEW.artifact_version_id AND a.tenant_id = NEW.tenant_id AND a.company_id = NEW.company_id) OR NOT EXISTS (SELECT 1 FROM "approval_requests" ar WHERE ar.id = NEW.approval_request_id AND ar.legacy_unbound = false AND ar.action = 'role.change' AND ar.artifact_version_id = NEW.artifact_version_id AND ar.company_id = NEW.company_id) THEN RAISE EXCEPTION 'canonical role change linkage is invalid'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION sangfor_role_change_request_lifecycle_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.legacy_unbound OR OLD.status <> 'pending_approval' OR OLD.revision <> 0 OR NEW.legacy_unbound OR NEW.revision <> 1 OR NEW.status NOT IN ('applied','rejected','cancelled','expired') THEN RAISE EXCEPTION 'role change requests permit only one pending_approval@0 terminal CAS'; END IF;
  IF ROW(NEW.id,NEW.user_id,NEW.from_role,NEW.to_role,NEW.requested_by,NEW.approved_by,NEW.company_id,NEW.created_at,NEW.legacy_unbound,NEW.legacy_status,NEW.tenant_id,NEW.target_membership_id,NEW.requested_by_assignment_id,NEW.expected_membership_revision,NEW.artifact_version_id,NEW.approval_request_id,NEW.snapshot_hash,NEW.policy_version,NEW.expires_at,NEW.request_idempotency_key,NEW.request_input_hash) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.from_role,OLD.to_role,OLD.requested_by,OLD.approved_by,OLD.company_id,OLD.created_at,OLD.legacy_unbound,OLD.legacy_status,OLD.tenant_id,OLD.target_membership_id,OLD.requested_by_assignment_id,OLD.expected_membership_revision,OLD.artifact_version_id,OLD.approval_request_id,OLD.snapshot_hash,OLD.policy_version,OLD.expires_at,OLD.request_idempotency_key,OLD.request_input_hash) THEN RAISE EXCEPTION 'role change canonical fields are immutable'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION sangfor_role_change_request_immutable_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'role change requests are immutable'; END $$;
CREATE TRIGGER "role_change_requests_canonical_insert_guard_trg" BEFORE INSERT ON "role_change_requests" FOR EACH ROW EXECUTE FUNCTION sangfor_role_change_request_insert_guard();
CREATE TRIGGER "role_change_requests_lifecycle_update_guard_trg" BEFORE UPDATE ON "role_change_requests" FOR EACH ROW EXECUTE FUNCTION sangfor_role_change_request_lifecycle_update_guard();
CREATE TRIGGER "role_change_requests_immutable_delete_trg" BEFORE DELETE ON "role_change_requests" FOR EACH ROW EXECUTE FUNCTION sangfor_role_change_request_immutable_delete_guard();
