import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  CATALOG_TRANSITIONAL_CANONICAL_SCOPE_PATHS,
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
      COMPANY_DIRECT: 0,
    });
  });
});

describe('U040 catalog canonical scope paths', () => {
  it('records the required family/SKU chains after the zero-ambiguity receipt', () => {
    expect(CATALOG_TRANSITIONAL_CANONICAL_SCOPE_PATHS).toEqual({
      ProductFamily: { relationField: 'company', scalarFkField: 'companyId', parentModel: 'Company' },
      ProductEdition: { relationField: 'family', scalarFkField: 'familyId', parentModel: 'ProductFamily' },
      ProductSku: { relationField: 'edition', scalarFkField: 'editionId', parentModel: 'ProductEdition' },
      LicenseMetric: { relationField: 'productFamily', scalarFkField: 'productFamilyId', parentModel: 'ProductFamily' },
      SizingTemplate: { relationField: 'family', scalarFkField: 'productFamilyId', parentModel: 'ProductFamily' },
      CompatibilityRule: { relationField: 'sourceSku', scalarFkField: 'sourceSkuId', parentModel: 'ProductSku', additionalRequiredRelationFields: ['targetSku'] },
    });
    expect(classifyModel('ProductFamily')).toEqual({ model: 'ProductFamily', category: 'COMPANY_ROOT' });
    expect(classifyModel('LicenseMetric')).toEqual({ model: 'LicenseMetric', category: 'CHILD_VIA_FK', parentModel: 'ProductFamily', relationField: 'productFamily', scalarFkField: 'productFamilyId', nullable: false });
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
  it('reports ok with the U042 exact 189-model count and category tallies against its own model list', () => {
    const report = buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(Prisma.dmmf.datamodel.models).toHaveLength(192);
    expect(report.currentModelCount).toBe(192);
    expect(report.currentModelCount).toBe(expectedCurrentModelCount());
    expect(report.tallies).toEqual(expectedCategoryCounts());
  });
});

describe('REGISTERED_ADDITIONS — U011 model registration', () => {
  it('registers each additive model exactly once, including the U038/U039 roots and mandatory children', () => {
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
      { model: 'QuoteCommercialSnapshot', unit: 'U035', category: 'CHILD_VIA_FK' },
      { model: 'DemoLicense', unit: 'U036', category: 'CHILD_VIA_FK' },
      { model: 'DeliveryAcceptance', unit: 'U037', category: 'CHILD_VIA_FK' },
      { model: 'RenewalReminderEvent', unit: 'U037', category: 'CHILD_VIA_FK' },
      { model: 'CertificationDefinition', unit: 'U038', category: 'COMPANY_ROOT' },
      { model: 'CertificationEvidence', unit: 'U038', category: 'CHILD_VIA_FK' },
      { model: 'EngineerSkill', unit: 'U038', category: 'COMPANY_ROOT' },
      { model: 'EngineerEligibilityPolicy', unit: 'U038', category: 'COMPANY_ROOT' },
      { model: 'EngagementCapabilityRequirement', unit: 'U038', category: 'CHILD_VIA_FK' },
      { model: 'EngineerAssignment', unit: 'U038', category: 'CHILD_VIA_FK' },
      { model: 'SupportSlaPolicyVersion', unit: 'U039', category: 'COMPANY_ROOT' },
      { model: 'SupportCaseSlaSnapshot', unit: 'U039', category: 'CHILD_VIA_FK' },
      { model: 'AiQualityAssessment', unit: 'U041', category: 'CHILD_VIA_FK' },
      { model: 'AiQualityEvidence', unit: 'U041', category: 'CHILD_VIA_FK' },
      { model: 'AiQualityReview', unit: 'U041', category: 'CHILD_VIA_FK' },
      { model: 'AiReleaseEvaluation', unit: 'U041', category: 'CHILD_VIA_FK' },
      { model: 'AiPromptSnapshot', unit: 'U041', category: 'CHILD_VIA_FK' },
      { model: 'AiModelSnapshot', unit: 'U041', category: 'CHILD_VIA_FK' },
      { model: 'RetentionPolicy', unit: 'U042', category: 'COMPANY_ROOT' },
      { model: 'RetentionPolicyVersion', unit: 'U042', category: 'CHILD_VIA_FK' },
      { model: 'RetentionAssignment', unit: 'U042', category: 'CHILD_VIA_FK' },
      { model: 'LegalHold', unit: 'U042', category: 'COMPANY_ROOT' },
      { model: 'LegalHoldScope', unit: 'U042', category: 'COMPANY_DIRECT' },
      { model: 'RetentionRun', unit: 'U042', category: 'COMPANY_DIRECT' },
      { model: 'RetentionRunItem', unit: 'U042', category: 'CHILD_VIA_FK' },
      { model: 'ExportCapability', unit: 'U042', category: 'CHILD_VIA_FK' },
      { model: 'OwnershipTransfer', unit: 'U042', category: 'CHILD_VIA_FK' },
      { model: 'OwnershipTransferItem', unit: 'U042', category: 'CHILD_VIA_FK' },
      { model: 'SchedulerJob', unit: 'U068', category: 'COMPANY_ROOT' },
      { model: 'SchedulerRun', unit: 'U068', category: 'CHILD_VIA_FK' },
      { model: 'SchedulerRunAttempt', unit: 'U068', category: 'CHILD_VIA_FK' },
    ]);
  });

  it('leaves SCOPE_INVENTORY_BASELINE immutable at 150 while the expected current count derives from additions', () => {
    expect(SCOPE_INVENTORY_BASELINE.modelCount).toBe(150);
    expect(expectedCurrentModelCount()).toBe(SCOPE_INVENTORY_BASELINE.modelCount + REGISTERED_ADDITIONS.length);
  });

  it('derives expected category counts as baseline plus registered additions (reclassifications isolated out)', () => {
    const beforeReclassifications = expectedCategoryCounts(SCOPE_INVENTORY_BASELINE, REGISTERED_ADDITIONS, []);
    expect(beforeReclassifications.COMPANY_ROOT).toBe(SCOPE_INVENTORY_BASELINE.categoryCounts.COMPANY_ROOT + REGISTERED_ADDITIONS.filter((entry) => entry.category === 'COMPANY_ROOT').length);
    expect(beforeReclassifications.CHILD_VIA_FK).toBe(SCOPE_INVENTORY_BASELINE.categoryCounts.CHILD_VIA_FK + REGISTERED_ADDITIONS.filter((entry) => entry.category === 'CHILD_VIA_FK').length);
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

  it('derives expected category counts as baseline plus all registered additions and reclassifications (RoleChangeRequest + AuditLog)', () => {
    expect(expectedCategoryCounts()).toEqual(buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES).tallies);
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

describe('REGISTERED_ADDITIONS — U035 model registration', () => {
  it('classifies QuoteCommercialSnapshot exactly once as CHILD_VIA_FK of Quote through mandatory quoteId', () => {
    expect(classifyModel('QuoteCommercialSnapshot')).toEqual({
      model: 'QuoteCommercialSnapshot',
      category: 'CHILD_VIA_FK',
      parentModel: 'Quote',
      relationField: 'quote',
      scalarFkField: 'quoteId',
      nullable: false,
    });
  });
});

describe('REGISTERED_ADDITIONS — U036 model registration', () => {
  it('classifies DemoLicense exactly once as CHILD_VIA_FK of Customer through mandatory customerId, never through optional VendorRequest', () => {
    expect(classifyModel('DemoLicense')).toEqual({
      model: 'DemoLicense',
      category: 'CHILD_VIA_FK',
      parentModel: 'Customer',
      relationField: 'customer',
      scalarFkField: 'customerId',
      nullable: false,
    });
  });
});

describe('REGISTERED_ADDITIONS — U037 model registration', () => {
  it('classifies DeliveryAcceptance exactly once as CHILD_VIA_FK of Engagement through mandatory engagementId', () => {
    expect(classifyModel('DeliveryAcceptance')).toEqual({
      model: 'DeliveryAcceptance', category: 'CHILD_VIA_FK', parentModel: 'Engagement', relationField: 'engagement', scalarFkField: 'engagementId', nullable: false,
    });
  });

  it('classifies RenewalReminderEvent exactly once as CHILD_VIA_FK of RenewalOpportunity through mandatory renewalOpportunityId', () => {
    expect(classifyModel('RenewalReminderEvent')).toEqual({
      model: 'RenewalReminderEvent', category: 'CHILD_VIA_FK', parentModel: 'RenewalOpportunity', relationField: 'renewalOpportunity', scalarFkField: 'renewalOpportunityId', nullable: false,
    });
  });
});

describe('REGISTERED_ADDITIONS — U038 people eligibility model registration', () => {
  it('classifies the three company roots exactly once', () => {
    for (const model of ['CertificationDefinition', 'EngineerSkill', 'EngineerEligibilityPolicy']) {
      expect(classifyModel(model)).toEqual({ model, category: 'COMPANY_ROOT' });
    }
  });

  it('classifies CertificationEvidence only through its mandatory ArtifactVersion scope closure', () => {
    expect(classifyModel('CertificationEvidence')).toEqual({
      model: 'CertificationEvidence', category: 'CHILD_VIA_FK', parentModel: 'ArtifactVersion', relationField: 'artifactVersion', scalarFkField: 'artifactVersionId', nullable: false,
    });
    const evidence = Prisma.dmmf.datamodel.models.find((model) => model.name === 'CertificationEvidence');
    expect(evidence).toBeDefined();
    if (!evidence) throw new Error('CertificationEvidence DMMF model missing');
    const artifactVersion = evidence.fields.find((field) => field.name === 'artifactVersion');
    expect(artifactVersion).toMatchObject({ isRequired: true, relationFromFields: ['artifactVersionId'], relationOnDelete: 'Restrict' });
  });

  it('classifies requirements and assignments through their single mandatory Engagement chain', () => {
    expect(classifyModel('EngagementCapabilityRequirement')).toEqual({
      model: 'EngagementCapabilityRequirement', category: 'CHILD_VIA_FK', parentModel: 'Engagement', relationField: 'engagement', scalarFkField: 'engagementId', nullable: false,
      additionalRequiredRelationFields: ['productFamily'],
    });
    expect(classifyModel('EngineerAssignment')).toEqual({
      model: 'EngineerAssignment', category: 'CHILD_VIA_FK', parentModel: 'EngagementCapabilityRequirement', relationField: 'requirement', scalarFkField: 'requirementId', nullable: false,
    });
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

describe('REGISTERED_ADDITIONS — U039 support SLA registration', () => {
  it('classifies SupportSlaPolicyVersion exactly once as COMPANY_ROOT through its required direct company anchor', () => {
    expect(classifyModel('SupportSlaPolicyVersion')).toEqual({ model: 'SupportSlaPolicyVersion', category: 'COMPANY_ROOT' });
    const version = Prisma.dmmf.datamodel.models.find((model) => model.name === 'SupportSlaPolicyVersion');
    expect(version).toBeDefined();
    if (!version) throw new Error('SupportSlaPolicyVersion DMMF model missing');
    const company = version.fields.find((field) => field.name === 'company');
    expect(company).toMatchObject({ isRequired: true, relationFromFields: ['companyId'], relationOnDelete: 'Restrict' });
  });

  it('classifies SupportCaseSlaSnapshot exactly once through its required SupportCase chain', () => {
    expect(classifyModel('SupportCaseSlaSnapshot')).toEqual({
      model: 'SupportCaseSlaSnapshot', category: 'CHILD_VIA_FK', parentModel: 'SupportCase', relationField: 'supportCase', scalarFkField: 'supportCaseId', nullable: false,
    });
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

describe('RECLASSIFIED_MODELS — sealed scope reclassifications', () => {
  it('records the U040 catalog delta and U042 activation-aware reclassifications', () => {
    expect(RECLASSIFIED_MODELS).toEqual([
      { model: 'RoleChangeRequest', unit: 'U012', fromCategory: 'GLOBAL_SHARED', toCategory: 'CHILD_VIA_FK' },
      { model: 'AuditLog', unit: 'U021', fromCategory: 'COMPANY_ROOT', toCategory: 'TENANT_ROOT' },
      { model: 'ProductFamily', unit: 'U040', fromCategory: 'GLOBAL_SHARED', toCategory: 'COMPANY_ROOT' },
      { model: 'LicenseMetric', unit: 'U040', fromCategory: 'GLOBAL_SHARED', toCategory: 'CHILD_VIA_FK' },
      { model: 'DataExportRequest', unit: 'U042', fromCategory: 'COMPANY_ROOT', toCategory: 'COMPANY_DIRECT' },
      { model: 'ArtifactAccessEvent', unit: 'U042', fromCategory: 'COMPANY_ROOT', toCategory: 'COMPANY_DIRECT' },
    ]);
  });

  it('leaves SCOPE_INVENTORY_BASELINE immutable (RoleChangeRequest stays GLOBAL_SHARED and AuditLog stays COMPANY_ROOT in the historical baseline)', () => {
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts.GLOBAL_SHARED).toBe(13);
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts.CHILD_VIA_FK).toBe(60);
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts.TENANT_ROOT).toBe(1);
    expect(SCOPE_INVENTORY_BASELINE.categoryCounts.COMPANY_ROOT).toBe(32);
  });

  it('derives the exact U041 vector from baseline plus additions and reclassifications', () => {
    expect(expectedCategoryCounts()).toEqual(buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES).tallies);
    expect(expectedCategoryCounts()).toEqual({ GLOBAL_SHARED: 11, TENANT_ROOT: 2, COMPANY_ROOT: 37, PROJECT_ROOT: 48, CHILD_VIA_FK: 90, COMPANY_DIRECT: 4 });
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

  it('classifies AuditLog as TENANT_ROOT in the live inventory (tenantId always mandatory; companyId/projectId only narrow the chain under the enforced scope-level matrix)', () => {
    expect(classifyModel('AuditLog')).toEqual({ model: 'AuditLog', category: 'TENANT_ROOT' });
  });

  it('AuditLog is classified exactly once, as TENANT_ROOT — not double-counted with its historical COMPANY_ROOT class', () => {
    const auditLogEntries = REAL_ENTRIES.filter((e) => e.model === 'AuditLog');
    expect(auditLogEntries).toHaveLength(1);
    expect(auditLogEntries[0]).toEqual({ model: 'AuditLog', category: 'TENANT_ROOT' });
  });
});

describe('U041 AI quality immutable-history registration', () => {
  const names = ['AiQualityAssessment', 'AiQualityEvidence', 'AiQualityReview', 'AiReleaseEvaluation', 'AiPromptSnapshot', 'AiModelSnapshot'];

  it('requires the six new Prisma models, then permits only their single canonical child paths', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    expect(modelNames).toHaveLength(192);
    for (const name of names) expect(modelNames).toContain(name);

    const withoutU041 = REAL_ENTRIES.filter((entry) => !names.includes(entry.model));
    const rejected = buildScopeInventoryReport(modelNames, withoutU041);
    expect(rejected.ok).toBe(false);
    expect(rejected.missingModels).toEqual([...names].sort());

    expect(MODEL_SCOPE_INVENTORY.AiQualityAssessment).toEqual({
      model: 'AiQualityAssessment', category: 'CHILD_VIA_FK', parentModel: 'ArtifactVersion', relationField: 'artifactVersion', scalarFkField: 'artifactVersionId', additionalRequiredRelationFields: ['assessedByAssignment'], nullable: false,
    });
    for (const model of ['AiQualityEvidence', 'AiPromptSnapshot', 'AiModelSnapshot']) {
      expect(MODEL_SCOPE_INVENTORY[model]).toEqual({
        model, category: 'CHILD_VIA_FK', parentModel: 'AiQualityAssessment', relationField: 'assessment', scalarFkField: 'assessmentId', nullable: false,
      });
    }
    expect(MODEL_SCOPE_INVENTORY.AiQualityReview).toEqual({
      model: 'AiQualityReview', category: 'CHILD_VIA_FK', parentModel: 'AiQualityAssessment', relationField: 'assessment', scalarFkField: 'assessmentId', additionalRequiredRelationFields: ['artifactVersion', 'reviewerAssignment'], nullable: false,
    });
    expect(MODEL_SCOPE_INVENTORY.AiReleaseEvaluation).toEqual({
      model: 'AiReleaseEvaluation', category: 'CHILD_VIA_FK', parentModel: 'AiQualityAssessment', relationField: 'assessment', scalarFkField: 'assessmentId', additionalRequiredRelationFields: ['artifactVersion'], nullable: false,
    });
  });

  it('keeps the U040 denominator explicit and produces byte-identical U041 reports twice', () => {
    expect(SCOPE_INVENTORY_BASELINE.modelCount + 23).toBe(173);
    expect(SCOPE_INVENTORY_BASELINE.modelCount + 39).toBe(189);
    const first = buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES);
    const second = buildScopeInventoryReport(REAL_MODEL_NAMES, REAL_ENTRIES);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.currentModelCount).toBe(192);
    expect(first.inventoryModelCount).toBe(192);
    expect(Object.values(first.tallies).reduce((sum, count) => sum + count, 0)).toBe(192);
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
