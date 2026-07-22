import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

function proof(name: string, value: Record<string, unknown>): void {
  console.info(`U039_PROOF ${JSON.stringify({ name, ...value })}`);
}

const ids = {
  tenant: 'u039-tenant', companyA: 'u039-company-a', companyB: 'u039-company-b', projectA: 'u039-project-a', projectB: 'u039-project-b',
  customerA: 'u039-customer-a', customerB: 'u039-customer-b', assetA: 'u039-asset-a',
  ownerA: 'u039-owner-a', ownerA2: 'u039-owner-a2', ownerB: 'u039-owner-b', inactive: 'u039-owner-inactive', expired: 'u039-owner-expired', revoked: 'u039-owner-revoked',
  caseA: 'u039-case-a', casePair: 'u039-case-pair', artifact: 'u039-artifact-a', artifactVersion: 'u039-artifact-version-a',
  policy: 'u039-policy-a', version: 'u039-policy-version-a', vendorRequest: 'u039-vendor-request-a', vendorRequestB: 'u039-vendor-request-b', escalation: 'u039-escalation-a',
};

const HASH = 'a'.repeat(64);
const FIXTURE_SQL = `
INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u039-tenant', 'U039 Tenant', 'u039-tenant', 'active', now());
INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u039-company-a', 'u039-tenant', 'Company A', 'u039-company-a', now()),
  ('u039-company-b', 'u039-tenant', 'Company B', 'u039-company-b', now());
INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u039-project-a', 'u039-project-a', 'Project A', 'u039-company-a', now(), now()),
  ('u039-project-b', 'u039-project-b', 'Project B', 'u039-company-b', now(), now());
INSERT INTO customers (id, project_id, name, created_at, updated_at) VALUES
  ('u039-customer-a', 'u039-project-a', 'Customer A', now(), now()),
  ('u039-customer-b', 'u039-project-b', 'Customer B', now(), now());
INSERT INTO customer_assets (id, customer_id, asset_type, name, status, created_at, updated_at) VALUES
  ('u039-asset-a', 'u039-customer-a', 'appliance', 'U039 Asset', 'active', now(), now());
INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u039-user-a', 'u039-a@example.test', 'User A', 'active', now(), now()),
  ('u039-user-b', 'u039-b@example.test', 'User B', 'active', now(), now());
INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u039-owner-a', 'u039-user-a', 'u039-company-a', 'support_engineer', 'active', now() - interval '1 day', now()),
  ('u039-owner-a2', 'u039-user-b', 'u039-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u039-owner-b', 'u039-user-b', 'u039-company-b', 'support_engineer', 'active', now() - interval '1 day', now()),
  ('u039-owner-inactive', 'u039-user-b', 'u039-company-a', 'sales_manager', 'legacy_pending', now() - interval '1 day', now()),
  ('u039-owner-expired', 'u039-user-b', 'u039-company-a', 'finance_manager', 'active', now() - interval '1 day', now()),
  ('u039-owner-revoked', 'u039-user-b', 'u039-company-a', 'presales_engineer', 'active', now() - interval '1 day', now());
UPDATE user_company_roles SET expires_at = now() - interval '1 second' WHERE id = 'u039-owner-expired';
UPDATE user_company_roles SET status = 'revoked', revoked_at = now() - interval '1 second' WHERE id = 'u039-owner-revoked';
SET session_replication_role = replica;
INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, ownership_revision, current_revision, created_at, updated_at)
  VALUES ('u039-artifact-a', 'u039-tenant', 'u039-company-a', 'u039-project-a', 'rca', 'internal', 'human', 'U039 RCA', 'u039-owner-a', 'u039-owner-a', 0, 0, now(), now());
INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
  VALUES ('u039-artifact-version-a', 'u039-artifact-a', 1, 'artifact-content/rfc8785-jcs-sha256/v1', 'u039-envelope', '${HASH}', '{}'::jsonb, 'human_draft', 'u039-owner-a', now());
SET session_replication_role = origin;
`;

