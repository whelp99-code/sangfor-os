-- U042 prefix-upgrade fixture. It is loaded strictly after U041 and before U042.
-- All values are synthetic and non-secret. Replica mode is fixture-only: it permits deterministic
-- predecessor rows while CHECK constraints remain active; the runner restores origin mode before
-- the U042 migration and every behavioral assertion.
SET session_replication_role = replica;

INSERT INTO tenants (id, name, slug, status, created_at)
VALUES ('u042-tenant', 'U042 Fixture Tenant', 'u042-fixture-tenant', 'active', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u042-company-a', 'u042-tenant', 'U042 Company A', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-company-b', 'u042-tenant', 'U042 Company B', 'u042-company-b', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u042-project-a', 'u042-project-a', 'U042 Project A', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-project-b', 'u042-project-b', 'U042 Project B', 'u042-company-b', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u042-user-source', 'u042-source@example.test', 'U042 Source', 'active', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-user-successor', 'u042-successor@example.test', 'U042 Successor', 'active', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-user-requester', 'u042-requester@example.test', 'U042 Requester', 'active', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-user-cross', 'u042-cross@example.test', 'U042 Cross Company', 'active', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, revision, created_at) VALUES
  ('u042-assignment-source', 'u042-user-source', 'u042-company-a', 'account_manager', 'active', TIMESTAMP '2026-07-14 00:00:00', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-assignment-successor', 'u042-user-successor', 'u042-company-a', 'account_manager', 'active', TIMESTAMP '2026-07-14 00:00:00', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-assignment-requester', 'u042-user-requester', 'u042-company-a', 'account_manager', 'active', TIMESTAMP '2026-07-14 00:00:00', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-assignment-cross', 'u042-user-cross', 'u042-company-b', 'account_manager', 'active', TIMESTAMP '2026-07-14 00:00:00', 0, TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO customers (id, project_id, archived_at, name, status, created_at, updated_at) VALUES
  ('u042-customer-a', 'u042-project-a', NULL, 'U042 Customer A', 'active', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO artifacts (
  id, tenant_id, company_id, project_id, artifact_type, classification, origin, title,
  created_by_assignment_id, owner_assignment_id, ownership_revision, current_revision,
  created_at, updated_at
) VALUES
  ('u042-artifact-a', 'u042-tenant', 'u042-company-a', 'u042-project-a', 'governance-fixture', 'internal', 'human', 'U042 Artifact A',
   'u042-assignment-requester', 'u042-assignment-source', 3, 0, TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-artifact-b', 'u042-tenant', 'u042-company-b', 'u042-project-b', 'governance-fixture', 'internal', 'human', 'U042 Artifact B',
   'u042-assignment-cross', 'u042-assignment-cross', 0, 0, TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO artifact_versions (
  id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash,
  content_json, status, created_by_assignment_id, created_at
) VALUES
  ('u042-artifact-version-a', 'u042-artifact-a', 1, 'artifact-content/rfc8785-jcs-sha256/v1',
   '{"contract":"sangfor.artifact-content","payload":{},"version":1}',
   public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{},"version":1}'),
   '{}'::jsonb, 'review_ready', 'u042-assignment-requester', TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-artifact-version-b', 'u042-artifact-b', 1, 'artifact-content/rfc8785-jcs-sha256/v1',
   '{"contract":"sangfor.artifact-content","payload":{"company":"b"},"version":1}',
   public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{"company":"b"},"version":1}'),
   '{"company":"b"}'::jsonb, 'review_ready', 'u042-assignment-cross', TIMESTAMP '2026-07-15 00:00:00');

INSERT INTO approval_requests (
  id, status, reason, created_at, tenant_id, company_id, project_id, artifact_version_id,
  action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id,
  owner_assignment_id, ownership_revision, policy_key, policy_version, policy_hash,
  validation_snapshot, validation_snapshot_hash, required_quorum, revision, legacy_unbound, updated_at
) VALUES
  ('u042-approval-a', 'pending', 'U042 approval A', TIMESTAMP '2026-07-15 00:00:00',
   'u042-tenant', 'u042-company-a', 'u042-project-a', 'u042-artifact-version-a',
   'governance.execute', public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{},"version":1}'),
   'u042-assignment-requester', 'u042-session-a', 'u042-assignment-source', 4,
   'governance', 'v1', repeat('a', 64), '{}'::jsonb,
   public.sangfor_validation_snapshot_sha256('{}'::jsonb), 1, 0, false, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-approval-b', 'pending', 'U042 approval B', TIMESTAMP '2026-07-15 00:00:00',
   'u042-tenant', 'u042-company-b', 'u042-project-b', 'u042-artifact-version-b',
   'governance.execute', public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{"company":"b"},"version":1}'),
   'u042-assignment-cross', 'u042-session-b', 'u042-assignment-cross', 0,
   'governance', 'v1', repeat('b', 64), '{}'::jsonb,
   public.sangfor_validation_snapshot_sha256('{}'::jsonb), 1, 0, false, TIMESTAMP '2026-07-15 00:00:00');

