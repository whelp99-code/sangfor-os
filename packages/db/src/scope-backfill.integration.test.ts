import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

import {
  classifyProjectCompanyScope,
  classifyRoleChangeCompanyScope,
  fetchProjectScopeFacts,
  fetchRequesterKeySets,
  fetchRoleChangeRequestLiveRow,
  fetchRoleChangeScopeFacts,
  fetchUserCompanyMembership,
  fetchUserExists,
  sqlJsonDigestHex,
  verifyRoleChangeRequestRowEnvelopeRoundTrip,
  buildRoleChangeRequestRowEnvelope,
  fetchRoleChangeRequestColumnTypes,
  type DigestClient,
} from './scope-backfill';

const integration = process.env.CI_INTEGRATION === '1';

const SCOPE_BACKFILL_CONTRACT_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-tenant-1', 'Fixture Tenant', 'fx-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-company-alpha', 'fx-tenant-1', 'Alpha Co', 'fx-alpha', now()),
  ('fx-company-beta', 'fx-tenant-1', 'Beta Co', 'fx-beta', now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('fx-user-resolver', 'resolver@fixture.example.com', 'Resolver', now(), now()),
  ('fx-user-target-a', 'target-a@fixture.example.com', 'Target A', now(), now()),
  ('fx-user-email-match', 'emailmatch@fixture.example.com', 'Email Match', now(), now()),
  ('fx-user-target-b', 'target-b@fixture.example.com', 'Target B', now(), now()),
  ('fx-user-dual', 'dual@fixture.example.com', 'Dual', now(), now()),
  ('fx-user-dual-target', 'dual-target@fixture.example.com', 'Dual Target', now(), now()),
  ('fx-user-cross-a', 'cross-a@fixture.example.com', 'Cross A', now(), now()),
  ('fx-user-cross-b', 'fx-user-cross-a', 'Cross B', now(), now()),
  ('fx-user-nomembership', 'nomembership@fixture.example.com', 'No Membership', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, created_at) VALUES
  ('fx-ucr-resolver-alpha', 'fx-user-resolver', 'fx-company-alpha', 'account_manager', now()),
  ('fx-ucr-target-a-alpha', 'fx-user-target-a', 'fx-company-alpha', 'account_manager', now()),
  ('fx-ucr-email-match-alpha', 'fx-user-email-match', 'fx-company-alpha', 'account_manager', now()),
  ('fx-ucr-target-b-alpha', 'fx-user-target-b', 'fx-company-alpha', 'account_manager', now()),
  ('fx-ucr-dual-alpha', 'fx-user-dual', 'fx-company-alpha', 'account_manager', now()),
  ('fx-ucr-dual-beta', 'fx-user-dual', 'fx-company-beta', 'account_manager', now()),
  ('fx-ucr-dual-target-alpha', 'fx-user-dual-target', 'fx-company-alpha', 'account_manager', now()),
  ('fx-ucr-dual-target-beta', 'fx-user-dual-target', 'fx-company-beta', 'account_manager', now());

INSERT INTO projects (id, slug, name, description, company_id, created_at, updated_at) VALUES
  ('fx-project-resolved', 'fx-project-resolved', 'Fixture Resolved Project', NULL, 'fx-company-alpha', now(), now()),
  ('fx-project-ambiguous', 'fx-project-ambiguous', 'Fixture Ambiguous Project', NULL, 'fx-company-alpha', now(), now()),
  ('fx-project-unmatched', 'fx-project-unmatched', 'Fixture Unmatched Project', NULL, 'fx-company-alpha', now(), now());

INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES
  ('fx-pm-resolved', 'fx-project-resolved', 'fx-user-resolver', 'member', now()),
  ('fx-pm-ambiguous', 'fx-project-ambiguous', 'fx-user-dual', 'member', now());

INSERT INTO role_change_requests (id, user_id, from_role, to_role, status, requested_by, approved_by, company_id, created_at) VALUES
  ('fx-rcr-id-resolved', 'fx-user-target-a', 'member', 'admin', 'pending', 'fx-user-resolver', NULL, 'fx-company-alpha', now()),
  ('fx-rcr-email-resolved', 'fx-user-target-b', 'member', 'admin', 'pending', 'emailmatch@fixture.example.com', NULL, 'fx-company-alpha', now()),
  ('fx-rcr-cross-ambiguous', 'fx-user-target-a', 'member', 'admin', 'pending', 'fx-user-cross-a', NULL, 'fx-company-alpha', now()),
  ('fx-rcr-company-ambiguous', 'fx-user-dual-target', 'member', 'admin', 'pending', 'fx-user-dual', NULL, 'fx-company-alpha', now()),
  ('fx-rcr-unmatched-nomembership', 'fx-user-target-a', 'member', 'admin', 'pending', 'fx-user-nomembership', NULL, 'fx-company-alpha', now()),
  ('fx-rcr-unmatched-nearmiss', 'fx-user-target-a', 'member', 'admin', 'pending', ' RESOLVER@fixture.example.com ', NULL, 'fx-company-alpha', now());
`;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u011it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(REPO_ROOT, 'tmp/u011-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

describe.skipIf(!integration)('scope-backfill DB-touching layer (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U011', purpose: 'scope-backfill-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
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

    for (const statement of SCOPE_BACKFILL_CONTRACT_FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await prisma.$executeRawUnsafe(`${trimmed};`);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  it('sqlJsonDigestHex produces a stable lowercase sha256 regardless of JS key order', async () => {
    const client = prisma as unknown as DigestClient;
    const h1 = await sqlJsonDigestHex(client, { a: 1, b: 2 });
    const h2 = await sqlJsonDigestHex(client, { b: 2, a: 1 });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it('fetchRequesterKeySets finds an exact byte-equal ID match and rejects a case/whitespace near-miss', async () => {
    const client = prisma as unknown as DigestClient;
    const exact = await fetchRequesterKeySets(client, 'fx-user-resolver');
    expect(exact.idUserIds).toEqual(['fx-user-resolver']);
    expect(exact.emailUserIds).toEqual([]);

    const nearMiss = await fetchRequesterKeySets(client, ' RESOLVER@fixture.example.com ');
    expect(nearMiss.idUserIds).toEqual([]);
    expect(nearMiss.emailUserIds).toEqual([]);
  });

  it('fetchUserExists is true for a live user and false for an unknown id', async () => {
    const client = prisma as unknown as DigestClient;
    expect(await fetchUserExists(client, 'fx-user-resolver')).toBe(true);
    expect(await fetchUserExists(client, 'no-such-user')).toBe(false);
  });

  it('fetchUserCompanyMembership returns the real UserCompanyRole company set for a dual-membership user', async () => {
    const client = prisma as unknown as DigestClient;
    const membership = await fetchUserCompanyMembership(client, 'fx-user-dual');
    expect(membership.companyIds.sort()).toEqual(['fx-company-alpha', 'fx-company-beta']);
    expect(membership.missingParentFacts).toBe(false);
  });

  it('fetchRoleChangeScopeFacts + classifyRoleChangeCompanyScope resolves the ID-match fixture row against real Postgres', async () => {
    const client = prisma as unknown as DigestClient;
    const live = await fetchRoleChangeRequestLiveRow(client, 'fx-rcr-id-resolved');
    expect(live).not.toBeNull();
    const facts = await fetchRoleChangeScopeFacts(client, live!);
    const decision = classifyRoleChangeCompanyScope(facts);
    expect(decision.classification).toBe('resolved');
    expect(decision.candidateCompanyIds).toEqual(['fx-company-alpha']);
  });

  it('fetchRoleChangeScopeFacts + classifyRoleChangeCompanyScope classifies the cross-key fixture row as ambiguous against real Postgres', async () => {
    const client = prisma as unknown as DigestClient;
    const live = await fetchRoleChangeRequestLiveRow(client, 'fx-rcr-cross-ambiguous');
    const facts = await fetchRoleChangeScopeFacts(client, live!);
    const decision = classifyRoleChangeCompanyScope(facts);
    expect(decision.classification).toBe('ambiguous');
    expect(decision.reasonCode).toBe('scope_requester_ambiguous');
  });

  it('the RoleChangeRequest row envelope built from live Postgres data round-trips losslessly', async () => {
    const client = prisma as unknown as DigestClient;
    const columnTypes = await fetchRoleChangeRequestColumnTypes(client);
    const live = await fetchRoleChangeRequestLiveRow(client, 'fx-rcr-id-resolved');
    const envelope = buildRoleChangeRequestRowEnvelope(columnTypes, live as unknown as Record<string, string | null>);
    const check = verifyRoleChangeRequestRowEnvelopeRoundTrip(envelope, live as unknown as Record<string, string | null>);
    expect(check).toEqual({ ok: true, mismatches: [] });

    const rehash = await sqlJsonDigestHex(client, envelope);
    expect(rehash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fetchProjectScopeFacts + classifyProjectCompanyScope resolves the single-member fixture Project against real Postgres', async () => {
    const client = prisma as unknown as DigestClient;
    const { facts } = await fetchProjectScopeFacts(client, 'fx-project-resolved');
    const decision = classifyProjectCompanyScope(facts);
    expect(decision).toEqual({ classification: 'resolved', candidateCompanyIds: ['fx-company-alpha'] });
  });

  it('fetchProjectScopeFacts + classifyProjectCompanyScope classifies the dual-membership fixture Project as ambiguous', async () => {
    const client = prisma as unknown as DigestClient;
    const { facts } = await fetchProjectScopeFacts(client, 'fx-project-ambiguous');
    const decision = classifyProjectCompanyScope(facts);
    expect(decision.classification).toBe('ambiguous');
    expect(decision.candidateCompanyIds.sort()).toEqual(['fx-company-alpha', 'fx-company-beta']);
  });

  it('fetchProjectScopeFacts + classifyProjectCompanyScope classifies the no-member fixture Project as unmatched', async () => {
    const client = prisma as unknown as DigestClient;
    const { facts } = await fetchProjectScopeFacts(client, 'fx-project-unmatched');
    const decision = classifyProjectCompanyScope(facts);
    expect(decision).toEqual({ classification: 'unmatched', candidateCompanyIds: [] });
  });

  it('pgcrypto is installed in the public schema (required by the migration before any quarantine digest)', async () => {
    const client = prisma as unknown as DigestClient;
    const rows = await client.$queryRawUnsafe<{ extname: string; nspname: string }[]>(
      `SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto'`,
    );
    expect(rows).toEqual([{ extname: 'pgcrypto', nspname: 'public' }]);
  });
});
