import { describe, expect, it } from 'vitest';

import {
  MODEL_SCOPE_INVENTORY,
  RECLASSIFIED_MODELS,
  REGISTERED_ADDITIONS,
  SCOPE_INVENTORY_BASELINE,
  assertNoRoleChangeRequestScopeExpansion,
  assertScopeBridgeOnDelete,
  buildScopeInventoryReport,
  classifyModel,
  deriveStructuralMismatches,
  expectedCategoryCounts,
  expectedCurrentModelCount,
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
  it('reports ok with exact 161 / 13-1-32-48-67 tallies against its own model list (post-U012 RoleChangeRequest reclassification, post-U014 AuthSession registration, post-U017 Artifact/ArtifactVersion registration, post-U018 ApprovalDecision/ApprovalCurrentValidity registration, post-U019 WorkflowDefinition/WorkflowRun/WorkflowRunStep/WorkflowRunArtifact/WorkflowRunEvent registration)', () => {
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.currentModelCount).toBe(161);
    expect(report.tallies).toEqual({
      GLOBAL_SHARED: 13,
      TENANT_ROOT: 1,
      COMPANY_ROOT: 32,
      PROJECT_ROOT: 48,
      CHILD_VIA_FK: 67,
    });
  });
});

describe('REGISTERED_ADDITIONS — U011 model registration', () => {
  it('registers exactly ScopeBackfillQuarantine as GLOBAL_SHARED for U011, AuthSession as PROJECT_ROOT for U014, Artifact as PROJECT_ROOT and ArtifactVersion as CHILD_VIA_FK for U017, ApprovalDecision and ApprovalCurrentValidity as CHILD_VIA_FK for U018, then WorkflowDefinition/WorkflowRun as PROJECT_ROOT and WorkflowRunStep/WorkflowRunArtifact/WorkflowRunEvent as CHILD_VIA_FK for U019', () => {
    expect(REGISTERED_ADDITIONS).toEqual([
      { model: 'ScopeBackfillQuarantine', unit: 'U011', category: 'GLOBAL_SHARED' },
      { model: 'AuthSession', unit: 'U014', category: 'PROJECT_ROOT' },
      { model: 'Artifact', unit: 'U017', category: 'PROJECT_ROOT' },
      { model: 'ArtifactVersion', unit: 'U017', category: 'CHILD_VIA_FK' },
      { model: 'ApprovalDecision', unit: 'U018', category: 'CHILD_VIA_FK' },
      { model: 'ApprovalCurrentValidity', unit: 'U018', category: 'CHILD_VIA_FK' },
      { model: 'WorkflowDefinition', unit: 'U019', category: 'PROJECT_ROOT' },
      { model: 'WorkflowRun', unit: 'U019', category: 'PROJECT_ROOT' },
      { model: 'WorkflowRunStep', unit: 'U019', category: 'CHILD_VIA_FK' },
      { model: 'WorkflowRunArtifact', unit: 'U019', category: 'CHILD_VIA_FK' },
      { model: 'WorkflowRunEvent', unit: 'U019', category: 'CHILD_VIA_FK' },
    ]);
  });

  it('leaves SCOPE_INVENTORY_BASELINE immutable at 150 while the expected current count is 161', () => {
    expect(SCOPE_INVENTORY_BASELINE.modelCount).toBe(150);
    expect(expectedCurrentModelCount()).toBe(161);
  });

  it('derives expected category counts as baseline plus the eleven registered additions (reclassifications isolated out)', () => {
    expect(expectedCategoryCounts(SCOPE_INVENTORY_BASELINE, REGISTERED_ADDITIONS, [])).toEqual({
      GLOBAL_SHARED: 14,
      TENANT_ROOT: 1,
      COMPANY_ROOT: 32,
      PROJECT_ROOT: 48,
      CHILD_VIA_FK: 66,
    });
  });

  it('classifies ScopeBackfillQuarantine as GLOBAL_SHARED in the live inventory', () => {
    expect(classifyModel('ScopeBackfillQuarantine')).toEqual({
      model: 'ScopeBackfillQuarantine',
      category: 'GLOBAL_SHARED',
    });
  });
});