-- Exact unfiltered seven-model ownership source set, including archived and terminal examples.
INSERT INTO opportunities (
  id, project_id, archived_at, title, owner_assignment_id, ownership_revision, created_at, updated_at
) VALUES (
  'u042-opportunity-a', 'u042-project-a', TIMESTAMP '2026-07-14 00:00:00', 'U042 Archived Opportunity',
  'u042-assignment-source', 5, TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'
);

INSERT INTO work_tasks (
  id, project_id, archived_at, title, status, owner_assignment_id, ownership_revision, created_at, updated_at
) VALUES (
  'u042-work-task-a', 'u042-project-a', TIMESTAMP '2026-07-14 00:00:00', 'U042 Archived Task', 'done',
  'u042-assignment-source', 6, TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'
);

INSERT INTO vendor_requests (
  id, request_type, vendor_name, details_json, status, created_by, customer_id,
  owner_assignment_id, ownership_revision, revision, created_at, updated_at
) VALUES (
  'u042-vendor-request-a', 'pricing', 'U042 Vendor', '{}'::jsonb, 'draft', 'u042-user-requester',
  'u042-customer-a', 'u042-assignment-source', 7, 0, TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'
);

INSERT INTO renewal_opportunities (
  id, customer_id, renewal_type, status, owner_assignment_id, ownership_revision, created_at, updated_at
) VALUES (
  'u042-renewal-a', 'u042-customer-a', 'annual', 'renewed',
  'u042-assignment-source', 8, TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'
);

INSERT INTO support_cases (
  id, customer_id, subject, severity, status, owner_assignment_id, ownership_revision,
  revision, resolved_at, closed_at, created_at, updated_at
) VALUES (
  'u042-support-case-a', 'u042-customer-a', 'U042 Closed Support Case', 'medium', 'closed',
  'u042-assignment-source', 9, 0, TIMESTAMP '2026-07-14 00:00:00', TIMESTAMP '2026-07-14 00:00:00',
  TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'
);

INSERT INTO knowledge_documents (id, project_id, title, body, tags, source, created_at, updated_at)
VALUES (
  'u042-document-a', 'u042-project-a', 'U042 Retention Document', 'synthetic fixture body',
  ARRAY['u042'], 'manual', TIMESTAMP '2026-07-15 00:00:00', TIMESTAMP '2026-07-15 00:00:00'
);

