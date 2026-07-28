import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_SCOPE_INVENTORY, buildScopeInventoryReport } from '../scope-inventory';
import { dmmfField, dmmfModel } from './helpers';

const U039_MIGRATION_NAME = '20260716003900_u039_support_sla_rca_expand';
const U039_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U039_MIGRATION_NAME, 'migration.sql');

function readU039Migration(): string {
  return readFileSync(U039_MIGRATION_PATH, 'utf8');
}

describe('U039 support SLA, escalation, and RCA schema contract', () => {
  it('exposes company-anchored immutable SLA versions and exact case SLA snapshots', () => {
    const policy = dmmfModel('SupportSlaPolicy');
    for (const field of ['companyId', 'policyKey', 'currentVersionId', 'archivedAt']) {
      expect(dmmfField('SupportSlaPolicy', field).isRequired).toBe(false);
    }
    expect(policy.fields.find((field) => field.name === 'company')?.relationOnDelete).toBe('Restrict');

    const version = dmmfModel('SupportSlaPolicyVersion');
    for (const field of ['companyId', 'policyId', 'version', 'severity', 'responseMinutes', 'resolutionMinutes', 'clockKind', 'contentHash', 'effectiveAt', 'createdAt']) {
      expect(dmmfField('SupportSlaPolicyVersion', field).isRequired).toBe(true);
    }
    expect(dmmfField('SupportSlaPolicyVersion', 'clockKind').default).toBe('elapsed_24x7');
    expect(dmmfField('SupportSlaPolicyVersion', 'company').relationOnDelete).toBe('Restrict');
    expect(dmmfField('SupportSlaPolicyVersion', 'policy').relationOnDelete).toBe('Restrict');
    expect(version.uniqueFields).toContainEqual(['id', 'companyId']);

    const snapshot = dmmfModel('SupportCaseSlaSnapshot');
    for (const field of ['supportCaseId', 'policyVersionId', 'severity', 'responseMinutes', 'resolutionMinutes', 'clockKind', 'startedAt', 'responseDueAt', 'resolutionDueAt', 'snapshotHash', 'createdAt']) {
      expect(dmmfField('SupportCaseSlaSnapshot', field).isRequired).toBe(true);
    }
    expect(dmmfField('SupportCaseSlaSnapshot', 'supportCase').relationOnDelete).toBe('Restrict');
    expect(dmmfField('SupportCaseSlaSnapshot', 'policyVersion').relationOnDelete).toBe('Restrict');
    expect(dmmfField('SupportCaseSlaSnapshot', 'supportCaseId').isUnique).toBe(true);
  });

  it('adds independent support-case owner and domain revision counters with Restrict provenance', () => {
    for (const field of ['assetId', 'ownerAssignmentId', 'rcaArtifactVersionId', 'rcaRequiredAt', 'respondedAt', 'resolvedAt', 'closedAt', 'createdAt', 'updatedAt']) {
      expect(dmmfField('SupportCase', field)).toBeDefined();
    }
    for (const field of ['ownershipRevision', 'revision']) {
      const counter = dmmfField('SupportCase', field);
      expect(counter).toMatchObject({ type: 'Int', isRequired: true, default: 0 });
    }
    for (const relation of ['customer', 'asset', 'ownerAssignment', 'rcaArtifactVersion'] as const) {
      expect(dmmfField('SupportCase', relation).relationOnDelete).toBe('Restrict');
    }
  });

  it('pairs vendor escalation only with restrictive internal provenance and its own domain revision', () => {
    for (const field of ['vendorRequestId', 'revision', 'externalReference', 'submittedAt', 'resolvedAt', 'submissionEvidenceArtifactVersionId', 'createdAt', 'updatedAt']) {
      expect(dmmfField('VendorEscalation', field)).toBeDefined();
    }
    expect(dmmfField('VendorEscalation', 'revision')).toMatchObject({ type: 'Int', isRequired: true, default: 0 });
    for (const relation of ['supportCase', 'vendorRequest', 'submissionEvidenceArtifactVersion'] as const) {
      expect(dmmfField('VendorEscalation', relation).relationOnDelete).toBe('Restrict');
    }
    expect(dmmfField('VendorEscalation', 'vendorRequestId').isUnique).toBe(true);
  });

  it('installs the exact deferred checks, FKs, and single named owner/pair guards', () => {
    const sql = readU039Migration();
    for (const name of [
      'support_sla_policies_company_required_chk', 'support_sla_policy_versions_policy_company_fkey',
      'support_sla_policy_versions_values_chk', 'support_case_sla_snapshots_values_chk',
      'vendor_escalations_status_chk', 'vendor_escalations_revision_chk', 'vendor_escalations_terminal_resolved_at_chk',
    ]) expect(sql).toContain(`"${name}"`);
    expect(sql).toContain('FOREIGN KEY ("policy_id", "company_id") REFERENCES "support_sla_policies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID');
    expect(sql).toContain("'draft', 'manually_submitted', 'waiting_vendor', 'approved', 'rejected', 'cancelled', 'completed'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.support_cases_owner_scope_guard_fn()');
    expect(sql.match(/CREATE TRIGGER support_cases_owner_scope_guard_trg/g)).toHaveLength(1);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.vendor_escalations_pair_state_guard_fn()');
    expect(sql.match(/CREATE TRIGGER vendor_escalations_pair_state_guard_trg/g)).toHaveLength(1);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.support_sla_policy_versions_immutable_guard_fn()');
  });

  it('proves the unmodified inventory checker rejects both additions until classified, then permits only their canonical paths', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    const unclassified = Object.values(MODEL_SCOPE_INVENTORY).filter((entry) => !['SupportSlaPolicyVersion', 'SupportCaseSlaSnapshot'].includes(entry.model));
    const rejected = buildScopeInventoryReport(modelNames, unclassified);
    expect(rejected.ok).toBe(false);
    expect(rejected.missingModels).toEqual(['SupportCaseSlaSnapshot', 'SupportSlaPolicyVersion']);
    expect(MODEL_SCOPE_INVENTORY.SupportSlaPolicyVersion).toEqual({ model: 'SupportSlaPolicyVersion', category: 'COMPANY_ROOT' });
    expect(MODEL_SCOPE_INVENTORY.SupportCaseSlaSnapshot).toEqual({ model: 'SupportCaseSlaSnapshot', category: 'CHILD_VIA_FK', parentModel: 'SupportCase', relationField: 'supportCase', scalarFkField: 'supportCaseId', nullable: false });
  });
});
