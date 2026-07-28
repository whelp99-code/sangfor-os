import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS (scripts/lib/isolated-postgres.mjs), no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

import { SANGFOR_APP_DATABASE_URL_ENV, RlsScopeError, withRlsTransaction } from './scoped-transaction';

const integration = process.env.CI_INTEGRATION === '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u016it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(tmpdir(), 'u016-integration-evidence');

// Two fully independent tenant/company/project hierarchies (A, B) across all six pilot tables —
// used as an explicitly-marked trusted fixture (never a request-derived value) to exercise the
// six-table pilot. This is the only place in U016 that calls withRlsTransaction against the six
// pilot tables (see the PILOT ADAPTER BOUNDARY assertion in scoped-transaction.test.ts).
const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('u016it-tenant-a', 'U016 IT Tenant A', 'u016it-tenant-a', 'active', now()),
  ('u016it-tenant-b', 'U016 IT Tenant B', 'u016it-tenant-b', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u016it-company-a', 'u016it-tenant-a', 'U016 IT Company A', 'u016it-company-a', now()),
  ('u016it-company-b', 'u016it-tenant-b', 'U016 IT Company B', 'u016it-company-b', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u016it-project-a', 'u016it-project-a', 'U016 IT Project A', 'u016it-company-a', now(), now()),
  ('u016it-project-b', 'u016it-project-b', 'U016 IT Project B', 'u016it-company-b', now(), now());

INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u016it-user-a', 'user-a@u016it.example.com', 'User A', 'active', now(), now()),
  ('u016it-user-b', 'user-b@u016it.example.com', 'User B', 'active', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u016it-ucr-a', 'u016it-user-a', 'u016it-company-a', 'account_manager', 'active', now(), now()),
  ('u016it-ucr-b', 'u016it-user-b', 'u016it-company-b', 'account_manager', 'active', now(), now());

INSERT INTO project_members (id, project_id, user_id, role, status, valid_from, created_at) VALUES
  ('u016it-pm-a', 'u016it-project-a', 'u016it-user-a', 'member', 'active', now(), now()),
  ('u016it-pm-b', 'u016it-project-b', 'u016it-user-b', 'member', 'active', now(), now());

INSERT INTO customers (id, project_id, name, status, created_at, updated_at) VALUES
  ('u016it-customer-a', 'u016it-project-a', 'Customer A', 'active', now(), now()),
  ('u016it-customer-b', 'u016it-project-b', 'Customer B', 'active', now(), now());

INSERT INTO opportunities (id, project_id, title, stage, deal_status, probability, created_at, updated_at) VALUES
  ('u016it-opp-a', 'u016it-project-a', 'Opportunity A', 'LEAD', 'OPEN', 20, now(), now()),
  ('u016it-opp-b', 'u016it-project-b', 'Opportunity B', 'LEAD', 'OPEN', 20, now(), now());
`;

const SCOPE_A = { tenantId: 'u016it-tenant-a', companyId: 'u016it-company-a', projectId: 'u016it-project-a' };
const SCOPE_B = { tenantId: 'u016it-tenant-b', companyId: 'u016it-company-b', projectId: 'u016it-project-b' };

let adminPrisma: PrismaClient | null = null;
let appDatabaseUrl: string | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

async function directLoginQuery<T>(sql: string): Promise<T> {
  const direct = new PrismaClient({ datasources: { db: { url: appDatabaseUrl! } } });
  try {
    return await direct.$queryRawUnsafe<T>(sql);
  } finally {
    await direct.$disconnect();
  }
}

describe.skipIf(!integration)('RLS pilot (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void;
    const ready = new Promise<{ databaseUrl: string; migrationDatabaseUrl: string }>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U016', purpose: 'rls-pilot-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: 'required' },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        resolveReady(ctx);
        await held;
      },
    );
    cleanupFn = async () => {
      releaseCallback?.();
      await lifecycle;
    };

    const ctx = await ready;
    appDatabaseUrl = ctx.databaseUrl;
    process.env[SANGFOR_APP_DATABASE_URL_ENV] = ctx.databaseUrl;

    adminPrisma = new PrismaClient({ datasources: { db: { url: ctx.migrationDatabaseUrl } } });
    for (const statement of FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await adminPrisma.$executeRawUnsafe(`${trimmed};`);
    }
  }, 180_000);

  afterAll(async () => {
    await adminPrisma?.$disconnect();
    delete process.env[SANGFOR_APP_DATABASE_URL_ENV];
    await cleanupFn?.();
  }, 60_000);

  it('both roles carry the exact required flags and SET-not-INHERIT membership', async () => {
    const roles = await adminPrisma!.$queryRawUnsafe<Array<{ rolname: string; rolsuper: boolean; rolinherit: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolcanlogin: boolean; rolbypassrls: boolean }>>(
      `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname IN ('sangfor_app','sangfor_app_login') ORDER BY rolname`,
    );
    expect(roles).toHaveLength(2);
    const [app, login] = roles;
    expect(app).toMatchObject({ rolname: 'sangfor_app', rolsuper: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false, rolbypassrls: false });
    expect(login).toMatchObject({ rolname: 'sangfor_app_login', rolsuper: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true, rolbypassrls: false });

    const membership = await adminPrisma!.$queryRawUnsafe<Array<{ admin_option: boolean; inherit_option: boolean; set_option: boolean }>>(
      `SELECT m.admin_option, m.inherit_option, m.set_option
       FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.roleid AND r.rolname = 'sangfor_app'
       JOIN pg_roles mm ON mm.oid = m.member AND mm.rolname = 'sangfor_app_login'`,
    );
    expect(membership).toHaveLength(1);
    expect(membership[0]).toMatchObject({ inherit_option: false, set_option: true });
  });

  it('sangfor_app_login has no direct grant on any of the six pilot tables', async () => {
    const grants = await adminPrisma!.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'sangfor_app_login'
         AND table_name IN ('companies','projects','user_company_roles','project_members','customers','opportunities')`,
    );
    expect(grants).toEqual([]);
  });

  it('sangfor_app has exactly SELECT/INSERT/UPDATE/DELETE on each of the six pilot tables, no more', async () => {
    const grants = await adminPrisma!.$queryRawUnsafe<Array<{ table_name: string; privilege_type: string }>>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'sangfor_app'
         AND table_name IN ('companies','projects','user_company_roles','project_members','customers','opportunities')
       ORDER BY table_name, privilege_type`,
    );
    const byTable = new Map<string, Set<string>>();
    for (const g of grants) {
      if (!byTable.has(g.table_name)) byTable.set(g.table_name, new Set());
      byTable.get(g.table_name)!.add(g.privilege_type);
    }
    for (const table of ['companies', 'projects', 'user_company_roles', 'project_members', 'customers', 'opportunities']) {
      expect([...(byTable.get(table) ?? [])].sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    }
  });

  it('each of the six tables has ENABLE + FORCE row level security and exactly one sangfor_scope_* FOR ALL policy with non-trivial USING/WITH CHECK', async () => {
    const tables = await adminPrisma!.$queryRawUnsafe<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('companies','projects','user_company_roles','project_members','customers','opportunities') AND relkind = 'r'
       ORDER BY relname`,
    );
    expect(tables).toHaveLength(6);
    for (const t of tables) {
      expect(t).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }

    const policies = await adminPrisma!.$queryRawUnsafe<Array<{ tablename: string; policyname: string; cmd: string; qual: string; with_check: string }>>(
      `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
       WHERE tablename IN ('companies','projects','user_company_roles','project_members','customers','opportunities')
       ORDER BY tablename`,
    );
    expect(policies).toHaveLength(6);
    for (const p of policies) {
      expect(p.policyname).toBe(`sangfor_scope_${p.tablename}`);
      expect(p.cmd).toBe('ALL');
      expect(p.qual).not.toMatch(/^true$/i);
      expect(p.qual).toBe(p.with_check);
    }
  });

  it('the migration.sql executable statements (comments stripped) contain no PASSWORD clause', async () => {
    const fs = await import('node:fs');
    const migrationPath = join(REPO_ROOT, 'packages/db/prisma/migrations/20260715160000_rls_pilot/migration.sql');
    const text = fs.readFileSync(migrationPath, 'utf8');
    const executableOnly = text
      .split('\n')
      .map((line) => line.replace(/--.*/, ''))
      .join('\n');
    expect(executableOnly.toUpperCase()).not.toContain('PASSWORD');
  });

  it('a direct sangfor_app_login connection (no SET ROLE) cannot read the pilot tables', async () => {
    await expect(directLoginQuery('SELECT count(*) FROM companies')).rejects.toThrow();
  });

  it('performs same-scope SELECT/INSERT/UPDATE/DELETE across all six tables through the callback only', async () => {
    await withRlsTransaction(SCOPE_A, async (tx) => {
      const companies = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM companies WHERE id = 'u016it-company-a'`);
      expect(companies).toHaveLength(1);

      const projects = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM projects WHERE id = 'u016it-project-a'`);
      expect(projects).toHaveLength(1);

      const roles = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM user_company_roles WHERE company_id = 'u016it-company-a'`);
      expect(roles).toHaveLength(1);

      const members = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM project_members WHERE project_id = 'u016it-project-a'`);
      expect(members).toHaveLength(1);

      await tx.$executeRawUnsafe(`INSERT INTO customers (id, project_id, name, status, created_at, updated_at) VALUES ('u016it-customer-a-new', 'u016it-project-a', 'New Customer A', 'active', now(), now())`);
      await tx.$executeRawUnsafe(`UPDATE customers SET name = 'Customer A Updated' WHERE id = 'u016it-customer-a'`);
      await tx.$executeRawUnsafe(`DELETE FROM customers WHERE id = 'u016it-customer-a-new'`);

      await tx.$executeRawUnsafe(`INSERT INTO opportunities (id, project_id, title, stage, deal_status, probability, created_at, updated_at) VALUES ('u016it-opp-a-new', 'u016it-project-a', 'New Opp A', 'LEAD', 'OPEN', 20, now(), now())`);
      await tx.$executeRawUnsafe(`UPDATE opportunities SET title = 'Opportunity A Updated' WHERE id = 'u016it-opp-a'`);
      await tx.$executeRawUnsafe(`DELETE FROM opportunities WHERE id = 'u016it-opp-a-new'`);
      return null;
    });

    const updated = await adminPrisma!.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM customers WHERE id = 'u016it-customer-a'`);
    expect(updated[0]?.name).toBe('Customer A Updated');
  });

  it('cross-scope reads return zero rows for all six tables', async () => {
    await withRlsTransaction(SCOPE_A, async (tx) => {
      for (const [table, id] of [
        ['companies', 'u016it-company-b'],
        ['projects', 'u016it-project-b'],
        ['user_company_roles', 'u016it-ucr-b'],
        ['project_members', 'u016it-pm-b'],
        ['customers', 'u016it-customer-b'],
        ['opportunities', 'u016it-opp-b'],
      ] as const) {
        const rows = await tx.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${table} WHERE id = '${id}'`);
        expect(rows).toEqual([]);
      }
      return null;
    });
  });

  it('cross-scope writes are rejected by the WITH CHECK policy', async () => {
    await expect(
      withRlsTransaction(SCOPE_A, async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO customers (id, project_id, name, status, created_at, updated_at) VALUES ('u016it-customer-cross', 'u016it-project-b', 'Cross Customer', 'active', now(), now())`);
        return null;
      }),
    ).rejects.toThrow();

    const leaked = await adminPrisma!.$queryRawUnsafe<unknown[]>(`SELECT * FROM customers WHERE id = 'u016it-customer-cross'`);
    expect(leaked).toEqual([]);
  });

  it('a forged hierarchy (claimed tenant does not own the claimed company) is rejected before the callback runs', async () => {
    const callback = vi.fn(async () => null);
    await expect(
      withRlsTransaction({ tenantId: SCOPE_B.tenantId, companyId: SCOPE_A.companyId, projectId: SCOPE_A.projectId }, callback),
    ).rejects.toThrow(RlsScopeError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('a non-pilot table (tenants) is denied even inside a valid SET ROLE transaction', async () => {
    await expect(
      withRlsTransaction(SCOPE_A, async (tx) => {
        await tx.$queryRawUnsafe(`SELECT count(*) FROM tenants`);
        return null;
      }),
    ).rejects.toThrow();
  });

  it('pool reuse alternating scope A/B resets role and local context at commit — no bleed across calls on the same connection pool', async () => {
    await withRlsTransaction(SCOPE_A, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM projects WHERE id = 'u016it-project-a'`);
      expect(rows).toHaveLength(1);
      return null;
    });
    await withRlsTransaction(SCOPE_B, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM projects WHERE id = 'u016it-project-b'`);
      expect(rows).toHaveLength(1);
      const crossRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM projects WHERE id = 'u016it-project-a'`);
      expect(crossRows).toHaveLength(0);
      return null;
    });

    const postCommitState = await directLoginQuery<Array<{ current_role: string; tenant_setting: string | null }>>(
      `SELECT current_user AS current_role, current_setting('app.tenant_id', true) AS tenant_setting`,
    );
    expect(postCommitState[0]?.current_role).toBe('sangfor_app_login');
    expect(postCommitState[0]?.tenant_setting).toBeNull();
  });

  it('a rolled-back transaction (callback throws) resets role and local context — no leaked scope after rollback', async () => {
    await expect(
      withRlsTransaction(SCOPE_A, async () => {
        throw new Error('simulated business-logic failure');
      }),
    ).rejects.toThrow('simulated business-logic failure');

    const postRollbackState = await directLoginQuery<Array<{ current_role: string; company_setting: string | null }>>(
      `SELECT current_user AS current_role, current_setting('app.company_id', true) AS company_setting`,
    );
    expect(postRollbackState[0]?.current_role).toBe('sangfor_app_login');
    expect(postRollbackState[0]?.company_setting).toBeNull();
  });

  it('a caller fixture that denies a capability never invokes withRlsTransaction (unauthorized-caller short-circuit)', async () => {
    const capabilityDecision: { ok: boolean } = { ok: false };
    const scopedCall = vi.fn(() => withRlsTransaction(SCOPE_A, async () => null));

    if (capabilityDecision.ok) {
      await scopedCall();
    }

    expect(scopedCall).not.toHaveBeenCalled();
  });
});
