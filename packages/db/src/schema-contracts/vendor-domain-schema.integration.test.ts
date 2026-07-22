import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

function proof(name: string, value: Record<string, unknown>): void {
  console.info(`U036_PROOF ${JSON.stringify({ name, ...value })}`);
}

const ids = {
  tenant: 'u036-tenant', companyA: 'u036-company-a', companyB: 'u036-company-b', project: 'u036-project-a',
  customer: 'u036-customer-a', opportunity: 'u036-opportunity-a', quote: 'u036-quote-a', discount: 'u036-discount-a',
  vendorRequest: 'u036-vendor-request-a', sku: 'u036-sku-a',
};

const FIXTURE_SQL = `
INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u036-tenant', 'U036 Tenant', 'u036-tenant', 'active', now());
INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u036-company-a', 'u036-tenant', 'Company A', 'u036-company-a', now()),
  ('u036-company-b', 'u036-tenant', 'Company B', 'u036-company-b', now());
INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u036-project-a', 'u036-project-a', 'Project A', 'u036-company-a', now(), now());
INSERT INTO customers (id, project_id, name, created_at, updated_at) VALUES
  ('u036-customer-a', 'u036-project-a', 'Customer A', now(), now());
INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u036-user-a', 'u036-a@example.test', 'User A', 'active', now(), now()),
  ('u036-user-b', 'u036-b@example.test', 'User B', 'active', now(), now());
INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u036-owner-a', 'u036-user-a', 'u036-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u036-owner-a2', 'u036-user-b', 'u036-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u036-owner-b', 'u036-user-b', 'u036-company-b', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u036-owner-inactive', 'u036-user-b', 'u036-company-a', 'support_engineer', 'legacy_pending', now() - interval '1 day', now()),
  ('u036-owner-expired', 'u036-user-b', 'u036-company-a', 'finance_manager', 'active', now() - interval '1 day', now()),
  ('u036-owner-revoked', 'u036-user-b', 'u036-company-a', 'sales_manager', 'active', now() - interval '1 day', now());
UPDATE user_company_roles SET expires_at = now() - interval '1 second' WHERE id = 'u036-owner-expired';
UPDATE user_company_roles SET status = 'revoked', revoked_at = now() - interval '1 second' WHERE id = 'u036-owner-revoked';
INSERT INTO opportunities (id, project_id, title, stage, deal_status, ownership_revision, probability, created_at, updated_at) VALUES
  ('u036-opportunity-a', 'u036-project-a', 'Vendor request opportunity', 'LEAD', 'OPEN', 0, 20, now(), now());
INSERT INTO quotes (id, opportunity_id, company_id, status, version, total_revenue, total_cost, margin_pct, created_by, created_at) VALUES
  ('u036-quote-a', 'u036-opportunity-a', 'u036-company-a', 'draft', 1, 100, 60, 40, 'u036-legacy', now());
SET session_replication_role = replica;
INSERT INTO product_families (id, company_id, family_key, vendor, name) VALUES ('u036-family-a', 'u036-company-a', 'U036-FAMILY', 'u036', 'U036 Family');
INSERT INTO product_editions (id, family_id, edition_key, name, version) VALUES ('u036-edition-a', 'u036-family-a', 'U036-EDITION', 'U036 Edition', '1');
INSERT INTO product_skus (id, edition_id, sku_code, name) VALUES ('u036-sku-a', 'u036-edition-a', 'U036-SKU', 'U036 SKU');
SET session_replication_role = origin;
`;

