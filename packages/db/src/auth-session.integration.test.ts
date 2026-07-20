import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

const integration = process.env.CI_INTEGRATION === '1';

const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-as-tenant-1', 'Fixture Tenant', 'fx-as-tenant-1', 'active', now()),
  ('fx-as-tenant-2', 'Fixture Tenant Two', 'fx-as-tenant-2', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-as-company-1', 'fx-as-tenant-1', 'Company One', 'fx-as-company-1', now()),
  ('fx-as-company-2', 'fx-as-tenant-2', 'Company Two', 'fx-as-company-2', now());

INSERT INTO projects (id, slug, name, description, company_id, created_at, updated_at) VALUES
  ('fx-as-project-1', 'fx-as-project-1', 'Fixture Project', NULL, 'fx-as-company-1', now(), now());
`;

const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u014it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(tmpdir(), 'u014-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

describe.skipIf(!integration)('AuthSession/User lifecycle DB-touching layer (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U014', purpose: 'principal-session-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
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

    for (const statement of FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await prisma.$executeRawUnsafe(`${trimmed};`);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  it('a User row created without an explicit status defaults to legacy_pending, never active — the migration never blanket-activates', async () => {
    const client = prisma!;
    const user = await client.user.create({
      data: { id: 'fx-as-user-omitted-status', email: 'omitted@fixture.example.com', name: 'Omitted Status' },
    });
    expect(user.status).toBe('legacy_pending');
    expect(user.disabledAt).toBeNull();
  });

  it('the seed-equivalent explicit active write is accepted with disabledAt NULL', async () => {
    const client = prisma!;
    const user = await client.user.create({
      data: { id: 'fx-as-user-active', email: 'active@fixture.example.com', name: 'Active', status: 'active' },
    });
    expect(user.status).toBe('active');
  });

  it('rejects status=active with a non-null disabledAt at the DB layer (named CHECK)', async () => {
    const client = prisma!;
    await expect(
      client.$executeRawUnsafe(
        `INSERT INTO users (id, email, name, status, disabled_at, created_at, updated_at) VALUES ('fx-as-user-bad-active', 'bad-active@fixture.example.com', 'Bad Active', 'active', now(), now(), now());`,
      ),
    ).rejects.toThrow();
  });

  it('rejects status=disabled with a null disabledAt at the DB layer (named CHECK)', async () => {
    const client = prisma!;
    await expect(
      client.$executeRawUnsafe(
        `INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES ('fx-as-user-bad-disabled', 'bad-disabled@fixture.example.com', 'Bad Disabled', 'disabled', now(), now());`,
      ),
    ).rejects.toThrow();
  });

  it('creates an AuthSession row keyed by jti with no raw-JWT column anywhere on the table', async () => {
    const client = prisma!;
    const columns = await client.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'auth_sessions';`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'user_id', 'tenant_id', 'company_id', 'project_id', 'issued_at', 'expires_at', 'revoked_at', 'mfa_verified_at', 'mfa_method']),
    );
    expect(names.some((n) => /token|jwt/i.test(n))).toBe(false);

    const session = await client.authSession.create({
      data: {
        id: 'fx-as-jti-1',
        userId: 'fx-as-user-active',
        tenantId: 'fx-as-tenant-1',
        companyId: 'fx-as-company-1',
        projectId: 'fx-as-project-1',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    expect(session.id).toBe('fx-as-jti-1');
    expect(session.revokedAt).toBeNull();
  });

  it('rejects an AuthSession whose companyId does not actually belong to its tenantId (composite FK)', async () => {
    const client = prisma!;
    await expect(
      client.authSession.create({
        data: {
          id: 'fx-as-jti-cross-tenant',
          userId: 'fx-as-user-active',
          tenantId: 'fx-as-tenant-2',
          companyId: 'fx-as-company-1',
          projectId: 'fx-as-project-1',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 900_000),
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects an AuthSession whose projectId does not actually belong to its companyId (composite FK)', async () => {
    const client = prisma!;
    await expect(
      client.authSession.create({
        data: {
          id: 'fx-as-jti-cross-company',
          userId: 'fx-as-user-active',
          tenantId: 'fx-as-tenant-2',
          companyId: 'fx-as-company-2',
          projectId: 'fx-as-project-1',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 900_000),
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('compare-and-set revoke is idempotent: a second revoke on an already-revoked row matches zero rows', async () => {
    const client = prisma!;
    await client.authSession.create({
      data: {
        id: 'fx-as-jti-revoke',
        userId: 'fx-as-user-active',
        tenantId: 'fx-as-tenant-1',
        companyId: 'fx-as-company-1',
        projectId: 'fx-as-project-1',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
      },
    });

    const first = await client.authSession.updateMany({ where: { id: 'fx-as-jti-revoke', revokedAt: null }, data: { revokedAt: new Date() } });
    expect(first.count).toBe(1);

    const second = await client.authSession.updateMany({ where: { id: 'fx-as-jti-revoke', revokedAt: null }, data: { revokedAt: new Date() } });
    expect(second.count).toBe(0);
  });

  it('directly disabling the fixture user denies nothing by itself at the DB layer (enforcement is evaluateSession\'s job) but the row is durably updated for the next persisted-session read', async () => {
    const client = prisma!;
    await client.user.update({ where: { id: 'fx-as-user-active' }, data: { status: 'disabled', disabledAt: new Date(), disabledReason: 'integration test' } });
    const reread = await client.user.findUniqueOrThrow({ where: { id: 'fx-as-user-active' } });
    expect(reread.status).toBe('disabled');
    expect(reread.disabledAt).not.toBeNull();
  });
});
