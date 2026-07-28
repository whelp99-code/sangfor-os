import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dmmfField, dmmfModel } from './helpers';

const U038_MIGRATION_NAME = '20260716003800_u038_people_eligibility_expand';
const U038_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U038_MIGRATION_NAME, 'migration.sql');

function readU038Migration(): string {
  return readFileSync(U038_MIGRATION_PATH, 'utf8');
}

function uniqueIndex(model: string, fields: string[]): boolean {
  if (fields.length === 1) return dmmfField(model, fields[0]).isUnique;
  return dmmfModel(model).uniqueFields.some((candidate) => candidate.join(',') === fields.join(','));
}

describe('U038 people eligibility schema contract', () => {
  it('adds exactly the six people eligibility models and bridges EngineerCertification through restrictive relations', () => {
    for (const model of [
      'CertificationDefinition',
      'CertificationEvidence',
      'EngineerSkill',
      'EngineerEligibilityPolicy',
      'EngagementCapabilityRequirement',
      'EngineerAssignment',
    ] as const) expect(dmmfModel(model)).toBeDefined();

    for (const field of ['definitionId', 'engineerMembershipId', 'status', 'revokedAt', 'revocationReason', 'revision'] as const) {
      expect(dmmfField('EngineerCertification', field)).toBeDefined();
    }
    expect(dmmfField('EngineerCertification', 'definition').relationOnDelete).toBe('Restrict');
    expect(dmmfField('EngineerCertification', 'engineerMembership').relationOnDelete).toBe('Restrict');
  });

  it('keeps issuer-verifiable evidence status-free and attached to its immutable ArtifactVersion authority', () => {
    for (const field of ['certificationId', 'artifactVersionId', 'issuer', 'verifiedAt', 'verifiedByAssignmentId', 'createdAt'] as const) {
      expect(dmmfField('CertificationEvidence', field).isRequired).toBe(true);
    }
    for (const relation of ['certification', 'artifactVersion', 'verifiedByAssignment'] as const) {
      expect(dmmfField('CertificationEvidence', relation).relationOnDelete).toBe('Restrict');
    }
    const fields = dmmfModel('CertificationEvidence').fields.map((field) => field.name);
    expect(fields).not.toContain('status');
    expect(fields.filter((field) => /(?:contentHash|contentJson|canonicalContentEnvelope|sanitizedText|contentHashVersion)/.test(field))).toEqual([]);
  });

  it('requires canonical lifecycle/value fields, restrictive references, and hand-written schema indexes', () => {
    for (const [model, fields] of [
      ['CertificationDefinition', ['companyId', 'key', 'name', 'vendorKey', 'issuer', 'status', 'createdAt', 'updatedAt']],
      ['EngineerSkill', ['companyId', 'engineerMembershipId', 'productFamilyId', 'capabilityKey', 'level', 'status', 'createdAt', 'updatedAt']],
      ['EngineerEligibilityPolicy', ['companyId', 'key', 'version', 'capabilityKey', 'minimumSkillLevel', 'status', 'contentHash', 'effectiveAt', 'createdAt']],
      ['EngagementCapabilityRequirement', ['engagementId', 'productFamilyId', 'capabilityKey', 'minimumSkillLevel', 'headcount', 'createdAt']],
      ['EngineerAssignment', ['requirementId', 'engineerMembershipId', 'status', 'eligibilitySnapshotJson', 'eligibilitySnapshotHash', 'assignedByAssignmentId', 'assignedAt', 'createdAt']],
    ] as const) {
      for (const field of fields) expect(dmmfField(model, field).isRequired).toBe(true);
    }
    for (const [model, relation] of [
      ['CertificationDefinition', 'company'], ['CertificationDefinition', 'productFamily'],
      ['EngineerSkill', 'company'], ['EngineerSkill', 'engineerMembership'], ['EngineerSkill', 'productFamily'], ['EngineerSkill', 'sourceArtifactVersion'], ['EngineerSkill', 'verifiedByAssignment'],
      ['EngineerEligibilityPolicy', 'company'], ['EngineerEligibilityPolicy', 'productFamily'], ['EngineerEligibilityPolicy', 'certificationDefinition'],
      ['EngagementCapabilityRequirement', 'engagement'], ['EngagementCapabilityRequirement', 'eligibilityPolicy'], ['EngagementCapabilityRequirement', 'productFamily'], ['EngagementCapabilityRequirement', 'certificationDefinition'],
      ['EngineerAssignment', 'requirement'], ['EngineerAssignment', 'engineerMembership'], ['EngineerAssignment', 'assignedByAssignment'],
    ] as const) expect(dmmfField(model, relation).relationOnDelete).toBe('Restrict');
    expect(uniqueIndex('CertificationDefinition', ['companyId', 'key'])).toBe(true);
    expect(uniqueIndex('EngineerEligibilityPolicy', ['companyId', 'key', 'version'])).toBe(true);
  });

  it('contains every named U038 check and guard in the formal migration', () => {
    const sql = readU038Migration();
    for (const name of [
      'engineer_certifications_status_chk', 'engineer_certifications_revision_chk', 'engineer_certifications_lifecycle_chk',
      'certification_definitions_status_chk', 'certification_definitions_validity_days_chk', 'certification_evidence_lifecycle_chk',
      'engineer_skills_status_chk', 'engineer_skills_active_verification_chk', 'engineer_eligibility_policies_status_chk', 'engineer_eligibility_policies_values_chk',
      'engagement_capability_requirements_values_chk', 'engineer_assignments_status_chk', 'engineer_assignments_lifecycle_chk', 'engineer_assignments_snapshot_hash_chk',
    ]) expect(sql).toContain(`CONSTRAINT "${name}"`);
    for (const name of [
      'engineer_certifications_canonical_insert_guard_trg', 'engineer_certifications_lifecycle_update_guard_trg', 'engineer_certifications_immutable_delete_trg',
      'certification_evidence_scope_guard_trg', 'certification_evidence_immutable_update_guard_trg', 'certification_evidence_immutable_delete_trg',
    ]) expect(sql.split(`CREATE TRIGGER ${name}`).length).toBe(2);
    for (const name of [
      'certification_definitions_company_id_key_key', 'certification_evidence_certification_id_idx', 'certification_evidence_artifact_version_id_idx',
      'engineer_skills_company_id_engineer_membership_id_idx', 'engineer_eligibility_policies_company_id_key_version_key',
      'engagement_capability_requirements_engagement_id_idx', 'engineer_assignments_requirement_id_engineer_membership_id_key',
    ]) expect(sql).toContain(`"${name}"`);
  });
});
