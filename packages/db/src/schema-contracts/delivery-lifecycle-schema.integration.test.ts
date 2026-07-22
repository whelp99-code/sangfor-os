import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

function proof(name: string, value: Record<string, unknown>): void {
  console.info(`U037_PROOF ${JSON.stringify({ name, ...value })}`);
}

const ids = {
  tenant: 'u037-tenant', companyA: 'u037-company-a', companyB: 'u037-company-b', project: 'u037-project-a',
  customer: 'u037-customer-a', opportunity: 'u037-opportunity-a', quote: 'u037-quote-a', engagement: 'u037-engagement-a',
  artifact: 'u037-artifact-a', artifactVersion: 'u037-artifact-version-a', asset: 'u037-asset-a', subscription: 'u037-subscription-a',
  renewal: 'u037-renewal-a', ownerA: 'u037-owner-a', ownerA2: 'u037-owner-a2',
};

const FIXTURE_SQL = `
SET session_replication_role = replica;
INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u037-tenant', 'U037 Tenant', 'u037-tenant', 'active', now());
INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u037-company-a', 'u037-tenant', 'Company A', 'u037-company-a', now()),
  ('u037-company-b', 'u037-tenant', 'Company B', 'u037-company-b', now());
INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u037-project-a', 'u037-project-a', 'Project A', 'u037-company-a', now(), now());
INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u037-user-a', 'u037-a@example.test', 'User A', 'active', now(), now()),
  ('u037-user-b', 'u037-b@example.test', 'User B', 'active', now(), now());
INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u037-owner-a', 'u037-user-a', 'u037-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u037-owner-a2', 'u037-user-b', 'u037-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u037-owner-foreign', 'u037-user-b', 'u037-company-b', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u037-owner-inactive', 'u037-user-b', 'u037-company-a', 'support_engineer', 'legacy_pending', now() - interval '1 day', now()),
  ('u037-owner-expired', 'u037-user-b', 'u037-company-a', 'finance_manager', 'active', now() - interval '1 day', now()),
  ('u037-owner-revoked', 'u037-user-b', 'u037-company-a', 'sales_manager', 'active', now() - interval '1 day', now());
UPDATE user_company_roles SET expires_at = now() - interval '1 second' WHERE id = 'u037-owner-expired';
UPDATE user_company_roles SET status = 'revoked', revoked_at = now() - interval '1 second' WHERE id = 'u037-owner-revoked';
INSERT INTO customers (id, project_id, name, created_at, updated_at) VALUES ('u037-customer-a', 'u037-project-a', 'Customer A', now(), now());
INSERT INTO opportunities (id, project_id, customer_id, title, stage, deal_status, ownership_revision, probability, created_at, updated_at) VALUES
  ('u037-opportunity-a', 'u037-project-a', 'u037-customer-a', 'Renewal source', 'LEAD', 'OPEN', 0, 20, now(), now()),
  ('u037-opportunity-b', 'u037-project-a', 'u037-customer-a', 'Acceptance duplicate source', 'LEAD', 'OPEN', 0, 20, now(), now());
INSERT INTO quotes (id, opportunity_id, company_id, status, version, total_revenue, total_cost, margin_pct, created_by, created_at) VALUES
  ('u037-quote-a', 'u037-opportunity-a', 'u037-company-a', 'draft', 1, 100, 60, 40, 'u037-legacy', now());
INSERT INTO delivery_projects (id, opportunity_id, name) VALUES
  ('u037-engagement-a', 'u037-opportunity-a', 'Acceptance A'),
  ('u037-engagement-b', 'u037-opportunity-b', 'Acceptance B');
INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES
  ('u037-artifact-a', 'u037-tenant', 'u037-company-a', 'u037-project-a', 'delivery', 'internal', 'human', 'Acceptance artifact', 'u037-owner-a', 'u037-owner-a', now(), now());
INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES
  ('u037-artifact-version-a', 'u037-artifact-a', 1, 'artifact-content/rfc8785-jcs-sha256/v1', '{}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}', 'review_ready', 'u037-owner-a', now());
INSERT INTO product_families (id, company_id, family_key, vendor, name) VALUES ('u037-family-a', 'u037-company-a', 'U037-FAMILY', 'u037', 'U037 Family');
INSERT INTO product_editions (id, family_id, edition_key, name, version) VALUES ('u037-edition-a', 'u037-family-a', 'U037-EDITION', 'U037 Edition', '1');
INSERT INTO product_skus (id, edition_id, sku_code, name) VALUES ('u037-sku-a', 'u037-edition-a', 'U037-SKU', 'U037 SKU');
SET session_replication_role = origin;
`;

