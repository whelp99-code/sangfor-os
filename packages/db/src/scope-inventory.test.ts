import { describe, expect, it } from 'vitest';

import {
  MODEL_SCOPE_INVENTORY,
  SCOPE_INVENTORY_BASELINE,
  assertNoRoleChangeRequestScopeExpansion,
  assertScopeBridgeOnDelete,
  buildScopeInventoryReport,
  classifyModel,
  deriveStructuralMismatches,
  validateChildViaFkEntries,
  type DmmfRelationField,
  type ScopeInventoryEntry,
} from './scope-inventory';

const REAL_ENTRIES: ScopeInventoryEntry[] = Object.values(MODEL_SCOPE_INVENTORY);
const REAL_MODEL_NAMES = REAL_ENTRIES.map((e) => e.model);

describe('SCOPE_INVENTORY_BASELINE', () => {
  it('is frozen and matches the 150-model baseline tallies', () => {
    expect(Object.isFrozen(SCOPE_INVENTORY_BASELINE)).toBe(true);
    expect(SCOPE_INVENTORY_BASELINE.modelCount).toBe(150);
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts).toEqual({
      GLOBAL_SHARED: 13,
      TENANT_ROOT: 1,
      COMPANY_ROOT: 32,
      PROJECT_ROOT: 44,
      CHILD_VIA_FK: 60,
    });
  });
});

describe('classifyModel', () => {
  it('returns the entry for a known model', () => {
    expect(classifyModel('Tenant')).toEqual({ model: 'Tenant', category: 'TENANT_ROOT' });
  });

  it('returns undefined for an unknown model', () => {
    expect(classifyModel('NotARealModel')).toBeUndefined();
  });
});

describe('buildScopeInventoryReport — real inventory', () => {
  it('reports ok with exact 150 / 13-1-32-44-60 tallies against its own model list', () => {
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.currentModelCount).toBe(150);
    expect(report.tallies).toEqual(SCOPE_INVENTORY_BASELINE.categoryCounts);
  });
});

describe('buildScopeInventoryReport — failing-first fixtures', () => {
  it('fails when a real model is deleted from the inventory (missing model)', () => {
    const withoutTenant = REAL_ENTRIES.filter((e) => e.model !== 'Tenant');
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, withoutTenant);

    expect(report.ok).toBe(false);
    expect(report.missingModels).toEqual(['Tenant']);
    expect(report.errors.some((e) => e.code === 'MISSING_MODEL' && e.model === 'Tenant')).toBe(true);
  });

  it('fails when a fake model is added to the inventory (unknown model)', () => {
    const withFake: ScopeInventoryEntry[] = [
      ...REAL_ENTRIES,
      { model: 'TotallyFakeModel', category: 'GLOBAL_SHARED' },
    ];
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, withFake);

    expect(report.ok).toBe(false);
    expect(report.unknownModels).toEqual(['TotallyFakeModel']);
    expect(report.errors.some((e) => e.code === 'UNKNOWN_MODEL' && e.model === 'TotallyFakeModel')).toBe(true);
  });

  it('fails when one model is classified into two categories (duplicate/ambiguous)', () => {
    const duplicated: ScopeInventoryEntry[] = [
      ...REAL_ENTRIES,
      { model: 'Tenant', category: 'GLOBAL_SHARED' },
    ];
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, duplicated);

    expect(report.ok).toBe(false);
    expect(report.duplicateModels).toEqual(['Tenant']);
    expect(report.errors.some((e) => e.code === 'DUPLICATE_MODEL' && e.model === 'Tenant')).toBe(true);
  });

  it('fails category-tally drift at the exact baseline model count even with a full model set', () => {
    const relabeled = REAL_ENTRIES.map((e) =>
      e.model === 'Tenant' ? { model: 'Tenant', category: 'GLOBAL_SHARED' as const } : e,
    );
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, relabeled);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === 'TALLY_MISMATCH')).toBe(true);
  });
});

describe('validateChildViaFkEntries — failing-first fixtures', () => {
  it('fails a CHILD_VIA_FK fixture whose live scalar FK is optional (optional-only chain)', () => {
    const entry: ScopeInventoryEntry = {
      model: 'ToolCall',
      category: 'CHILD_VIA_FK',
      parentModel: 'AgentAssignment',
      relationField: 'agentAssignment',
      scalarFkField: 'agentAssignmentId',
      nullable: false,
    };
    const dmmf: DmmfRelationField[] = [
      {
        model: 'ToolCall',
        relationField: 'agentAssignment',
        targetModel: 'AgentAssignment',
        scalarFkFields: ['agentAssignmentId'],
        mandatory: false, // fixture: the live schema made this FK nullable
        onDelete: null,
      },
    ];

    const errors = validateChildViaFkEntries([entry], dmmf);
    expect(errors.some((e) => e.code === 'DEAD_END_CHAIN' && e.model === 'ToolCall')).toBe(true);
  });

  it('fails when Project.companyId (a nullable correlation field) is fixtured as CHILD_VIA_FK scope authority', () => {
    const entry: ScopeInventoryEntry = {
      model: 'Project',
      category: 'CHILD_VIA_FK',
      parentModel: 'Company',
      relationField: 'company',
      scalarFkField: 'companyId',
      nullable: false,
    };
    const dmmf: DmmfRelationField[] = [
      {
        model: 'Project',
        relationField: 'company',
        targetModel: 'Company',
        scalarFkFields: ['companyId'],
        mandatory: false, // Project.companyId is nullable by design (correlation-only bridge)
        onDelete: 'Restrict',
      },
    ];

    const errors = validateChildViaFkEntries([entry], dmmf);
    expect(errors.some((e) => e.code === 'DEAD_END_CHAIN' && e.model === 'Project')).toBe(true);
  });

  it('fails a CHILD_VIA_FK fixture whose recorded parent/field no longer matches the live schema (miscategorized / stale)', () => {
    const entry: ScopeInventoryEntry = {
      model: 'ToolCall',
      category: 'CHILD_VIA_FK',
      parentModel: 'AgentAssignment',
      relationField: 'agentAssignment',
      scalarFkField: 'agentAssignmentId',
      nullable: false,
    };
    const dmmf: DmmfRelationField[] = [
      {
        model: 'ToolCall',
        relationField: 'agentAssignment',
        targetModel: 'SomeUnrelatedModel',
        scalarFkFields: ['agentAssignmentId'],
        mandatory: true,
        onDelete: 'Cascade',
      },
    ];

    const errors = validateChildViaFkEntries([entry], dmmf);
    expect(errors.some((e) => e.code === 'STALE_PARENT' && e.model === 'ToolCall')).toBe(true);
  });
});

