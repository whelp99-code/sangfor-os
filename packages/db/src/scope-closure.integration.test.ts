import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

import {
  buildClosureReport,
  fetchCompanyTenantRows,
  fetchControlRow,
  fetchControlRowVerificationInput,
  fetchLiveCounts,
  fetchProjectClosureRows,
  fetchQuarantineRows,
  fetchRoleChangeClosureInput,
  verifyControlRow,
  type DigestClient,
} from './scope-closure';
import { MODEL_SCOPE_INVENTORY } from './scope-inventory';

const integration = process.env.CI_INTEGRATION === '1';

const CLOSED_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-it-tenant-1', 'Fixture Tenant', 'fx-it-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-it-company-1', 'fx-it-tenant-1', 'Company One', 'fx-it-company-1', now());

INSERT INTO projects (id, slug, name, description, company_id, created_at, updated_at) VALUES
  ('fx-it-project-1', 'fx-it-project-1', 'Fixture Project', NULL, 'fx-it-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('fx-it-user-1', 'fx-it-user-1@fixture.example.com', 'User One', now(), now());

INSERT INTO role_change_requests (id, user_id, from_role, to_role, status, requested_by, approved_by, company_id, created_at) VALUES
  ('fx-it-rcr-1', 'fx-it-user-1', 'member', 'admin', 'pending', 'fx-it-user-1', NULL, 'fx-it-company-1', now());
`;

const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u012it${Date.now().toString(36)}`;
// Evidence lives under the OS temp dir, never under the repo tree (dispatch hard rule: evidence
// only under $EV or /tmp) — unlike U011's sibling integration test, which predates this rule.
const EVIDENCE_DIR = join(tmpdir(), 'u012-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

describe.skipIf(!integration)('scope-closure DB-touching layer (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U012', purpose: 'scope-closure-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: { databaseUrl: string }) => {
        resolveReady(ctx.databaseUrl);
        await held;
      },
    );
    cleanupFn = async () => {
      releaseCallback?.();
      await lifecycle;
    };

    const databaseUrl = await ready;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    for (const statement of CLOSED_FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await prisma.$executeRawUnsafe(`${trimmed};`);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  it('the migration-created empty_database control row is present and fetchable', async () => {
    const client = prisma as unknown as DigestClient;
    const row = await fetchControlRow(client);
    expect(row?.reasonCode).toBe('scope_backfill_empty_database');
    expect(row?.resolvedBy).toBe('migration:20260715110000_scope_backfill_quarantine');
  });

  it('fetchLiveCounts reflects the seeded fixture (non-empty, does not match the empty_database mode)', async () => {
    const client = prisma as unknown as DigestClient;
    const counts = await fetchLiveCounts(client);
    expect(counts.projects).toBe(1);
    expect(counts.roleChangeRequests).toBe(1);
  });

  it('verifyControlRow flags CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY once real fixture rows exist alongside the migration-time empty sentinel', async () => {
    const client = prisma as unknown as DigestClient;
    const input = await fetchControlRowVerificationInput(client);
    const result = verifyControlRow(input);
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY')).toBe(true);
  });

  it('fetchProjectClosureRows returns the live company_id-scoped Project row', async () => {
    const client = prisma as unknown as DigestClient;
    const rows = await fetchProjectClosureRows(client);
    expect(rows).toEqual([{ id: 'fx-it-project-1', companyId: 'fx-it-company-1' }]);
  });

  it('fetchCompanyTenantRows confirms the fixture Company resolves to an existing Tenant', async () => {
    const client = prisma as unknown as DigestClient;
    const rows = await fetchCompanyTenantRows(client);
    expect(rows).toEqual([{ companyId: 'fx-it-company-1', tenantId: 'fx-it-tenant-1', tenantExists: true }]);
  });

  it('fetchRoleChangeClosureInput reports zero live nulls and zero stale quarantine overlap for the fixture', async () => {
    const client = prisma as unknown as DigestClient;
    const input = await fetchRoleChangeClosureInput(client, null);
    expect(input.liveNullCompanyCount).toBe(0);
    expect(input.liveTotalCount).toBe(1);
    expect(input.staleQuarantineLiveOverlapCount).toBe(0);
  });

  it('fetchQuarantineRows excludes the control row itself (source_model=__ScopeBackfillControl)', async () => {
    const client = prisma as unknown as DigestClient;
    const rows = await fetchQuarantineRows(client);
    expect(rows.every((r) => r.sourceModel !== '__ScopeBackfillControl')).toBe(true);
  });

  it('buildClosureReport over live-fetched facts is NOT ok while the stale empty_database sentinel coexists with real data (real-surface proof of the blocking control-row check)', async () => {
    const client = prisma as unknown as DigestClient;
    const [controlRow, projects, quarantineRows, companyTenantRows, roleChangeRequest] = await Promise.all([
      fetchControlRowVerificationInput(client),
      fetchProjectClosureRows(client),
      fetchQuarantineRows(client),
      fetchCompanyTenantRows(client),
      fetchRoleChangeClosureInput(client, null),
    ]);
    const report = buildClosureReport({
      currentModelNames: Object.keys(MODEL_SCOPE_INVENTORY),
      inventoryEntries: Object.values(MODEL_SCOPE_INVENTORY),
      dmmfRelations: [],
      controlRow,
      projects,
      manifestEntries: null,
      quarantineRows,
      companyTenantRows,
      roleChangeRequest,
    });
    expect(report.ok).toBe(false);
    expect(report.controlRow.blockers.some((b) => b.code === 'CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY')).toBe(true);
  });
});
