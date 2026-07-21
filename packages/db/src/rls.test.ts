import { describe, expect, it, vi } from 'vitest';

import {
  RLS_BASELINE_POLICIES,
  RLS_COMPANY_SETTING,
  RLS_PILOT_POLICIES,
  RLS_PILOT_TABLES,
  RLS_PROJECT_SETTING,
  RLS_TENANT_SETTING,
  buildAllRlsPolicyStatements,
  buildRlsPolicyStatements,
  setRlsContext,
} from './rls';

describe('RLS baseline helpers', () => {
  it('generates fail-closed row policies for direct scope columns', () => {
    const statements = buildRlsPolicyStatements({
      table: 'customers',
      scopeColumn: 'project_id',
      setting: RLS_PROJECT_SETTING,
    });

    expect(statements).toContain('ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;');
    expect(statements).toContain('ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;');
    expect(statements.join('\n')).toContain('"project_id"::text = current_setting(\'app.project_id\', false)');
  });

  it('uses app.project_id (never app.company_id) for legacy project_id-scoped business tables — U016 fix of the pre-existing bad predicate', () => {
    const statements = buildAllRlsPolicyStatements().join('\n');

    expect(statements).toContain('CREATE POLICY "customers_scope_policy"');
    expect(statements).toContain('"project_id"::text = current_setting(\'app.project_id\', false)');
    expect(statements).not.toContain('"project_id"::text = current_setting(\'app.company_id\', false)');
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
        setting: RLS_PROJECT_SETTING,
      }),
    ).toThrow('Unsafe SQL identifier');
  });

  it('sets tenant and company context with parameterized Prisma SQL (deprecated, not part of the package public surface)', async () => {
    const execute = vi.fn().mockResolvedValue(1);

    await setRlsContext({ $executeRaw: execute }, { tenantId: 'tenant-1', companyId: 'company-1' });

    expect(execute).toHaveBeenCalledTimes(2);
    const firstQuery = execute.mock.calls[0]?.[0] as { strings?: string[] };
    const secondQuery = execute.mock.calls[1]?.[0] as { strings?: string[] };
    expect(firstQuery.strings?.join('')).toContain('set_config');
    expect(secondQuery.strings?.join('')).toContain('set_config');
  });
});

describe('RLS_PROJECT_SETTING', () => {
  it('is app.project_id, distinct from app.tenant_id and app.company_id', () => {
    expect(RLS_PROJECT_SETTING).toBe('app.project_id');
    expect(RLS_PROJECT_SETTING).not.toBe(RLS_TENANT_SETTING);
    expect(RLS_PROJECT_SETTING).not.toBe(RLS_COMPANY_SETTING);
  });
});

describe('RLS_PILOT_POLICIES — the six exact pilot policies', () => {
  it('names exactly the six pilot tables with the exact sangfor_scope_* policy names', () => {
    expect(RLS_PILOT_POLICIES).toHaveLength(6);
    expect(RLS_PILOT_TABLES).toHaveLength(6);
    for (const table of RLS_PILOT_TABLES) {
      const policy = RLS_PILOT_POLICIES.find((p) => p.table === table);
      expect(policy).toBeDefined();
      expect(policy!.policyName).toBe(`sangfor_scope_${table}`);
    }
  });

  it('never uses USING (true) — every predicate is a real comparison', () => {
    for (const policy of RLS_PILOT_POLICIES) {
      expect(policy.predicate).not.toBe('true');
      expect(policy.predicate).not.toMatch(/^\s*true\s*$/);
    }
  });

  it('companies compares tenant_id to app.tenant_id and id to app.company_id', () => {
    const policy = RLS_PILOT_POLICIES.find((p) => p.table === 'companies')!;
    expect(policy.predicate).toContain(`tenant_id = current_setting('${RLS_TENANT_SETTING}', true)`);
    expect(policy.predicate).toContain(`id = current_setting('${RLS_COMPANY_SETTING}', true)`);
  });

  it('project-root tables compare project_id to app.project_id, never to app.company_id', () => {
    for (const table of ['project_members', 'customers', 'opportunities'] as const) {
      const policy = RLS_PILOT_POLICIES.find((p) => p.table === table)!;
      expect(policy.predicate).toContain(`project_id = current_setting('${RLS_PROJECT_SETTING}', true)`);
      expect(policy.predicate).not.toMatch(/project_id = current_setting\('app\.company_id'/);
    }
    const projectsPolicy = RLS_PILOT_POLICIES.find((p) => p.table === 'projects')!;
    expect(projectsPolicy.predicate).toContain(`id = current_setting('${RLS_PROJECT_SETTING}', true)`);
  });

  it('projects, project_members, customers, and opportunities chain back to the parent Company/Tenant', () => {
    for (const table of ['projects', 'project_members', 'customers', 'opportunities'] as const) {
      const policy = RLS_PILOT_POLICIES.find((p) => p.table === table)!;
      expect(policy.predicate).toContain('EXISTS');
      expect(policy.predicate).toContain(`companies.tenant_id = current_setting('${RLS_TENANT_SETTING}', true)`);
    }
  });

  it('user_company_roles compares only company_id to app.company_id', () => {
    const policy = RLS_PILOT_POLICIES.find((p) => p.table === 'user_company_roles')!;
    expect(policy.predicate).toBe(`company_id = current_setting('${RLS_COMPANY_SETTING}', true)`);
  });
});
