import express, { type Express } from 'express';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  userCompanyRoleFindMany: vi.fn(),
  projectMemberFindUnique: vi.fn(),
}));

vi.mock('@sangfor/db', () => ({
  prisma: {
    userCompanyRole: { findMany: prismaMocks.userCompanyRoleFindMany },
    projectMember: { findUnique: prismaMocks.projectMemberFindUnique },
  },
}));

import { resolveBusinessAuthorizationFromDb, requireBusinessCapability } from './business-authorization';
import type { AuthContext } from '@sangfor/auth';

const NOW = new Date('2026-07-15T14:00:00.000Z');

function companyRole(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ucr-1',
    userId: 'user-1',
    companyId: 'company-1',
    role: 'sales_manager',
    status: 'active',
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function baseAuthContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    businessRole: 'account_manager',
    permissions: [],
    ...overrides,
  };
}

async function requestProbe(app: Express): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new TypeError('Expected an ephemeral TCP listener');
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/probe`, { headers: { connection: 'close' } });
    const body = await response.json().catch(() => undefined);
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.userCompanyRoleFindMany.mockResolvedValue([]);
  prismaMocks.projectMemberFindUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveBusinessAuthorizationFromDb — RED characterization', () => {
  it('denies zero active company roles', async () => {
    const result = await resolveBusinessAuthorizationFromDb('user-1', 'company-1', NOW);
    expect(result).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
  });

  it('denies multiple simultaneously active company roles', async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([
      companyRole({ id: 'a', role: 'account_manager' }),
      companyRole({ id: 'b', role: 'ceo' }),
    ]);
    const result = await resolveBusinessAuthorizationFromDb('user-1', 'company-1', NOW);
    expect(result).toEqual({ ok: false, reason: 'MULTIPLE_ACTIVE_ROLES' });
  });

  it.each(['legacy_pending' as const, null, 'revoked' as const, 'expired' as const])(
    'denies a %s company role',
    async (status) => {
      prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ status, revokedAt: status === 'revoked' ? NOW : null })]);
      const result = await resolveBusinessAuthorizationFromDb('user-1', 'company-1', NOW);
      expect(result).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
    },
  );

  it('resolves the sole active role and its permissions', async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'finance_manager' })]);
    const result = await resolveBusinessAuthorizationFromDb('user-1', 'company-1', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('finance_manager');
      expect(result.permissions).toContain('finance.approve_margin');
    }
  });

  it('scopes strictly to the given companyId, never a role from a different company', async () => {
    prismaMocks.userCompanyRoleFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === 'company-1' ? [] : [companyRole({ companyId: 'company-2' })],
    );
    const result = await resolveBusinessAuthorizationFromDb('user-1', 'company-1', NOW);
    expect(result).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
  });
});

function buildApp(permission?: Parameters<typeof requireBusinessCapability>[0], seedContext: AuthContext | null = baseAuthContext()) {
  const app = express();
  app.use((req, _res, next) => {
    if (seedContext) req.authContext = seedContext;
    if (seedContext) {
      req.user = { id: seedContext.userId, email: seedContext.userId, role: seedContext.businessRole, authContext: seedContext };
    }
    next();
  });
  app.use(requireBusinessCapability(permission));
  app.get('/probe', (req, res) => {
    res.json({ businessRole: req.authContext?.businessRole, permissions: req.authContext?.permissions });
  });
  return app;
}

describe('requireBusinessCapability — Express middleware, RED characterization', () => {
  it('returns 401 when no authContext was attached by an earlier auth step', async () => {
    const app = buildApp(undefined, null);
    const result = await requestProbe(app);
    expect(result.status).toBe(401);
    expect(prismaMocks.userCompanyRoleFindMany).not.toHaveBeenCalled();
  });

  it('returns 403 and never trusts the token-supplied businessRole when there is no active DB role (forged token role has no effect)', async () => {
    const app = buildApp(undefined, baseAuthContext({ businessRole: 'system_admin', permissions: ['system.admin'] }));
    const result = await requestProbe(app);
    expect(result.status).toBe(403);
  });

  it('overwrites req.authContext.businessRole/permissions with the DB-resolved role, ignoring the token-supplied one', async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'finance_manager' })]);
    const app = buildApp(undefined, baseAuthContext({ businessRole: 'system_admin', permissions: ['system.admin'] }));
    const result = await requestProbe(app);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ businessRole: 'finance_manager' });
    expect((result.body as { permissions: string[] }).permissions).toContain('finance.approve_margin');
    expect((result.body as { permissions: string[] }).permissions).not.toContain('system.admin');
  });

  it('returns 403 when the DB-resolved role lacks the required permission', async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'support_engineer' })]);
    const app = buildApp('finance.write', baseAuthContext());
    const result = await requestProbe(app);
    expect(result.status).toBe(403);
  });

  it('returns 200 when the DB-resolved role carries the required permission', async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'finance_manager' })]);
    const app = buildApp('finance.write', baseAuthContext());
    const result = await requestProbe(app);
    expect(result.status).toBe(200);
  });
});

describe('U015 P3 real-surface QA evidence — apps/api Express ephemeral HTTP, U013 protocol', () => {
  const evidenceDir = process.env.U015_EVIDENCE_DIR;

  it('captures assigned/unassigned account manager, finance manager, and system admin over real HTTP', async () => {
    if (!evidenceDir) return;
    const results: Record<string, unknown> = {};

    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'sales_manager' })]);
    const assignedApp = buildApp('opportunity.write', baseAuthContext());
    const assignedResult = await requestProbe(assignedApp);
    results.assignedAccountManagerCompanyScoped = { status: assignedResult.status };

    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([]);
    const unassignedApp = buildApp('opportunity.write', baseAuthContext());
    const unassignedResult = await requestProbe(unassignedApp);
    results.unassignedAccountManagerNoActiveRole = { status: unassignedResult.status };

    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'finance_manager' })]);
    const financeApp = buildApp('finance.write', baseAuthContext());
    const financeResult = await requestProbe(financeApp);
    results.financeManagerFinanceCapability = { status: financeResult.status };

    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: 'system_admin' })]);
    const adminApp = buildApp('system.admin', baseAuthContext());
    const adminResult = await requestProbe(adminApp);
    results.systemAdminSystemCapability = { status: adminResult.status };

    const { readFileSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const matrixPath = join(evidenceDir, 'authz-http-matrix.json');
    const existing = JSON.parse(readFileSync(matrixPath, 'utf8'));
    existing.apiResults = {
      scope: 'apps/api real Express HTTP over an ephemeral 127.0.0.1:0 listener (U013 protocol) through requireBusinessCapability, DB-recomputed role via mocked Prisma (same harness as this file\'s other passing tests)',
      results,
    };
    writeFileSync(matrixPath, `${JSON.stringify(existing, null, 2)}\n`);

    expect(assignedResult.status).toBe(200);
    expect(unassignedResult.status).toBe(403);
    expect(financeResult.status).toBe(200);
    expect(adminResult.status).toBe(200);
  });
});
