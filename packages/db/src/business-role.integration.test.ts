import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

const integration = process.env.CI_INTEGRATION === '1';

const BUSINESS_ROLE_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('u015it-tenant-1', 'U015 IT Tenant', 'u015it-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u015it-company-1', 'u015it-tenant-1', 'U015 IT Company', 'u015it-company-1', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u015it-project-1', 'u015it-project-1', 'U015 IT Project', 'u015it-company-1', now(), now());

INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u015it-user-active', 'active@u015it.example.com', 'Active', 'active', now(), now()),
  ('u015it-user-assigned', 'assigned@u015it.example.com', 'Assigned', 'active', now(), now()),
  ('u015it-user-unassigned', 'unassigned@u015it.example.com', 'Unassigned', 'active', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u015it-ucr-assigned', 'u015it-user-assigned', 'u015it-company-1', 'account_manager', 'active', now(), now()),
  ('u015it-ucr-unassigned', 'u015it-user-unassigned', 'u015it-company-1', 'account_manager', 'active', now(), now());

INSERT INTO project_members (id, project_id, user_id, role, status, valid_from, created_at) VALUES
  ('u015it-pm-assigned', 'u015it-project-1', 'u015it-user-assigned', 'member', 'active', now(), now());
`;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u015it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(REPO_ROOT, 'tmp/u015-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

describe.skipIf(!integration)('business-role DB-touching layer (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U015', purpose: 'business-role-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
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

    for (const statement of BUSINESS_ROLE_FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await prisma.$executeRawUnsafe(`${trimmed};`);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  it('the real Prisma client returns the fixture UserCompanyRole row with its lifecycle columns intact', async () => {
    const row = await prisma!.userCompanyRole.findUnique({ where: { id: 'u015it-ucr-assigned' } });
    expect(row).toMatchObject({ role: 'account_manager', status: 'active', revokedAt: null });
    expect(row?.validFrom).not.toBeNull();
  });

  it('a user with no UserCompanyRole row in this company returns an empty set via the real client', async () => {
    const rows = await prisma!.userCompanyRole.findMany({ where: { userId: 'u015it-user-active', companyId: 'u015it-company-1' } });
    expect(rows).toEqual([]);
  });

  it('the assigned fixture user has a real, active ProjectMember row for the fixture project', async () => {
    const membership = await prisma!.projectMember.findUnique({
      where: { projectId_userId: { projectId: 'u015it-project-1', userId: 'u015it-user-assigned' } },
    });
    expect(membership).toMatchObject({ status: 'active', revokedAt: null });
  });

  it('the unassigned fixture user has no ProjectMember row for the fixture project', async () => {
    const membership = await prisma!.projectMember.findUnique({
      where: { projectId_userId: { projectId: 'u015it-project-1', userId: 'u015it-user-unassigned' } },
    });
    expect(membership).toBeNull();
  });

  it('user_company_roles_role_ten_codes_for_new_rows_check rejects a fresh out-of-policy role via the real Prisma client', async () => {
    await expect(
      prisma!.userCompanyRole.create({
        data: { id: 'u015it-ucr-bad', userId: 'u015it-user-active', companyId: 'u015it-company-1', role: 'member', status: 'legacy_pending' },
      }),
    ).rejects.toThrow();
  });

  it('a canonical role string is accepted via the real Prisma client', async () => {
    const created = await prisma!.userCompanyRole.create({
      data: { id: 'u015it-ucr-good', userId: 'u015it-user-active', companyId: 'u015it-company-1', role: 'ceo', status: 'legacy_pending' },
    });
    expect(created.role).toBe('ceo');
  });

  it('user_company_roles_status_lifecycle_check rejects active with revokedAt set via the real Prisma client', async () => {
    await expect(
      prisma!.userCompanyRole.create({
        data: {
          id: 'u015it-ucr-bad-active',
          userId: 'u015it-user-active',
          companyId: 'u015it-company-1',
          role: 'security_officer',
          status: 'active',
          revokedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