describe('REGISTERED_ADDITIONS — U014 model registration', () => {
  it('classifies AuthSession as PROJECT_ROOT in the live inventory', () => {
    expect(classifyModel('AuthSession')).toEqual({
      model: 'AuthSession',
      category: 'PROJECT_ROOT',
    });
  });

  it('derives expected category counts as baseline plus all registered additions', () => {
    expect(expectedCategoryCounts()).toEqual({
      GLOBAL_SHARED: 13,
      TENANT_ROOT: 1,
      COMPANY_ROOT: 32,
      PROJECT_ROOT: 48,
      CHILD_VIA_FK: 67,
    });
  });
});

describe('REGISTERED_ADDITIONS — U018 model registration', () => {
  it('classifies ApprovalDecision as CHILD_VIA_FK of ApprovalRequest via mandatory approvalRequestId in the live inventory', () => {
    expect(classifyModel('ApprovalDecision')).toEqual({
      model: 'ApprovalDecision',
      category: 'CHILD_VIA_FK',
      parentModel: 'ApprovalRequest',
      relationField: 'approvalRequest',
      scalarFkField: 'approvalRequestId',
      nullable: false,
    });
  });

  it('classifies ApprovalCurrentValidity as CHILD_VIA_FK of ApprovalRequest via mandatory approvalRequestId in the live inventory', () => {
    expect(classifyModel('ApprovalCurrentValidity')).toEqual({
      model: 'ApprovalCurrentValidity',
      category: 'CHILD_VIA_FK',
      parentModel: 'ApprovalRequest',
      relationField: 'approvalRequest',
      scalarFkField: 'approvalRequestId',
      nullable: false,
    });
  });

  it('ownerAssignmentId/requestedByAssignmentId/actorAssignmentId are authority/attribution edges, not an alternate scope-classification path — ApprovalRequest stays classified exactly once, as PROJECT_ROOT', () => {
    const approvalRequestEntries = REAL_ENTRIES.filter((e) => e.model === 'ApprovalRequest');
    expect(approvalRequestEntries).toHaveLength(1);
    expect(approvalRequestEntries[0]).toEqual({ model: 'ApprovalRequest', category: 'PROJECT_ROOT' });
  });
});

describe('REGISTERED_ADDITIONS — U017 model registration', () => {
  it('classifies Artifact as PROJECT_ROOT in the live inventory (mandatory tenant/company/project simultaneously, same AMBIGUOUS_ROOT reasoning as AuthSession)', () => {
    expect(classifyModel('Artifact')).toEqual({
      model: 'Artifact',
      category: 'PROJECT_ROOT',
    });
  });

  it('classifies ArtifactVersion as CHILD_VIA_FK of Artifact via mandatory artifactId in the live inventory', () => {
    expect(classifyModel('ArtifactVersion')).toEqual({
      model: 'ArtifactVersion',
      category: 'CHILD_VIA_FK',
      parentModel: 'Artifact',
      relationField: 'artifact',
      scalarFkField: 'artifactId',
      nullable: false,
    });
  });

  it('ownerAssignmentId is an authority/ownership edge, not an alternate scope-classification path — Artifact stays classified exactly once, as PROJECT_ROOT', () => {
    const artifactEntries = REAL_ENTRIES.filter((e) => e.model === 'Artifact');
    expect(artifactEntries).toHaveLength(1);
    expect(artifactEntries[0]).toEqual({ model: 'Artifact', category: 'PROJECT_ROOT' });
  });
});

