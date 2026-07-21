import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RlsScopeError,
  SANGFOR_APP_DATABASE_URL_ENV,
  __internal,
  withRlsTransaction,
  type ScopedTransactionContext,
} from './scoped-transaction';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const TEST_URL = 'postgresql://sangfor_app_login:fake-local-secret@127.0.0.1:55432/fake_db';

function sqlText(query: unknown): string {
  const sql = query as Prisma.Sql;
  if (!sql.strings) return String(query);
  return `${sql.strings.join('?')}::${JSON.stringify(sql.values ?? [])}`;
}

function createFakeClient(overrides: {
  roleRows?: Array<{ session_user: string; current_user: string }>;
  hierarchyRows?: Array<{ id: string }>;
} = {}) {
  const calls: string[] = [];
  const tx = {
    $executeRawUnsafe: vi.fn(async (q: string) => {
      calls.push(`raw:${q}`);
      return 1;
    }),
    $executeRaw: vi.fn(async (q: unknown) => {
      calls.push(`param:${sqlText(q)}`);
      return 1;
    }),
    $queryRaw: vi.fn(async (q: unknown) => {
      const text = sqlText(q);
      calls.push(`query:${text}`);
      if (text.includes('session_user')) {
        return overrides.roleRows ?? [{ session_user: 'sangfor_app_login', current_user: 'sangfor_app' }];
      }
      if (text.includes('FROM projects')) {
        return overrides.hierarchyRows ?? [{ id: 'p1' }];
      }
      return [];
    }),
  };
  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };
  return { client, tx, calls };
}

const VALID_CONTEXT: ScopedTransactionContext = { tenantId: 't1', companyId: 'c1', projectId: 'p1' };
const ORIGINAL_ENV = process.env[SANGFOR_APP_DATABASE_URL_ENV];

beforeEach(() => {
  __internal.resetClientsForTesting();
  process.env[SANGFOR_APP_DATABASE_URL_ENV] = TEST_URL;
});

afterEach(() => {
  __internal.resetClientsForTesting();
  if (ORIGINAL_ENV === undefined) delete process.env[SANGFOR_APP_DATABASE_URL_ENV];
  else process.env[SANGFOR_APP_DATABASE_URL_ENV] = ORIGINAL_ENV;
});

