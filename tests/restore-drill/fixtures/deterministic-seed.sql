-- Tracked fixture: bytes are hashed into fixture.sha256, so edits change the
-- hash contract. Isolated-container use only, never a compose/operational DB.

INSERT INTO "projects" (id, slug, name, description, created_at, updated_at) VALUES
  ('u009fx-project-1', 'u009-restore-drill-fixture', 'U009 Restore Drill Fixture Project', 'Deterministic S9a fixture row, safe to dump/restore/drop in isolated containers only.', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO "customers" (id, project_id, name, domain, industry, status, notes, segment, risk_score, created_at, updated_at) VALUES
  ('u009fx-customer-1', 'u009fx-project-1', 'U009 Fixture Customer One', 'u009-fixture-one.example', 'ops', 'active', 'deterministic restore-drill fixture row', 'UNCLASSIFIED', 0.5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('u009fx-customer-2', 'u009fx-project-1', 'U009 Fixture Customer Two', 'u009-fixture-two.example', 'ops', 'active', 'deterministic restore-drill fixture row', 'UNCLASSIFIED', 0.5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO "opportunities" (id, project_id, customer_id, title, code, stage, deal_status, amount, probability, created_at, updated_at) VALUES
  ('u009fx-opportunity-1', 'u009fx-project-1', 'u009fx-customer-1', 'U009 Fixture Opportunity One', 'PRJ-2026-' || lpad(nextval('opp_code_seq')::text, 4, '0'), 'QUALIFIED', 'OPEN', 12345.67, 40, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('u009fx-opportunity-2', 'u009fx-project-1', 'u009fx-customer-2', 'U009 Fixture Opportunity Two', 'PRJ-2026-' || lpad(nextval('opp_code_seq')::text, 4, '0'), 'PROPOSAL', 'OPEN', 54321.00, 60, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