describe.skipIf(!integration)('U037 delivery acceptance and renewal owner guards (isolated scratch only)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('U037 verifier must inject DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    for (const statement of FIXTURE_SQL.split(';\n')) {
      const sql = statement.trim();
      if (sql) await prisma.$executeRawUnsafe(`${sql};`);
    }
    await prisma.customerAsset.create({ data: { id: ids.asset, customerId: ids.customer, assetType: 'subscription_product', name: 'U037 asset' } });
    await prisma.subscription.create({ data: {
      id: ids.subscription, assetId: ids.asset, skuId: 'u037-sku-a', startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2027-01-01T00:00:00.000Z'),
    } });
    await prisma.renewalOpportunity.create({ data: {
      id: ids.renewal, customerId: ids.customer, assetId: ids.asset, subscriptionId: ids.subscription, opportunityId: ids.opportunity,
      renewalType: 'subscription', ownerAssignmentId: ids.ownerA, idempotencyKey: 'u037-renewal-source',
    } });
  }, 30_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it('installs exactly one named renewal owner guard and all immutable-history triggers', async () => {
    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('renewal_opportunities_owner_scope_guard_trg','delivery_acceptances_immutable_update_trg','delivery_acceptances_immutable_delete_trg','renewal_reminder_events_immutable_update_trg','renewal_reminder_events_immutable_delete_trg') ORDER BY tgname`,
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'delivery_acceptances_immutable_delete_trg', 'delivery_acceptances_immutable_update_trg', 'renewal_opportunities_owner_scope_guard_trg', 'renewal_reminder_events_immutable_delete_trg', 'renewal_reminder_events_immutable_update_trg',
    ]);
    const guardCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'renewal_opportunities'::regclass AND tgname = 'renewal_opportunities_owner_scope_guard_trg'`,
    );
    expect(guardCount[0].count).toBe(1n);
    proof('pg_trigger', { triggers: triggers.map((row) => row.tgname), ownerGuardCount: Number(guardCount[0].count) });
  });

  it.each(['u037-owner-foreign', 'u037-owner-inactive', 'u037-owner-expired', 'u037-owner-revoked', 'u037-owner-missing'])('rejects foreign, inactive, expired, revoked, and nonexistent renewal owners: %s', async (ownerAssignmentId) => {
    await expect(prisma.renewalOpportunity.create({ data: {
      id: `u037-invalid-${ownerAssignmentId}`, customerId: ids.customer, renewalType: 'subscription', ownerAssignmentId,
    } })).rejects.toThrow(/owner assignment|Foreign key/);
    proof('owner_scope_negative_fixture', { ownerAssignmentId, rejected: true });
  });

  it('uses the exact owner CAS, increments only ownershipRevision once, and leaves stale/replay attempts untouched', async () => {
    const stale = await prisma.renewalOpportunity.updateMany({
      where: { id: ids.renewal, ownerAssignmentId: ids.ownerA, ownershipRevision: 7 },
      data: { ownerAssignmentId: ids.ownerA2, ownershipRevision: { increment: 1 } },
    });
    expect(stale.count).toBe(0);
    const changed = await prisma.renewalOpportunity.updateMany({
      where: { id: ids.renewal, ownerAssignmentId: ids.ownerA, ownershipRevision: 0 },
      data: { ownerAssignmentId: ids.ownerA2, ownershipRevision: { increment: 1 } },
    });
    expect(changed.count).toBe(1);
    const receipt = await prisma.renewalOpportunity.findUniqueOrThrow({ where: { id: ids.renewal } });
    expect(receipt).toMatchObject({ ownerAssignmentId: ids.ownerA2, ownershipRevision: 1, assetId: ids.asset, subscriptionId: ids.subscription, opportunityId: ids.opportunity, idempotencyKey: 'u037-renewal-source' });
    const replay = await prisma.renewalOpportunity.updateMany({
      where: { id: ids.renewal, ownerAssignmentId: ids.ownerA, ownershipRevision: 0 },
      data: { ownerAssignmentId: ids.ownerA2, ownershipRevision: { increment: 1 } },
    });
    expect(replay.count).toBe(0);
    proof('owner_cas', { staleCount: stale.count, changedCount: changed.count, replayCount: replay.count, ownershipRevision: receipt.ownershipRevision });
  });

  it('cannot rewrite renewal source attribution or reminder-event history during reassignment', async () => {
    await expect(prisma.renewalOpportunity.update({
      where: { id: ids.renewal }, data: { ownerAssignmentId: ids.ownerA, ownershipRevision: { increment: 1 }, assetId: 'rewritten-source' },
    })).rejects.toThrow(/source and creation attribution|may change only/);
    await prisma.renewalReminderEvent.create({ data: { id: 'u037-reminder-a', renewalOpportunityId: ids.renewal, thresholdDays: 90, idempotencyKey: 'u037-reminder-90' } });
    await expect(prisma.renewalReminderEvent.update({ where: { id: 'u037-reminder-a' }, data: { thresholdDays: 60 } })).rejects.toThrow(/immutable/);
    await expect(prisma.renewalReminderEvent.delete({ where: { id: 'u037-reminder-a' } })).rejects.toThrow(/immutable/);
    proof('immutable_source_and_event_history', { sourceRewriteRejected: true, eventUpdateRejected: true, eventDeleteRejected: true });
  });

  it('makes DeliveryAcceptance immutable/idempotent and rejects raw or newly-written legacy license keys', async () => {
    const acceptance = await prisma.deliveryAcceptance.create({ data: {
      id: 'u037-acceptance-a', engagementId: ids.engagement, quoteId: ids.quote, artifactVersionId: ids.artifactVersion,
      acceptedByAssignmentId: ids.ownerA, acceptedAt: new Date('2026-01-01T00:00:00.000Z'), acceptanceHash: 'u037-hash-a', snapshotJson: { source: 'u037' }, idempotencyKey: 'u037-acceptance-key',
    } });
    await expect(prisma.deliveryAcceptance.update({ where: { id: acceptance.id }, data: { acceptanceHash: 'rewritten' } })).rejects.toThrow(/immutable/);
    await expect(prisma.deliveryAcceptance.delete({ where: { id: acceptance.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.deliveryAcceptance.create({ data: {
      id: 'u037-acceptance-b', engagementId: 'u037-engagement-b', quoteId: ids.quote, artifactVersionId: ids.artifactVersion,
      acceptedByAssignmentId: ids.ownerA, acceptedAt: new Date('2026-01-01T00:00:00.000Z'), acceptanceHash: 'u037-hash-b', snapshotJson: { source: 'u037' }, idempotencyKey: 'u037-acceptance-key',
    } })).rejects.toThrow();
    await expect(prisma.assetLicense.create({ data: { id: 'u037-license-raw', assetId: ids.asset, skuId: 'u037-sku-a', secretRef: 'raw-license-key-material' } })).rejects.toThrow(/vault reference/);
    await expect(prisma.assetLicense.create({ data: { id: 'u037-license-legacy-write', assetId: ids.asset, skuId: 'u037-sku-a', licenseKey: 'legacy-raw-key' } })).rejects.toThrow(/legacy read\/quarantine/);
    proof('acceptance_immutability_idempotency_and_secret_ref', { acceptanceUpdateRejected: true, acceptanceDeleteRejected: true, idempotencyConflictRejected: true, rawSecretRejected: true, legacyLicenseWriteRejected: true });
  });
});
