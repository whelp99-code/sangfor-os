import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

function proof(name: string, value: Record<string, unknown>): void {
  console.info(`U038_PROOF ${JSON.stringify({ name, ...value })}`);
}

const ids = {
  tenant: 'u038-tenant', companyA: 'u038-company-a', companyB: 'u038-company-b', projectA: 'u038-project-a', projectB: 'u038-project-b',
  userSubject: 'u038-user-subject', userVerifier: 'u038-user-verifier', subject: 'u038-subject-membership', verifier: 'u038-verifier-membership', foreign: 'u038-foreign-membership',
  familyA: 'u038-family-a', familyB: 'u038-family-b', opportunityA: 'u038-opportunity-a', opportunityB: 'u038-opportunity-b', engagementA: 'u038-engagement-a', engagementB: 'u038-engagement-b',
  artifactA: 'u038-artifact-a', artifactB: 'u038-artifact-b', artifactVersionA: 'u038-artifact-version-a', artifactVersionB: 'u038-artifact-version-b',
  definition: 'u038-definition-a', certification: 'u038-certification-a', evidence: 'u038-evidence-a', requirement: 'u038-requirement-a',
};

const FIXTURE_SQL = `
SET session_replication_role = replica;
INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u038-tenant', 'U038 Tenant', 'u038-tenant', 'active', now());
INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u038-company-a', 'u038-tenant', 'Company A', 'u038-company-a', now()),
  ('u038-company-b', 'u038-tenant', 'Company B', 'u038-company-b', now());
INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u038-project-a', 'u038-project-a', 'Project A', 'u038-company-a', now(), now()),
  ('u038-project-b', 'u038-project-b', 'Project B', 'u038-company-b', now(), now());
INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u038-user-subject', 'subject@example.test', 'Subject', 'active', now(), now()),
  ('u038-user-verifier', 'verifier@example.test', 'Verifier', 'active', now(), now());
INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u038-subject-membership', 'u038-user-subject', 'u038-company-a', 'support_engineer', 'active', now() - interval '1 day', now()),
  ('u038-verifier-membership', 'u038-user-verifier', 'u038-company-a', 'system_admin', 'active', now() - interval '1 day', now()),
  ('u038-foreign-membership', 'u038-user-verifier', 'u038-company-b', 'system_admin', 'active', now() - interval '1 day', now());
INSERT INTO product_families (id, company_id, family_key, vendor, name) VALUES
  ('u038-family-a', 'u038-company-a', 'U038-A', 'u038', 'Family A'),
  ('u038-family-b', 'u038-company-b', 'U038-B', 'u038', 'Family B');
INSERT INTO opportunities (id, project_id, title, stage, deal_status, ownership_revision, probability, created_at, updated_at) VALUES
  ('u038-opportunity-a', 'u038-project-a', 'Eligibility A', 'LEAD', 'OPEN', 0, 20, now(), now()),
  ('u038-opportunity-b', 'u038-project-b', 'Eligibility B', 'LEAD', 'OPEN', 0, 20, now(), now());
INSERT INTO delivery_projects (id, opportunity_id, name) VALUES
  ('u038-engagement-a', 'u038-opportunity-a', 'Engagement A'),
  ('u038-engagement-b', 'u038-opportunity-b', 'Engagement B');
INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES
  ('u038-artifact-a', 'u038-tenant', 'u038-company-a', 'u038-project-a', 'credential', 'internal', 'human', 'Evidence A', 'u038-verifier-membership', 'u038-verifier-membership', now(), now()),
  ('u038-artifact-b', 'u038-tenant', 'u038-company-b', 'u038-project-b', 'credential', 'internal', 'human', 'Evidence B', 'u038-foreign-membership', 'u038-foreign-membership', now(), now());
INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES
  ('u038-artifact-version-a', 'u038-artifact-a', 1, 'artifact-content/rfc8785-jcs-sha256/v1', '{}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}', 'review_ready', 'u038-verifier-membership', now()),
  ('u038-artifact-version-b', 'u038-artifact-b', 1, 'artifact-content/rfc8785-jcs-sha256/v1', '{}', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{}', 'review_ready', 'u038-foreign-membership', now());
SET session_replication_role = origin;
`;

