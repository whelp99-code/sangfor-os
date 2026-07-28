import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { expectedCurrentModelCount, MODEL_SCOPE_INVENTORY } from './scope-inventory';
import { buildScopeRlsPolicies } from './scope-rls-closure';

const migration = readFileSync(
  resolve(import.meta.dirname, '../prisma/migrations/20260716011300_close_scope_rls_contracts/migration.sql'),
  'utf8',
);

describe('U073 complete scope RLS closure', () => {
  const policies = buildScopeRlsPolicies();
  const scopedInventory = Object.values(MODEL_SCOPE_INVENTORY).filter((entry) => entry.category !== 'GLOBAL_SHARED');

  it('covers every non-global inventory model exactly once', () => {
    expect(Object.keys(MODEL_SCOPE_INVENTORY)).toHaveLength(expectedCurrentModelCount());
    expect(policies).toHaveLength(scopedInventory.length);
    expect(new Set(policies.map((policy) => policy.model)).size).toBe(scopedInventory.length);
    expect(new Set(policies.map((policy) => policy.table)).size).toBe(scopedInventory.length);
  });

  it('uses parent EXISTS predicates for every CHILD_VIA_FK entry', () => {
    const childPolicies = policies.filter((policy) => policy.category === 'CHILD_VIA_FK');
    expect(childPolicies).toHaveLength(97);
    for (const policy of childPolicies) {
      expect(policy.predicate).toMatch(/^EXISTS \(SELECT 1 FROM /);
      expect(policy.predicate).toContain('scope_parent."id"');
      expect(policy.predicate).not.toContain('USING (true)');
    }
  });

  it('fails closed for legacy roots that still lack a canonical scope column', () => {
    expect(policies.find((policy) => policy.model === 'AgentAssignmentRule')?.predicate).toBe('false');
    expect(policies.find((policy) => policy.model === 'AiModel')?.predicate).toBe('false');
  });

  it('keeps canonical hierarchy checks on direct roots', () => {
    expect(policies.find((policy) => policy.model === 'Company')?.predicate).toContain("app.tenant_id");
    expect(policies.find((policy) => policy.model === 'Project')?.predicate).toContain('scope_company');
    expect(policies.find((policy) => policy.model === 'Customer')?.predicate).toContain('scope_project');
    expect(policies.find((policy) => policy.model === 'SchedulerJob')?.predicate).toContain('scope_company');
    expect(policies.find((policy) => policy.model === 'SchedulerJob')?.predicate).not.toContain('scope_project');
    expect(policies.find((policy) => policy.model === 'SizingTemplate')?.predicate).toContain('scope_family');
    expect(policies.find((policy) => policy.model === 'Contact')?.predicate).toContain('scope_customer');
    expect(policies.find((policy) => policy.model === 'VendorRequest')?.predicate).toContain('scope_customer');
  });

  it('migration builds one canonical FOR ALL policy with USING and WITH CHECK', () => {
    expect(migration).toContain('FOR ALL TO sangfor_app');
    expect(migration).toContain('USING (%s) WITH CHECK (%s)');
    expect(migration).toContain('DROP POLICY');
    expect(migration).not.toContain('app.current_company_id');
    expect(migration).not.toContain('app.current_project_id');
    expect(migration).not.toContain('USING (true)');
  });
});
