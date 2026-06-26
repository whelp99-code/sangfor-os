import { describe, expect, it, vi } from 'vitest';

import {
  RLS_BASELINE_POLICIES,
  buildAllRlsPolicyStatements,
  buildRlsPolicyStatements,
  setRlsContext,
} from './rls';

describe('RLS baseline helpers', () => {
  it('generates fail-closed row policies for direct scope columns', () => {
    const statements = buildRlsPolicyStatements({
      table: 'customers',
      scopeColumn: 'project_id',
      setting: 'app.company_id',
    });

    expect(statements).toContain('ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;');
    expect(statements).toContain('ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;');
    expect(statements.join('\n')).toContain('"project_id"::text = current_setting(\'app.company_id\', false)');
  });

  it('uses current schema project_id scope for legacy business tables', () => {
    const statements = buildAllRlsPolicyStatements().join('\n');

    expect(statements).toContain('CREATE POLICY "customers_scope_policy"');
    expect(statements).toContain('"project_id"::text = current_setting(\'app.company_id\', false)');
    expect(statements).not.toContain('customers_tenant_company_policy');
  });

  it('does not generate tenant_id predicates for user_company_roles because the current table has only company_id', () => {
    const statements = buildRlsPolicyStatements(
      RLS_BASELINE_POLICIES.find((policy) => policy.table === 'user_company_roles')!,
    ).join('\n');

    expect(statements).toContain('ON "user_company_roles"');
    expect(statements).toContain('"company_id"::text = current_setting(\'app.company_id\', false)');
    expect(statements).not.toContain('"tenant_id"');
  });

  it('rejects unsafe SQL identifiers when generating policies', () => {
    expect(() =>
      buildRlsPolicyStatements({
        table: 'customers; drop table users',
        scopeColumn: 'project_id',
        setting: 'app.company_id',
      }),
    ).toThrow('Unsafe SQL identifier');
  });

  it('sets tenant and company context with parameterized Prisma SQL', async () => {
    const execute = vi.fn().mockResolvedValue(1);

    await setRlsContext({ $executeRaw: execute }, { tenantId: 'tenant-1', companyId: 'company-1' });

    expect(execute).toHaveBeenCalledTimes(2);
    const firstQuery = execute.mock.calls[0]?.[0] as { strings?: string[] };
    const secondQuery = execute.mock.calls[1]?.[0] as { strings?: string[] };
    expect(firstQuery.strings?.join('')).toContain('set_config');
    expect(secondQuery.strings?.join('')).toContain('set_config');
  });
});