async function createPendingCertification(id: string) {
  return prisma.engineerCertification.create({ data: {
    id, engineerId: ids.userSubject, productName: 'U038 Certification', level: 'professional', isValid: true,
    definitionId: ids.definition, engineerMembershipId: ids.subject, status: 'pending', revision: 0,
  } });
}

describe.skipIf(!integration)('U038 people credential guards (isolated scratch only)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('U038 verifier must inject DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    for (const statement of FIXTURE_SQL.split(';\n')) {
      const sql = statement.trim();
      if (sql) await prisma.$executeRawUnsafe(`${sql};`);
    }
    await prisma.certificationDefinition.create({ data: {
      id: ids.definition, companyId: ids.companyA, key: 'u038-cert', name: 'U038 Certification', vendorKey: 'u038', productFamilyId: ids.familyA,
      level: 'professional', issuer: 'U038 Issuer', validityDays: 365, status: 'active',
    } });
    await createPendingCertification(ids.certification);
  }, 30_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it('installs every exact U038 trigger and lifecycle check on the scratch schema', async () => {
    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'engineer_certifications_canonical_insert_guard_trg','engineer_certifications_lifecycle_update_guard_trg','engineer_certifications_immutable_delete_trg',
        'certification_evidence_scope_guard_trg','certification_evidence_immutable_update_guard_trg','certification_evidence_immutable_delete_trg'
      ) ORDER BY tgname`,
    );
    const constraints = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint WHERE conname IN (
        'engineer_certifications_status_chk','engineer_certifications_revision_chk','engineer_certifications_lifecycle_chk',
        'certification_definitions_status_chk','certification_definitions_validity_days_chk','certification_evidence_lifecycle_chk',
        'engineer_skills_status_chk','engineer_skills_active_verification_chk','engineer_eligibility_policies_status_chk','engineer_eligibility_policies_values_chk',
        'engagement_capability_requirements_values_chk','engineer_assignments_status_chk','engineer_assignments_lifecycle_chk','engineer_assignments_snapshot_hash_chk'
      ) ORDER BY conname`,
    );
    expect(triggers).toHaveLength(6);
    expect(constraints).toHaveLength(14);
    proof('pg_trigger_and_constraint', { triggers: triggers.map((row) => row.tgname), constraints: constraints.map((row) => row.conname) });
  });

  it('accepts the only canonical pending -> active CAS, then makes evidence revocation and parent revision one transaction', async () => {
    const evidence = await prisma.certificationEvidence.create({ data: {
      id: ids.evidence, certificationId: ids.certification, artifactVersionId: ids.artifactVersionA, issuer: 'U038 Issuer', externalReference: 'issuer-ref',
      verifiedAt: new Date('2026-01-01T00:00:00.000Z'), verifiedByAssignmentId: ids.verifier,
    } });
    const activated = await prisma.engineerCertification.updateMany({
      where: { id: ids.certification, status: 'pending', revision: 0 },
      data: { status: 'active', revision: { increment: 1 }, issuedAt: new Date('2026-01-02T00:00:00.000Z'), expiresAt: new Date('2027-01-02T00:00:00.000Z') },
    });
    expect(activated.count).toBe(1);
    await prisma.$transaction(async (tx) => {
      const certification = await tx.engineerCertification.updateMany({ where: { id: ids.certification, status: 'active', revision: 1 }, data: { revision: { increment: 1 } } });
      expect(certification.count).toBe(1);
      await tx.certificationEvidence.update({ where: { id: evidence.id }, data: { revokedAt: new Date('2026-01-03T00:00:00.000Z') } });
    });
    const receipt = await prisma.engineerCertification.findUniqueOrThrow({ where: { id: ids.certification } });
    const evidenceReceipt = await prisma.certificationEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    expect(receipt).toMatchObject({ status: 'active', revision: 2 });
    expect(evidenceReceipt.revokedAt).not.toBeNull();
    proof('positive_cas_and_evidence_revocation', { activationCount: activated.count, revision: receipt.revision, evidenceRevoked: evidenceReceipt.revokedAt !== null });
  });

  it('rejects stale/replay and every noncanonical certification/evidence rewrite or delete', async () => {
    const stale = await prisma.engineerCertification.updateMany({ where: { id: ids.certification, status: 'active', revision: 1 }, data: { revision: { increment: 1 } } });
    expect(stale.count).toBe(0);
    await expect(prisma.engineerCertification.update({ where: { id: ids.certification }, data: { productName: 'rewritten' } })).rejects.toThrow(/immutable|lifecycle/);
    await expect(prisma.engineerCertification.update({ where: { id: ids.certification }, data: { status: 'pending', revision: 3 } })).rejects.toThrow(/lifecycle/);
    await expect(prisma.engineerCertification.delete({ where: { id: ids.certification } })).rejects.toThrow(/immutable/);
    await expect(prisma.certificationEvidence.update({ where: { id: ids.evidence }, data: { externalReference: 'rewritten' } })).rejects.toThrow(/immutable/);
    await expect(prisma.certificationEvidence.update({ where: { id: ids.evidence }, data: { revokedAt: null } })).rejects.toThrow(/immutable/);
    await expect(prisma.certificationEvidence.delete({ where: { id: ids.evidence } })).rejects.toThrow(/immutable/);
    proof('certification_and_evidence_immutable_negative_fixture', { staleCount: stale.count, certificationRewriteRejected: true, evidenceRewriteRejected: true, evidenceReactivationRejected: true, deletesRejected: true });
  });

  it('rejects evidence outside company scope, self-verification, and future verification time', async () => {
    const pending = await createPendingCertification('u038-certification-negative');
    const create = (data: Record<string, unknown>) => prisma.certificationEvidence.create({ data: {
      id: `u038-evidence-${String(data.id)}`, certificationId: pending.id, artifactVersionId: ids.artifactVersionA, issuer: 'U038 Issuer',
      verifiedAt: new Date('2026-01-01T00:00:00.000Z'), verifiedByAssignmentId: ids.verifier, ...data,
    } as never });
    await expect(create({ id: 'cross-company', artifactVersionId: ids.artifactVersionB })).rejects.toThrow(/scope guard/);
    await expect(create({ id: 'self', verifiedByAssignmentId: ids.subject })).rejects.toThrow(/self-verification|scope guard/);
    await expect(create({ id: 'future', verifiedAt: new Date('2100-01-01T00:00:00.000Z') })).rejects.toThrow(/scope guard/);
    await expect(create({ id: 'issuer', issuer: 'different issuer' })).rejects.toThrow(/scope guard/);
    proof('evidence_scope_negative_fixture', { crossCompanyRejected: true, selfVerifyRejected: true, futureVerifiedAtRejected: true, issuerMismatchRejected: true });
  });

  it('rejects skill, policy, requirement, assignment lifecycle violations and malformed hashes', async () => {
    await expect(prisma.engineerSkill.create({ data: {
      id: 'u038-skill-invalid', companyId: ids.companyA, engineerMembershipId: ids.subject, productFamilyId: ids.familyA, capabilityKey: 'delivery', level: -1, status: 'active',
    } })).rejects.toThrow();
    await expect(prisma.engineerEligibilityPolicy.create({ data: {
      id: 'u038-policy-invalid', companyId: ids.companyA, key: 'invalid', version: 0, productFamilyId: ids.familyA, capabilityKey: 'delivery', minimumSkillLevel: -1,
      status: 'active', contentHash: 'not-a-hash', effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
    } })).rejects.toThrow();
    await expect(prisma.engagementCapabilityRequirement.create({ data: {
      id: 'u038-requirement-invalid', engagementId: ids.engagementA, productFamilyId: ids.familyA, capabilityKey: 'delivery', minimumSkillLevel: -1, headcount: 0,
    } })).rejects.toThrow();
    await prisma.engagementCapabilityRequirement.create({ data: {
      id: ids.requirement, engagementId: ids.engagementA, productFamilyId: ids.familyA, capabilityKey: 'delivery', minimumSkillLevel: 1, headcount: 1,
    } });
    await expect(prisma.engineerAssignment.create({ data: {
      id: 'u038-assignment-invalid', requirementId: ids.requirement, engineerMembershipId: ids.subject, status: 'active', eligibilitySnapshotJson: {}, eligibilitySnapshotHash: 'bad',
      assignedByAssignmentId: ids.verifier, assignedAt: new Date('2026-01-01T00:00:00.000Z'), endedAt: new Date('2026-01-02T00:00:00.000Z'),
    } })).rejects.toThrow();
    proof('lifecycle_and_hash_negative_fixture', { invalidSkillRejected: true, invalidPolicyRejected: true, invalidRequirementRejected: true, invalidAssignmentRejected: true });
  });
});