describe('deriveStructuralMismatches — failing-first fixtures', () => {
  it('fails a CHILD_VIA_FK chain that is ambiguous across two roots', () => {
    const entries: ScopeInventoryEntry[] = [
      { model: 'RootA', category: 'PROJECT_ROOT' },
      { model: 'RootB', category: 'COMPANY_ROOT' },
      {
        model: 'Ambiguous',
        category: 'CHILD_VIA_FK',
        parentModel: 'RootA',
        relationField: 'rootA',
        scalarFkField: 'rootAId',
        nullable: false,
      },
    ];
    const dmmf: DmmfRelationField[] = [
      { model: 'Ambiguous', relationField: 'rootA', targetModel: 'RootA', scalarFkFields: ['rootAId'], mandatory: true, onDelete: 'Cascade' },
      { model: 'Ambiguous', relationField: 'rootB', targetModel: 'RootB', scalarFkFields: ['rootBId'], mandatory: true, onDelete: 'Cascade' },
    ];

    const errors = deriveStructuralMismatches(entries, dmmf);
    expect(errors.some((e) => e.code === 'AMBIGUOUS_ROOT' && e.model === 'Ambiguous')).toBe(true);
  });

  it('fails a CHILD_VIA_FK model miscategorized to force a count, whose only mandatory edge dead-ends at a GLOBAL_SHARED model', () => {
    const entries: ScopeInventoryEntry[] = [
      { model: 'GlobalCatalog', category: 'GLOBAL_SHARED' },
      {
        model: 'ForcedChild',
        category: 'CHILD_VIA_FK',
        parentModel: 'GlobalCatalog',
        relationField: 'catalog',
        scalarFkField: 'catalogId',
        nullable: false,
      },
    ];
    const dmmf: DmmfRelationField[] = [
      { model: 'ForcedChild', relationField: 'catalog', targetModel: 'GlobalCatalog', scalarFkFields: ['catalogId'], mandatory: true, onDelete: 'Cascade' },
    ];

    const errors = deriveStructuralMismatches(entries, dmmf);
    expect(errors.some((e) => e.code === 'DEAD_END_CHAIN' && e.model === 'ForcedChild')).toBe(true);
  });

  it('passes the real 150-model inventory against its own live mandatory-FK relation graph', () => {
    const dmmf: DmmfRelationField[] = REAL_ENTRIES.filter(
      (e): e is Extract<ScopeInventoryEntry, { category: 'CHILD_VIA_FK' }> => e.category === 'CHILD_VIA_FK',
    ).map((e) => ({
      model: e.model,
      relationField: e.relationField,
      targetModel: e.parentModel,
      scalarFkFields: [e.scalarFkField],
      mandatory: true,
      onDelete: 'Cascade',
    }));

    const errors = deriveStructuralMismatches(REAL_ENTRIES, dmmf);
    expect(errors).toEqual([]);
  });
});

describe('onDelete contract — Project/Company scope bridge', () => {
  it('fails when onDelete is omitted', () => {
    expect(assertScopeBridgeOnDelete(undefined).ok).toBe(false);
    expect(assertScopeBridgeOnDelete(null).ok).toBe(false);
  });

  it('fails when onDelete is SetNull', () => {
    expect(assertScopeBridgeOnDelete('SetNull').ok).toBe(false);
  });

  it('fails when onDelete is Cascade', () => {
    expect(assertScopeBridgeOnDelete('Cascade').ok).toBe(false);
  });

  it('passes only for exact Restrict', () => {
    expect(assertScopeBridgeOnDelete('Restrict').ok).toBe(true);
  });
});

describe('role_change_requests scope-expansion guard', () => {
  it('fails a migration SQL fixture that adds a nullable scope column to role_change_requests', () => {
    const sql = [
      '-- AlterTable',
      'ALTER TABLE "role_change_requests" ADD COLUMN "company_id" TEXT;',
    ].join('\n');

    const result = assertNoRoleChangeRequestScopeExpansion(sql);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('fails a schema-diff fixture that touches role_change_requests at all', () => {
    const diff = '  model RoleChangeRequest {\n+   tenantId String?\n  }\n-- table: role_change_requests';
    const result = assertNoRoleChangeRequestScopeExpansion(diff);
    expect(result.ok).toBe(false);
  });

  it('passes SQL that never mentions role_change_requests', () => {
    const sql = 'ALTER TABLE "projects" ADD COLUMN "company_id" TEXT;';
    expect(assertNoRoleChangeRequestScopeExpansion(sql).ok).toBe(true);
  });
});