describe('REGISTERED_ADDITIONS — U019 model registration', () => {
  it('classifies WorkflowDefinition as PROJECT_ROOT in the live inventory (mandatory tenant/company/project simultaneously, same AMBIGUOUS_ROOT reasoning as Artifact/AuthSession)', () => {
    expect(classifyModel('WorkflowDefinition')).toEqual({
      model: 'WorkflowDefinition',
      category: 'PROJECT_ROOT',
    });
  });

  it('classifies WorkflowRun as PROJECT_ROOT in the live inventory (mandatory tenant/company/project simultaneously, plus a mandatory workflowDefinitionId FK to another PROJECT_ROOT — a second root path that makes CHILD_VIA_FK structurally ambiguous)', () => {
    expect(classifyModel('WorkflowRun')).toEqual({
      model: 'WorkflowRun',
      category: 'PROJECT_ROOT',
    });
  });

  it('classifies WorkflowRunStep as CHILD_VIA_FK of WorkflowRun via mandatory workflowRunId in the live inventory', () => {
    expect(classifyModel('WorkflowRunStep')).toEqual({
      model: 'WorkflowRunStep',
      category: 'CHILD_VIA_FK',
      parentModel: 'WorkflowRun',
      relationField: 'run',
      scalarFkField: 'workflowRunId',
      nullable: false,
    });
  });

  it('classifies WorkflowRunArtifact as CHILD_VIA_FK of WorkflowRun via mandatory workflowRunId in the live inventory', () => {
    expect(classifyModel('WorkflowRunArtifact')).toEqual({
      model: 'WorkflowRunArtifact',
      category: 'CHILD_VIA_FK',
      parentModel: 'WorkflowRun',
      relationField: 'run',
      scalarFkField: 'workflowRunId',
      nullable: false,
    });
  });

  it('classifies WorkflowRunEvent as CHILD_VIA_FK of WorkflowRun via mandatory workflowRunId in the live inventory', () => {
    expect(classifyModel('WorkflowRunEvent')).toEqual({
      model: 'WorkflowRunEvent',
      category: 'CHILD_VIA_FK',
      parentModel: 'WorkflowRun',
      relationField: 'run',
      scalarFkField: 'workflowRunId',
      nullable: false,
    });
  });

  it('artifactVersionId/createdByAssignmentId/requestedByAssignmentId are content/attribution edges, not an alternate scope-classification path — WorkflowDefinition and WorkflowRun each stay classified exactly once, as PROJECT_ROOT', () => {
    const definitionEntries = REAL_ENTRIES.filter((e) => e.model === 'WorkflowDefinition');
    const runEntries = REAL_ENTRIES.filter((e) => e.model === 'WorkflowRun');
    expect(definitionEntries).toHaveLength(1);
    expect(runEntries).toHaveLength(1);
    expect(definitionEntries[0]).toEqual({ model: 'WorkflowDefinition', category: 'PROJECT_ROOT' });
    expect(runEntries[0]).toEqual({ model: 'WorkflowRun', category: 'PROJECT_ROOT' });
  });
});

describe('RECLASSIFIED_MODELS — U012 RoleChangeRequest reclassification', () => {
  it('reclassifies exactly RoleChangeRequest from GLOBAL_SHARED to CHILD_VIA_FK for U012', () => {
    expect(RECLASSIFIED_MODELS).toEqual([
      { model: 'RoleChangeRequest', unit: 'U012', fromCategory: 'GLOBAL_SHARED', toCategory: 'CHILD_VIA_FK' },
    ]);
  });

  it('leaves SCOPE_INVENTORY_BASELINE immutable (RoleChangeRequest stays GLOBAL_SHARED in the historical baseline)', () => {
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts.GLOBAL_SHARED).toBe(13);
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts.CHILD_VIA_FK).toBe(60);
  });

  it('derives expected category counts as baseline plus the registered GLOBAL_SHARED/PROJECT_ROOT/CHILD_VIA_FK additions minus one reclassified GLOBAL_SHARED->CHILD_VIA_FK', () => {
    expect(expectedCategoryCounts()).toEqual({
      GLOBAL_SHARED: 13,
      TENANT_ROOT: 1,
      COMPANY_ROOT: 32,
      PROJECT_ROOT: 48,
      CHILD_VIA_FK: 67,
    });
  });

  it('classifies RoleChangeRequest as CHILD_VIA_FK of Company via mandatory companyId in the live inventory', () => {
    expect(classifyModel('RoleChangeRequest')).toEqual({
      model: 'RoleChangeRequest',
      category: 'CHILD_VIA_FK',
      parentModel: 'Company',
      relationField: 'company',
      scalarFkField: 'companyId',
      nullable: false,
    });
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

  it('passes the real current-model inventory against its own live mandatory-FK relation graph', () => {
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
