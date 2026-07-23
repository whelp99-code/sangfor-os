-- U041 upgrade fixture: deliberately pre-U041 tables only, synthetic and non-secret.
-- The db:contract suite loads this after the exact U040 prefix and snapshots these rows before
-- the additive U041 migration exists.
SET session_replication_role = replica;

INSERT INTO tenants (id, name, slug, status, created_at)
VALUES ('u041-fixture-tenant', 'U041 Fixture Tenant', 'u041-fixture-tenant', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at)
VALUES ('u041-fixture-company', 'u041-fixture-tenant', 'U041 Fixture Company', 'u041-fixture-company', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at)
VALUES ('u041-fixture-project', 'u041-fixture-project', 'U041 Fixture Project', 'u041-fixture-company', now(), now());

INSERT INTO users (id, email, name, status, created_at, updated_at)
VALUES ('u041-fixture-user', 'u041-fixture@example.test', 'U041 Fixture User', 'active', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at)
VALUES ('u041-fixture-assignment', 'u041-fixture-user', 'u041-fixture-company', 'account_manager', 'active', now() - interval '1 day', now());

INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, ownership_revision, current_revision, created_at, updated_at)
VALUES ('u041-fixture-artifact', 'u041-fixture-tenant', 'u041-fixture-company', 'u041-fixture-project', 'assessment-input', 'internal', 'human', 'U041 fixture artifact', 'u041-fixture-assignment', 'u041-fixture-assignment', 0, 0, now(), now());

INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
VALUES ('u041-fixture-artifact-version', 'u041-fixture-artifact', 1, 'artifact-content/rfc8785-jcs-sha256/v1', 'u041-fixture-envelope', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}'::jsonb, 'review_ready', 'u041-fixture-assignment', now());

SET session_replication_role = origin;