describe.skipIf(!integration)('U039 support owner, SLA, escalation, and RCA guards (isolated scratch only)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('U039 verifier must inject DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    for (const statement of FIXTURE_SQL.split(';\n')) {
      const sql = statement.trim();
      if (sql) await prisma.$executeRawUnsafe(`${sql};`);
    }
    await prisma.supportCase.create({ data: { id: ids.caseA, customerId: ids.customerA, assetId: ids.assetA, ownerAssignmentId: ids.ownerA, subject: 'SLA and RCA case' } });
    await prisma.supportCase.create({ data: { id: ids.casePair, customerId: ids.customerA, ownerAssignmentId: ids.ownerA, subject: 'paired escalation case' } });
  }, 30_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it('installs the exact support checks, Restrict FKs, and one each of the named guards', async () => {
    const checks = await prisma.$queryRawUnsafe<Array<{ conname: string; convalidated: boolean }>>(
      `SELECT conname, convalidated FROM pg_constraint WHERE conname IN (
        'support_sla_policies_company_required_chk','support_sla_policy_versions_values_chk','support_case_sla_snapshots_values_chk',
        'vendor_escalations_status_chk','vendor_escalations_revision_chk','vendor_escalations_terminal_resolved_at_chk'
      ) ORDER BY conname`,
    );
    expect(checks).toHaveLength(6);
    expect(checks.every((row) => row.convalidated === false)).toBe(true);
    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'support_cases_owner_scope_guard_trg','vendor_escalations_pair_state_guard_trg',
        'support_sla_policy_versions_immutable_update_trg','support_sla_policy_versions_immutable_delete_trg'
      ) ORDER BY tgname`,
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'support_cases_owner_scope_guard_trg', 'support_sla_policy_versions_immutable_delete_trg',
      'support_sla_policy_versions_immutable_update_trg', 'vendor_escalations_pair_state_guard_trg',
    ]);
    const restrict = await prisma.$queryRawUnsafe<Array<{ conname: string; confdeltype: string }>>(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN (
        'support_cases_customer_id_fkey','support_cases_asset_id_fkey','support_cases_owner_assignment_id_fkey','support_cases_rca_artifact_version_id_fkey',
        'support_case_sla_snapshots_support_case_id_fkey','support_case_sla_snapshots_policy_version_id_fkey',
        'vendor_escalations_case_id_fkey','vendor_escalations_vendor_request_id_fkey','vendor_escalations_submission_evidence_artifact_version_id_fkey'
      )`,
    );
    expect(restrict).toHaveLength(9);
    expect(restrict.every((row) => row.confdeltype === 'r')).toBe(true);
    proof('pg_checks_triggers_fks', { checks, triggers: triggers.map((row) => row.tgname), restrictFkCount: restrict.length });
  });

  it('enforces company-anchored, positive, immutable SLA policy versions and exact case snapshots', async () => {
    await expect(prisma.supportSlaPolicy.create({ data: { id: 'u039-policy-null-company', name: 'legacy write prohibited' } })).rejects.toThrow();
    await prisma.supportSlaPolicy.create({ data: { id: ids.policy, companyId: ids.companyA, policyKey: 'u039', name: 'U039 canonical SLA' } });
    await expect(prisma.supportSlaPolicyVersion.create({ data: {
      id: 'u039-version-negative', companyId: ids.companyA, policyId: ids.policy, version: 1, severity: 'high', responseMinutes: 0, resolutionMinutes: 30, contentHash: HASH, effectiveAt: new Date(),
    } })).rejects.toThrow();
    const version = await prisma.supportSlaPolicyVersion.create({ data: {
      id: ids.version, companyId: ids.companyA, policyId: ids.policy, version: 1, severity: 'high', responseMinutes: 15, resolutionMinutes: 60, vendorEscalationMinutes: 30, customerUpdateMinutes: 20, contentHash: HASH, effectiveAt: new Date(),
    } });
    await expect(prisma.supportSlaPolicyVersion.update({ where: { id: version.id }, data: { severity: 'critical' } })).rejects.toThrow(/immutable/);
    await prisma.supportSlaPolicyVersion.update({ where: { id: version.id }, data: { retiredAt: new Date() } });
    await expect(prisma.supportSlaPolicyVersion.update({ where: { id: version.id }, data: { retiredAt: new Date(Date.now() + 1_000) } })).rejects.toThrow(/immutable/);
    await expect(prisma.supportCaseSlaSnapshot.create({ data: {
      id: 'u039-snapshot-bad', supportCaseId: ids.caseA, policyVersionId: ids.version, severity: 'high', responseMinutes: 15, resolutionMinutes: 60, clockKind: 'elapsed_24x7', startedAt: new Date(), responseDueAt: new Date(), resolutionDueAt: new Date(), snapshotHash: 'not-a-hash',
    } })).rejects.toThrow();
    const startedAt = new Date();
    const snapshot = await prisma.supportCaseSlaSnapshot.create({ data: {
      id: 'u039-snapshot-a', supportCaseId: ids.caseA, policyVersionId: ids.version, severity: 'high', responseMinutes: 15, resolutionMinutes: 60, vendorEscalationMinutes: 30, customerUpdateMinutes: 20, clockKind: 'elapsed_24x7', startedAt, responseDueAt: new Date(startedAt.getTime() + 15 * 60_000), resolutionDueAt: new Date(startedAt.getTime() + 60 * 60_000), snapshotHash: 'b'.repeat(64),
    } });
    expect(snapshot.supportCaseId).toBe(ids.caseA);
    proof('sla_version_and_snapshot_negative_fixtures', { nullCompanyRejected: true, nonPositiveMinutesRejected: true, immutableRewriteRejected: true, invalidSnapshotHashRejected: true, snapshotId: snapshot.id });
  });

  it.each(['u039-owner-b', 'u039-owner-inactive', 'u039-owner-expired', 'u039-owner-revoked', 'u039-owner-missing'])('rejects foreign, inactive, expired, revoked, and nonexistent case owners: %s', async (ownerAssignmentId) => {
    await expect(prisma.supportCase.create({ data: { id: `u039-invalid-${ownerAssignmentId}`, customerId: ids.customerA, ownerAssignmentId, subject: 'invalid owner' } })).rejects.toThrow(/owner assignment|Foreign key/);
    proof('case_owner_negative_fixture', { ownerAssignmentId, rejected: true });
  });

  it('keeps case owner and state/RCA CAS counters independent and preserves immutable attribution', async () => {
    const stale = await prisma.supportCase.updateMany({ where: { id: ids.caseA, ownerAssignmentId: ids.ownerA, ownershipRevision: 7 }, data: { ownerAssignmentId: ids.ownerA2, ownershipRevision: { increment: 1 } } });
    expect(stale.count).toBe(0);
    const owner = await prisma.supportCase.updateMany({ where: { id: ids.caseA, ownerAssignmentId: ids.ownerA, ownershipRevision: 0 }, data: { ownerAssignmentId: ids.ownerA2, ownershipRevision: { increment: 1 } } });
    expect(owner.count).toBe(1);
    expect(await prisma.supportCase.findUniqueOrThrow({ where: { id: ids.caseA } })).toMatchObject({ ownershipRevision: 1, revision: 0, ownerAssignmentId: ids.ownerA2 });
    const state = await prisma.supportCase.updateMany({ where: { id: ids.caseA, revision: 0 }, data: { status: 'resolved', rcaArtifactVersionId: ids.artifactVersion, resolvedAt: new Date(), revision: { increment: 1 } } });
    expect(state.count).toBe(1);
    const receipt = await prisma.supportCase.findUniqueOrThrow({ where: { id: ids.caseA } });
    expect(receipt).toMatchObject({ ownershipRevision: 1, revision: 1, rcaArtifactVersionId: ids.artifactVersion });
    const replay = await prisma.supportCase.updateMany({ where: { id: ids.caseA, revision: 0 }, data: { status: 'resolved', revision: { increment: 1 } } });
    expect(replay.count).toBe(0);
    await expect(prisma.supportCase.update({ where: { id: ids.caseA }, data: { ownerAssignmentId: ids.ownerA, ownershipRevision: { increment: 1 }, revision: { increment: 1 } } })).rejects.toThrow(/owner reassignment/);
    await expect(prisma.supportCase.update({ where: { id: ids.caseA }, data: { ownerAssignmentId: ids.ownerA, ownershipRevision: { increment: 1 }, subject: 'rewritten attribution' } })).rejects.toThrow(/owner reassignment/);
    proof('case_dual_cas_and_rca', { staleOwnerCount: stale.count, ownerMutationCount: owner.count, stateRcaMutationCount: state.count, replayCount: replay.count, receipt: { ownershipRevision: receipt.ownershipRevision, revision: receipt.revision, rcaArtifactVersionId: receipt.rcaArtifactVersionId } });
  });

  it('enforces paired VendorRequest status/revision/project rules and terminal resolvedAt immutability', async () => {
    await prisma.vendorRequest.create({ data: { id: ids.vendorRequest, customerId: ids.customerA, requestType: 'support', vendorName: 'vendor', detailsJson: {}, createdBy: 'u039', status: 'ready_for_manual_submission', revision: 0 } });
    await prisma.vendorRequest.create({ data: { id: ids.vendorRequestB, customerId: ids.customerB, requestType: 'support', vendorName: 'vendor', detailsJson: {}, createdBy: 'u039', status: 'ready_for_manual_submission', revision: 0 } });
    await expect(prisma.vendorEscalation.create({ data: { id: 'u039-escalation-status-bad', caseId: ids.casePair, vendorRequestId: ids.vendorRequest, vendor: 'vendor', reason: 'bad map', status: 'waiting_vendor' } })).rejects.toThrow(/status/);
    await expect(prisma.vendorEscalation.create({ data: { id: 'u039-escalation-revision-bad', caseId: ids.casePair, vendorRequestId: ids.vendorRequest, vendor: 'vendor', reason: 'bad revision', status: 'draft', revision: 1 } })).rejects.toThrow(/revision/);
    await expect(prisma.vendorEscalation.create({ data: { id: 'u039-escalation-project-bad', caseId: ids.casePair, vendorRequestId: ids.vendorRequestB, vendor: 'vendor', reason: 'cross project', status: 'draft' } })).rejects.toThrow(/cross-project|foreign/);
    await expect(prisma.vendorEscalation.create({ data: { id: 'u039-escalation-terminal-bad', caseId: ids.casePair, vendor: 'vendor', reason: 'terminal missing time', status: 'approved' } })).rejects.toThrow();
    await prisma.vendorEscalation.create({ data: { id: ids.escalation, caseId: ids.casePair, vendorRequestId: ids.vendorRequest, vendor: 'vendor', reason: 'canonical pair', status: 'draft', revision: 0 } });
    await prisma.vendorRequest.update({ where: { id: ids.vendorRequest }, data: { status: 'approved', revision: { increment: 1 } } });
    const terminal = await prisma.vendorEscalation.update({ where: { id: ids.escalation }, data: { status: 'approved', revision: { increment: 1 }, resolvedAt: new Date() } });
    await expect(prisma.vendorEscalation.update({ where: { id: ids.escalation }, data: { resolvedAt: new Date(Date.now() + 1_000) } })).rejects.toThrow(/terminal/);
    await expect(prisma.vendorEscalation.update({ where: { id: ids.escalation }, data: { status: 'waiting_vendor', resolvedAt: null } })).rejects.toThrow(/terminal/);
    proof('vendor_pair_negative_fixtures', { statusMismatchRejected: true, revisionMismatchRejected: true, crossProjectRejected: true, terminalNullRejected: true, terminalRevision: terminal.revision, terminalResolvedAtImmutable: true });
  });
});