INSERT INTO audit_logs (
  id, tenant_id, scope_level, company_id, project_id, chain_scope_key, sequence,
  event_type, actor_id, resource_type, resource_id, details, previous_hash, event_hash,
  idempotency_key, "timestamp", created_at
) VALUES
  ('u042-audit-export', 'u042-tenant', 'COMPANY', 'u042-company-a', NULL, 'company:u042-tenant:u042-company-a', 1,
   'export.issued', 'u042-user-requester', 'company', 'u042-company-a', '{}'::jsonb, repeat('0',64), repeat('1',64),
   'u042-audit-export', TIMESTAMP '2026-07-15 00:00:01', TIMESTAMP '2026-07-15 00:00:01'),
  ('u042-audit-retention', 'u042-tenant', 'COMPANY', 'u042-company-a', NULL, 'company:u042-tenant:u042-company-a', 2,
   'retention.preview', 'u042-user-requester', 'company', 'u042-company-a', '{}'::jsonb, repeat('1',64), repeat('2',64),
   'u042-audit-retention', TIMESTAMP '2026-07-15 00:00:02', TIMESTAMP '2026-07-15 00:00:02'),
  ('u042-audit-transfer-preview', 'u042-tenant', 'COMPANY', 'u042-company-a', NULL, 'company:u042-tenant:u042-company-a', 3,
   'ownership.preview', 'u042-user-requester', 'company', 'u042-company-a', '{}'::jsonb, repeat('2',64), repeat('3',64),
   'u042-audit-transfer-preview', TIMESTAMP '2026-07-15 00:00:03', TIMESTAMP '2026-07-15 00:00:03'),
  ('u042-audit-transfer-complete', 'u042-tenant', 'COMPANY', 'u042-company-a', NULL, 'company:u042-tenant:u042-company-a', 4,
   'ownership.complete', 'u042-user-requester', 'company', 'u042-company-a', '{}'::jsonb, repeat('3',64), repeat('4',64),
   'u042-audit-transfer-complete', TIMESTAMP '2026-07-15 00:00:04', TIMESTAMP '2026-07-15 00:00:04'),
  ('u042-audit-cross', 'u042-tenant', 'COMPANY', 'u042-company-b', NULL, 'company:u042-tenant:u042-company-b', 1,
   'cross.probe', 'u042-user-cross', 'company', 'u042-company-b', '{}'::jsonb, repeat('0',64), repeat('5',64),
   'u042-audit-cross', TIMESTAMP '2026-07-15 00:00:05', TIMESTAMP '2026-07-15 00:00:05');

INSERT INTO role_change_requests (
  id, user_id, from_role, to_role, status, requested_by, company_id, created_at,
  legacy_unbound, legacy_status, revision, updated_at
) VALUES
  ('u042-role-change-main', 'u042-user-source', 'account_manager', 'viewer', 'legacy_unbound', 'u042-user-requester', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00', true, 'pending', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-role-change-requested-cancel', 'u042-user-source', 'account_manager', 'viewer', 'legacy_unbound', 'u042-user-requester', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00', true, 'pending', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-role-change-blocked', 'u042-user-source', 'account_manager', 'viewer', 'legacy_unbound', 'u042-user-requester', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00', true, 'pending', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-role-change-approved-cancel', 'u042-user-source', 'account_manager', 'viewer', 'legacy_unbound', 'u042-user-requester', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00', true, 'pending', 0, TIMESTAMP '2026-07-15 00:00:00'),
  ('u042-role-change-tamper', 'u042-user-source', 'account_manager', 'viewer', 'legacy_unbound', 'u042-user-requester', 'u042-company-a', TIMESTAMP '2026-07-15 00:00:00', true, 'pending', 0, TIMESTAMP '2026-07-15 00:00:00');

-- These are the exact two pre-U042 legacy branches that the migration must preserve in place.
INSERT INTO data_export_requests (id, artifact_id, requested_by, reason, status, approved_by)
VALUES (
  'u042-legacy-export', ' legacy-artifact-ref ', 'legacy-requester-ref',
  E'  retention evidence\\nkeep whitespace  ', 'pending', NULL
);

INSERT INTO artifact_access_events (id, artifact_id, user_id, access_type, "timestamp")
VALUES (
  'u042-legacy-access', ' legacy-artifact-ref ', 'legacy-user-ref', 'legacy download',
  TIMESTAMP '2026-07-16 00:00:00.123'
);

SET session_replication_role = origin;