describe.skipIf(!integration)('U036 vendor owner guards (isolated scratch only)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('U036 verifier must inject DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    for (const statement of FIXTURE_SQL.split(';\n')) {
      const sql = statement.trim();
      if (sql) await prisma.$executeRawUnsafe(`${sql};`);
    }
    await prisma.discountRequest.create({ data: {
      id: ids.discount, quoteId: ids.quote, requestedDiscount: '12.5', reason: 'internal discount', vendorRequired: true,
      requestedByAssignmentId: 'u036-owner-a', idempotencyKey: 'u036-discount-idempotency', createdAt: new Date(),
    } });
    await prisma.vendorRequest.create({ data: {
      id: ids.vendorRequest, opportunityId: ids.opportunity, quoteId: ids.quote, discountRequestId: ids.discount,
      customerId: ids.customer, requestedByAssignmentId: 'u036-owner-a', ownerAssignmentId: 'u036-owner-a',
      requestType: 'discount', vendorName: 'internal-only', detailsJson: { source: 'u036' }, createdBy: 'legacy-u036',
      idempotencyKey: 'u036-vendor-idempotency', createdAt: new Date(), updatedAt: new Date(),
    } });
    await prisma.vendorRequestEvent.create({ data: {
      id: 'u036-event-a', requestId: ids.vendorRequest, eventType: 'created', description: 'internal request created',
      createdBy: 'legacy-u036', actorAssignmentId: 'u036-owner-a', payload: { status: 'draft', revision: 0 }, createdAt: new Date(),
    } });
  }, 30_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it('installs exactly the named owner guard and two append-only event triggers', async () => {
    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('vendor_requests_owner_scope_guard_trg','vendor_request_events_immutable_update_trg','vendor_request_events_immutable_delete_trg') ORDER BY tgname`,
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'vendor_request_events_immutable_delete_trg', 'vendor_request_events_immutable_update_trg', 'vendor_requests_owner_scope_guard_trg',
    ]);
    const guardCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'vendor_requests'::regclass AND tgname = 'vendor_requests_owner_scope_guard_trg'`,
    );
    expect(guardCount[0].count).toBe(1n);
    proof('pg_trigger', { triggers: triggers.map((row) => row.tgname), ownerGuardCount: Number(guardCount[0].count) });
  });

  it.each(['u036-owner-b', 'u036-owner-inactive', 'u036-owner-expired', 'u036-owner-revoked', 'u036-owner-missing'])('rejects foreign, inactive, expired, revoked, and nonexistent owners: %s', async (ownerAssignmentId) => {
    await expect(prisma.vendorRequest.create({ data: {
      id: `u036-invalid-${ownerAssignmentId}`, customerId: ids.customer, ownerAssignmentId,
      requestType: 'discount', vendorName: 'internal-only', detailsJson: {}, createdBy: 'legacy-u036',
    } })).rejects.toThrow(/owner assignment|Foreign key/);
    proof('owner_scope_negative_fixture', { ownerAssignmentId, rejected: true });
  });

  it('keeps the owner and domain CAS counters independent, rejects stale ownership, and leaves replay untouched', async () => {
    const stale = await prisma.vendorRequest.updateMany({
      where: { id: ids.vendorRequest, ownerAssignmentId: 'u036-owner-a', ownershipRevision: 7 },
      data: { ownerAssignmentId: 'u036-owner-a2', ownershipRevision: { increment: 1 } },
    });
    expect(stale.count).toBe(0);
    const ownerChanged = await prisma.vendorRequest.updateMany({
      where: { id: ids.vendorRequest, ownerAssignmentId: 'u036-owner-a', ownershipRevision: 0 },
      data: { ownerAssignmentId: 'u036-owner-a2', ownershipRevision: { increment: 1 } },
    });
    expect(ownerChanged.count).toBe(1);
    expect(await prisma.vendorRequest.findUniqueOrThrow({ where: { id: ids.vendorRequest } })).toMatchObject({ ownershipRevision: 1, revision: 0, ownerAssignmentId: 'u036-owner-a2' });

    const stateChanged = await prisma.vendorRequest.updateMany({
      where: { id: ids.vendorRequest, revision: 0 },
      data: { status: 'submitted', submittedAt: new Date(), revision: { increment: 1 } },
    });
    expect(stateChanged.count).toBe(1);
    const receipt = await prisma.vendorRequest.findUniqueOrThrow({ where: { id: ids.vendorRequest } });
    expect(receipt).toMatchObject({ ownershipRevision: 1, revision: 1, status: 'submitted', ownerAssignmentId: 'u036-owner-a2' });

    const replay = await prisma.vendorRequest.updateMany({
      where: { id: ids.vendorRequest, revision: 0 },
      data: { status: 'submitted', submittedAt: new Date(), revision: { increment: 1 } },
    });
    expect(replay.count).toBe(0);
    expect(await prisma.vendorRequest.findUniqueOrThrow({ where: { id: ids.vendorRequest } })).toMatchObject(receipt);
    await expect(prisma.vendorRequest.update({
      where: { id: ids.vendorRequest },
      data: { ownerAssignmentId: 'u036-owner-a', ownershipRevision: { increment: 1 }, revision: { increment: 1 } },
    })).rejects.toThrow(/cannot change in one operation/);
    proof('dual_cas_matrix', { staleOwnershipCount: stale.count, ownerMutationCount: ownerChanged.count, stateMutationCount: stateChanged.count, replayCount: replay.count, ownershipRevision: receipt.ownershipRevision, revision: receipt.revision });
  });

  it('never lets owner reassignment rewrite requester/creator/history and keeps event rows append-only', async () => {
    await expect(prisma.vendorRequest.update({
      where: { id: ids.vendorRequest },
      data: { ownerAssignmentId: 'u036-owner-a', ownershipRevision: { increment: 1 }, requestedByAssignmentId: 'u036-owner-a2' },
    })).rejects.toThrow(/may change only/);
    await expect(prisma.vendorRequest.update({
      where: { id: ids.vendorRequest },
      data: { ownerAssignmentId: 'u036-owner-a', ownershipRevision: { increment: 1 }, createdBy: 'rewritten' },
    })).rejects.toThrow(/may change only/);
    await expect(prisma.vendorRequestEvent.update({ where: { id: 'u036-event-a' }, data: { description: 'rewritten' } })).rejects.toThrow(/immutable/);
    await expect(prisma.vendorRequestEvent.delete({ where: { id: 'u036-event-a' } })).rejects.toThrow(/immutable/);
    proof('immutable_attribution_and_event_timeline', { requesterRewriteRejected: true, creatorRewriteRejected: true, eventUpdateRejected: true, eventDeleteRejected: true });
  });

  it('fails quote cascade deletion closed, uses Restrict constraints, and stores a demo secret reference only', async () => {
    const foreignKeys = await prisma.$queryRawUnsafe<Array<{ conname: string; confdeltype: string }>>(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('discount_requests_quote_id_fkey','vendor_request_events_request_id_fkey') ORDER BY conname`,
    );
    expect(foreignKeys).toEqual([
      { conname: 'discount_requests_quote_id_fkey', confdeltype: 'r' },
      { conname: 'vendor_request_events_request_id_fkey', confdeltype: 'r' },
    ]);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM quotes WHERE id='${ids.quote}'`)).rejects.toThrow();
    const demo = await prisma.demoLicense.create({ data: {
      id: 'u036-demo-a', vendorRequestId: ids.vendorRequest, productSkuId: ids.sku, customerId: ids.customer,
      status: 'issued', secretRef: 'vault://u036/demo-a',
    } });
    expect(demo.secretRef).toBe('vault://u036/demo-a');
    expect(Object.keys(demo).map((key) => key.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter((key) => key !== 'secretref' && /(?:license)?(?:token|key|value|secret)/.test(key))).toEqual([]);
    proof('restrict_and_demo_secret_ref', { quoteDeleteRejected: true, restrictConstraints: foreignKeys.map((row) => row.conname), rawLicenseMaterialFields: [] });
  });
});
