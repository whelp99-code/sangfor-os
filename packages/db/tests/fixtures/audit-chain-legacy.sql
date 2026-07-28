-- U021/AUD-01b legacy pre-migration fixture: seeded against the exact formal migration prefix
-- THROUGH U020 (audit_logs still has only its pre-U021 columns: id/event_type/actor_id/
-- resource_type/resource_id/details/previous_hash/event_hash/timestamp/created_at). Every
-- resource_type/resource_id pair below resolves under 20260715210000_harden_scoped_audit_chain's
-- documented convention ('tenant'/'company'/'opportunity'), covering all three scope levels.
-- aud-log-tenant-a/aud-log-tenant-b share an identical timestamp/created_at and are inserted
-- OUT of id order (b before a) to prove the migration's legacy ordering is
-- `ORDER BY timestamp ASC, created_at ASC, id COLLATE "C" ASC`, not insertion/heap order.

INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('aud-tenant-1', 'Audit Fixture Tenant', 'aud-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('aud-company-1', 'aud-tenant-1', 'Audit Fixture Company', 'aud-company-1', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('aud-project-1', 'aud-project-1', 'Audit Fixture Project One', 'aud-company-1', now(), now()),
  ('aud-project-2', 'aud-project-2', 'Audit Fixture Project Two', 'aud-company-1', now(), now());

INSERT INTO opportunities (id, project_id, title, created_at, updated_at) VALUES
  ('aud-opp-1', 'aud-project-1', 'Audit Fixture Opportunity One', now(), now()),
  ('aud-opp-2', 'aud-project-2', 'Audit Fixture Opportunity Two', now(), now());

INSERT INTO audit_logs (id, event_type, actor_id, resource_type, resource_id, details, previous_hash, event_hash, timestamp, created_at) VALUES
  ('aud-log-tenant-b', 'tenant.viewed', 'legacy-actor-1', 'tenant', 'aud-tenant-1', '{"note":"b"}'::jsonb, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
  ('aud-log-tenant-a', 'tenant.viewed', 'legacy-actor-1', 'tenant', 'aud-tenant-1', '{"note":"a"}'::jsonb, NULL, NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
  ('aud-log-company-1', 'company.updated', 'legacy-actor-2', 'company', 'aud-company-1', NULL, NULL, NULL, '2026-01-02 00:00:00', '2026-01-02 00:00:00'),
  ('aud-log-company-2', 'company.updated', 'legacy-actor-2', 'company', 'aud-company-1', '{"field":"name"}'::jsonb, 'stale-legacy-hash', 'stale-legacy-hash', '2026-01-03 00:00:00', '2026-01-03 00:00:00'),
  ('aud-log-project1-a', 'opportunity.created', 'legacy-actor-3', 'opportunity', 'aud-opp-1', '{"amount":1000}'::jsonb, NULL, NULL, '2026-01-04 00:00:00', '2026-01-04 00:00:00'),
  ('aud-log-project1-b', 'opportunity.updated', 'legacy-actor-3', 'opportunity', 'aud-opp-1', '{"amount":2000}'::jsonb, NULL, NULL, '2026-01-05 00:00:00', '2026-01-05 00:00:00'),
  ('aud-log-project2-a', 'opportunity.created', 'legacy-actor-4', 'opportunity', 'aud-opp-2', '{"amount":500}'::jsonb, NULL, NULL, '2026-01-06 00:00:00', '2026-01-06 00:00:00');