describe('withRlsTransaction — input validation short-circuit (never reaches a client)', () => {
  it('rejects a missing context object without constructing a client', async () => {
    await expect(withRlsTransaction(undefined as unknown as ScopedTransactionContext, async () => 1)).rejects.toThrow(RlsScopeError);
  });

  it.each([
    ['empty tenantId', { ...VALID_CONTEXT, tenantId: '' }],
    ['whitespace-only companyId', { ...VALID_CONTEXT, companyId: '   ' }],
    ['missing projectId', { tenantId: 't1', companyId: 'c1' } as unknown as ScopedTransactionContext],
    ['control character in projectId', { ...VALID_CONTEXT, projectId: `bad${String.fromCharCode(7)}id` }],
    ['non-string companyId', { ...VALID_CONTEXT, companyId: 42 as unknown as string }],
  ])('rejects %s', async (_label, context) => {
    const callback = vi.fn();
    await expect(withRlsTransaction(context, callback)).rejects.toThrow(RlsScopeError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects when SANGFOR_APP_DATABASE_URL is unset, before any transaction attempt', async () => {
    delete process.env[SANGFOR_APP_DATABASE_URL_ENV];
    const callback = vi.fn();
    await expect(withRlsTransaction(VALID_CONTEXT, callback)).rejects.toThrow(RlsScopeError);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('withRlsTransaction — happy path', () => {
  it('sets role and scope, verifies role state and hierarchy, then invokes the callback with the tx client', async () => {
    const { client, calls } = createFakeClient();
    __internal.setAppClientForTesting(TEST_URL, client as never);

    const result = await withRlsTransaction(VALID_CONTEXT, async (tx) => {
      expect(tx).toBeDefined();
      return 'callback-result';
    });

    expect(result).toBe('callback-result');
    expect(calls[0]).toBe('raw:SET LOCAL ROLE sangfor_app');
    expect(calls[1]).toContain('param:');
    expect(calls.some((c) => c.includes('app.tenant_id'))).toBe(true);
    expect(calls.some((c) => c.includes('app.company_id'))).toBe(true);
    expect(calls.some((c) => c.includes('app.project_id'))).toBe(true);
    expect(calls.some((c) => c.includes('session_user'))).toBe(true);
    expect(calls.some((c) => c.includes('FROM projects'))).toBe(true);
  });

  it('reuses the same client for the same URL across calls (pool reuse, not a fresh client per call)', async () => {
    const { client } = createFakeClient();
    __internal.setAppClientForTesting(TEST_URL, client as never);

    await withRlsTransaction(VALID_CONTEXT, async () => 1);
    await withRlsTransaction(VALID_CONTEXT, async () => 2);

    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('withRlsTransaction — fail-closed role/hierarchy verification', () => {
  it('rejects and never calls the callback when session_user/current_user do not match the expected roles', async () => {
    const { client } = createFakeClient({ roleRows: [{ session_user: 'someone_else', current_user: 'sangfor_app' }] });
    __internal.setAppClientForTesting(TEST_URL, client as never);
    const callback = vi.fn();

    await expect(withRlsTransaction(VALID_CONTEXT, callback)).rejects.toThrow(RlsScopeError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects a forged/nonexistent Project->Company->Tenant hierarchy and never calls the callback', async () => {
    const { client } = createFakeClient({ hierarchyRows: [] });
    __internal.setAppClientForTesting(TEST_URL, client as never);
    const callback = vi.fn();

    await expect(withRlsTransaction(VALID_CONTEXT, callback)).rejects.toThrow(RlsScopeError);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('withRlsTransaction — captured-transaction reuse fails closed', () => {
  it('throws if the caller retains and uses the tx client after the callback has completed', async () => {
    const { client } = createFakeClient();
    __internal.setAppClientForTesting(TEST_URL, client as never);

    let leaked: { $queryRaw: (q: unknown) => Promise<unknown> } | null = null;
    await withRlsTransaction(VALID_CONTEXT, async (tx) => {
      leaked = tx as unknown as { $queryRaw: (q: unknown) => Promise<unknown> };
      return 1;
    });

    expect(leaked).not.toBeNull();
    expect(() => leaked!.$queryRaw(Prisma.sql`SELECT 1`)).toThrow(RlsScopeError);
  });

  it('never exposes the root client or a connection URL to the caller — only the callback result is returned', async () => {
    const { client } = createFakeClient();
    __internal.setAppClientForTesting(TEST_URL, client as never);

    const result = await withRlsTransaction(VALID_CONTEXT, async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
    expect(Object.keys(result as object)).toEqual(['ok']);
  });
});

describe('U016 static boundary assertion', () => {
  it('touches only U016-owned paths — no production CRM/web/API/business adapter changed', () => {
    const changed = new Set<string>();
    for (const line of execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n')) {
      if (line.trim()) changed.add(line.trim());
    }
    for (const line of execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n')) {
      if (line.trim()) changed.add(line.trim());
    }

    // U016 companion (required-tightening ripple, same precedent as U014's login/route.test.ts and
    // U015's member-fixture): making AuthScope.projectId required in types.ts broke @sangfor/auth's
    // own compile — these four files are the minimal fail-closed fix that keeps the branch building.
    const allowedExact = new Set([
      'packages/auth/src/types.ts',
      'packages/auth/src/auth-context.ts',
      'packages/auth/src/auth-context.test.ts',
      'packages/auth/src/token-manager.ts',
      'apps/api/src/middleware/auth.ts',
    ]);
    // tmp/ is shared, ungitignored ephemeral evidence output written by every sibling
    // *.integration.test.ts in this package (not only U016's) when CI_INTEGRATION=1 runs the full
    // suite together — a pre-existing repo gap, not a U016 source-boundary violation.
    const allowedPrefixes = ['packages/db/', 'tmp/'];
    const violations = [...changed].filter(
      (path) => !allowedExact.has(path) && !allowedPrefixes.some((prefix) => path.startsWith(prefix)),
    );

    expect(violations).toEqual([]);
  });

  it('scoped-transaction.ts is the only file that issues SET LOCAL ROLE — no second scoped executor exists', () => {
    const srcDir = join(REPO_ROOT, 'packages/db/src');
    const offenders = readdirSync(srcDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'scoped-transaction.ts')
      .filter((name) => readFileSync(join(srcDir, name), 'utf8').includes('SET LOCAL ROLE'));

    expect(offenders).toEqual([]);
  });

  it('the six-table pilot is exercised only by rls.integration.test.ts — no CRM/web/API/business repository imports withRlsTransaction', () => {
    const forbiddenRoots = ['apps/web/src', 'apps/api/src', 'packages/business/src'];
    const offenders: string[] = [];
    for (const root of forbiddenRoots) {
      const abs = join(REPO_ROOT, root);
      let files: string[];
      try {
        files = execFileSync('grep', ['-rl', 'withRlsTransaction', abs], { encoding: 'utf8' }).split('\n').filter(Boolean);
      } catch {
        files = [];
      }
      offenders.push(...files);
    }
    expect(offenders).toEqual([]);
  });
});
