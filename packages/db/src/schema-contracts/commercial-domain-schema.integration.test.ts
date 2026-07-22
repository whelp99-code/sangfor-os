import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalizeRfc8785 } from '../canonical-content-hash';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

const ids = {
  tenant: 'u035-tenant', company: 'u035-company', project: 'u035-project', opportunity: 'u035-opportunity',
  legacyQuote: 'u035-legacy-quote', canonicalQuote: 'u035-canonical-quote', line: 'u035-service-line',
};
const hash = (input: string) => createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
const legalBridgeHash = 'a'.repeat(64);
const artifactHashes = { sizing: 'c'.repeat(64), compatA: 'd'.repeat(64), compatB: 'e'.repeat(64), metric: 'f'.repeat(64) };

function serviceSnapshot() {
  return {
    schemaVersion: 'quote-line-fulfillment/v1',
    source: { quoteId: ids.canonicalQuote, quoteLineItemId: ids.line, lineType: 'service', skuId: null, sourceServiceLineItemId: null, sourceCostStatus: 'legacy_cost_snapshot' },
    quantity: { quantityDecimal: '1.25', currency: 'USD' },
    catalog: { catalogSnapshotVersion: null, catalogSnapshotHash: null, productFamilyId: null, productFamilyKey: null, productEditionId: null, productEditionKey: null, skuId: null, skuCode: null },
    license: { licenseMetricId: null, licenseMetricKey: null, licenseMetricSnapshotHash: null, termMonths: null },
    deployment: { deploymentType: null, supportLevel: null, fulfillmentKind: 'service_only' },
    rules: { sizingArtifactVersionId: null, sizingArtifactVersionContentHash: null, compatibilityArtifactVersionIds: null, compatibilityArtifactVersionContentHashes: null },
  };
}

function productSnapshot(id: string, kind: 'perpetual_product' | 'subscription_product', overrides: Record<string, unknown> = {}) {
  const typed = {
    lineType: 'product', quantityDecimal: '2.5', currency: 'USD', sourceServiceLineItemId: null, sourceCostStatus: 'catalog_cost_snapshot',
    productFamilyId: 'u035-family', productFamilyKey: 'FAMILY', productEditionId: 'u035-edition', productEditionKey: 'EDITION', skuId: 'u035-sku', skuCode: 'SKU-1',
    termMonths: kind === 'subscription_product' ? 12 : null, licenseMetricId: 'u035-metric', licenseMetricKey: 'SEAT', licenseMetricSnapshotHash: artifactHashes.metric,
    deploymentType: 'cloud', supportLevel: 'standard', fulfillmentKind: kind, catalogSnapshotVersion: 'quote-line-catalog/v1',
    sizingArtifactVersionId: 'u035-sizing', sizingArtifactVersionContentHash: artifactHashes.sizing,
    compatibilityArtifactVersionIds: ['u035-compat-a', 'u035-compat-b'], compatibilityArtifactVersionContentHashes: [artifactHashes.compatA, artifactHashes.compatB],
    ...overrides,
  } as Record<string, any>;
  const catalogHash = hash(canonicalizeRfc8785({ catalogSnapshotVersion: typed.catalogSnapshotVersion, productFamilyId: typed.productFamilyId, productFamilyKey: typed.productFamilyKey, productEditionId: typed.productEditionId, productEditionKey: typed.productEditionKey, skuId: typed.skuId, skuCode: typed.skuCode }));
  return { typed, snapshot: {
    schemaVersion: 'quote-line-fulfillment/v1',
    source: { quoteId: ids.canonicalQuote, quoteLineItemId: id, lineType: typed.lineType, skuId: typed.skuId, sourceServiceLineItemId: typed.sourceServiceLineItemId, sourceCostStatus: typed.sourceCostStatus },
    quantity: { quantityDecimal: typed.quantityDecimal, currency: typed.currency },
    catalog: { catalogSnapshotVersion: typed.catalogSnapshotVersion, catalogSnapshotHash: catalogHash, productFamilyId: typed.productFamilyId, productFamilyKey: typed.productFamilyKey, productEditionId: typed.productEditionId, productEditionKey: typed.productEditionKey, skuId: typed.skuId, skuCode: typed.skuCode },
    license: { licenseMetricId: typed.licenseMetricId, licenseMetricKey: typed.licenseMetricKey, licenseMetricSnapshotHash: typed.licenseMetricSnapshotHash, termMonths: typed.termMonths },
    deployment: { deploymentType: typed.deploymentType, supportLevel: typed.supportLevel, fulfillmentKind: typed.fulfillmentKind },
    rules: { sizingArtifactVersionId: typed.sizingArtifactVersionId, sizingArtifactVersionContentHash: typed.sizingArtifactVersionContentHash, compatibilityArtifactVersionIds: typed.compatibilityArtifactVersionIds, compatibilityArtifactVersionContentHashes: typed.compatibilityArtifactVersionContentHashes },
  }};
}

function lineData(id: string, kind: 'perpetual_product' | 'subscription_product', override: Record<string, unknown> = {}) {
  const { typed, snapshot } = productSnapshot(id, kind);
  return { id, quoteId: ids.canonicalQuote, quantity: 1, unitPrice: '100', costPrice: '60', revenue: '100', cost: '60', marginPct: '40', ...typed, fulfillmentSnapshot: snapshot, ...override } as any;
}

describe.skipIf(!integration)('U035 commercial history guards (isolated scratch only)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('U035 verifier must inject DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const fixtureSql = `
      INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('${ids.tenant}', 'U035 Tenant', '${ids.tenant}', 'active', now());
      INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES ('${ids.company}', '${ids.tenant}', 'U035 Company', '${ids.company}', now());
      INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES ('${ids.project}', '${ids.project}', 'U035 Project', '${ids.company}', now(), now());
      INSERT INTO opportunities (id, project_id, title, stage, deal_status, ownership_revision, probability, created_at, updated_at) VALUES ('${ids.opportunity}', '${ids.project}', 'U035 opportunity', 'LEAD', 'OPEN', 0, 20, now(), now());
      INSERT INTO quotes (id, opportunity_id, company_id, status, version, total_revenue, total_cost, margin_pct, created_by, created_at) VALUES
        ('${ids.legacyQuote}', '${ids.opportunity}', '${ids.company}', 'draft', 1, 100, 60, 40, 'u035', now()),
        ('${ids.canonicalQuote}', '${ids.opportunity}', '${ids.company}', 'draft', 2, 100, 60, 40, 'u035', now());
    `;
    for (const statement of fixtureSql.split(';\n')) {
      const sql = statement.trim();
      if (sql) await prisma.$executeRawUnsafe(`${sql};`);
    }
    // Dependency fixtures are only catalog/rule snapshots. They are seeded with replication
    // triggers disabled so this test exercises U035's line trigger rather than unrelated U017
    // authoring guards.
    await prisma.$executeRawUnsafe(`SET session_replication_role = replica`);
    for (const sql of [
      `INSERT INTO product_families (id,company_id,family_key,vendor,name) VALUES ('u035-family','${ids.company}','FAMILY','u035','Family')`,
      `INSERT INTO product_editions (id,family_id,edition_key,name,version) VALUES ('u035-edition','u035-family','EDITION','Edition','1')`,
      `INSERT INTO product_skus (id,edition_id,sku_code,name) VALUES ('u035-sku','u035-edition','SKU-1','SKU')`,
      `INSERT INTO license_metrics (id,product_family_id,key,name,unit) VALUES ('u035-metric','u035-family','SEAT','Seat','seat')`,
      `INSERT INTO artifacts (id,tenant_id,company_id,project_id,artifact_type,classification,origin,title,created_by_assignment_id,owner_assignment_id,created_at,updated_at) VALUES ('u035-art','${ids.tenant}','${ids.company}','${ids.project}','rule','internal','human','Rule','missing','missing',now(),now())`,
      ...Object.entries({ 'u035-sizing': artifactHashes.sizing, 'u035-compat-a': artifactHashes.compatA, 'u035-compat-b': artifactHashes.compatB }).map(([id, contentHash], index) => `INSERT INTO artifact_versions (id,artifact_id,version,content_hash_version,canonical_content_envelope,content_hash,content_json,status,created_by_assignment_id,created_at) VALUES ('${id}','u035-art',${index + 1},'artifact-content/rfc8785-jcs-sha256/v1','{}','${contentHash}','{}','review_ready','missing',now())`),
    ]) await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(`SET session_replication_role = origin`);
  }, 30_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it('installs every named trigger and uses the same RFC-8785 vector/hash as application code', async () => {
    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('quotes_canonical_immutable_update_trg','quotes_canonical_immutable_delete_trg','quote_commercial_snapshots_immutable_update_trg','quote_commercial_snapshots_immutable_delete_trg','quote_line_fulfillment_v1_validate_trg') ORDER BY tgname`);
    expect(triggers.map((row) => row.tgname)).toEqual([
      'quote_commercial_snapshots_immutable_delete_trg', 'quote_commercial_snapshots_immutable_update_trg',
      'quote_line_fulfillment_v1_validate_trg', 'quotes_canonical_immutable_delete_trg', 'quotes_canonical_immutable_update_trg',
    ]);
    const vector = { z: null, a: [true, '€'], '😀': 'astral', '\uE000': 'bmp' };
    const canonical = canonicalizeRfc8785(vector);
    const pg = await prisma.$queryRawUnsafe<Array<{ canonical: string; digest: string }>>(`SELECT public.sangfor_rfc8785_jcs_v1($1::jsonb) AS canonical, public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1($1::jsonb)) AS digest`, JSON.stringify(vector));
    expect(pg[0]).toEqual({ canonical, digest: hash(canonical) });
  });

  it('permits exactly one legacy bridge then rejects canonical Quote update/delete and snapshot update/delete', async () => {
    await prisma.$executeRawUnsafe(`UPDATE quotes SET currency='USD', content_hash='${legalBridgeHash}' WHERE id='${ids.legacyQuote}'`);
    await expect(prisma.$executeRawUnsafe(`UPDATE quotes SET status='sent' WHERE id='${ids.legacyQuote}'`)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM quotes WHERE id='${ids.legacyQuote}'`)).rejects.toThrow(/immutable/);
    const snapshot = await prisma.quoteCommercialSnapshot.create({ data: {
      id: 'u035-commercial-snapshot', quoteId: ids.canonicalQuote, policyVersion: 'commercial/v1', thresholdMarginPct: '20', calculatedRevenue: '100', calculatedCost: '60', calculatedMarginPct: '40', costCoverageStatus: 'covered', requiresApproval: false, snapshotHash: 'b'.repeat(64),
    } });
    await expect(prisma.quoteCommercialSnapshot.update({ where: { id: snapshot.id }, data: { requiresApproval: true } })).rejects.toThrow(/immutable/);
    await expect(prisma.quoteCommercialSnapshot.delete({ where: { id: snapshot.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM quotes WHERE id='${ids.canonicalQuote}'`)).rejects.toThrow(/immutable/);
  });

  it('computes service fulfillment hashes from exact-null RFC-8785 payloads and rejects forged caller hashes', async () => {
    const snapshot = serviceSnapshot();
    const created = await prisma.quoteLineItem.create({ data: {
      id: ids.line, quoteId: ids.canonicalQuote, skuId: null, quantity: 1, unitPrice: '100', costPrice: '60', revenue: '100', cost: '60', marginPct: '40',
      lineType: 'service', quantityDecimal: '1.25', currency: 'USD', sourceCostStatus: 'legacy_cost_snapshot', fulfillmentKind: 'service_only', fulfillmentSnapshot: snapshot,
    } });
    const canonical = canonicalizeRfc8785(snapshot);
    expect(created.catalogSnapshotHash).toBeNull();
    expect(created.fulfillmentSnapshotHash).toBe(hash(canonical));
    await expect(prisma.quoteLineItem.update({ where: { id: ids.line }, data: { fulfillmentSnapshotHash: 'c'.repeat(64) } })).rejects.toThrow(/caller-supplied/);
    await expect(prisma.quoteLineItem.create({ data: {
      id: 'u035-bad-service-line', quoteId: ids.canonicalQuote, quantity: 1, unitPrice: '100', costPrice: '60', revenue: '100', cost: '60', marginPct: '40',
      lineType: 'service', quantityDecimal: '1.25', currency: 'USD', sourceCostStatus: 'legacy_cost_snapshot', fulfillmentKind: 'service_only', fulfillmentSnapshot: { ...snapshot, extra: true },
    } })).rejects.toThrow(/fulfillmentSnapshot/);
  });

  it('accepts valid perpetual/subscription product shapes, freezes their snapshots, and rejects the full negative matrix', async () => {
    const perpetual = await prisma.quoteLineItem.create({ data: lineData('u035-perpetual', 'perpetual_product') });
    const subscription = await prisma.quoteLineItem.create({ data: lineData('u035-subscription', 'subscription_product') });
    expect(perpetual.catalogSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(subscription.fulfillmentSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const frozen = { typed: perpetual.productFamilyKey, catalog: perpetual.catalogSnapshotHash, fulfillment: perpetual.fulfillmentSnapshotHash, payload: perpetual.fulfillmentSnapshot };
    await prisma.$executeRawUnsafe(`UPDATE product_families SET family_key='LIVE-MUTATED' WHERE id='u035-family'`);
    await prisma.$executeRawUnsafe(`UPDATE product_skus SET sku_code='LIVE-MUTATED' WHERE id='u035-sku'`);
    const reread = await prisma.quoteLineItem.findUniqueOrThrow({ where: { id: perpetual.id } });
    expect({ typed: reread.productFamilyKey, catalog: reread.catalogSnapshotHash, fulfillment: reread.fulfillmentSnapshotHash, payload: reread.fulfillmentSnapshot }).toEqual(frozen);

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['incomplete license triple', { licenseMetricKey: null }], ['missing family', { productFamilyId: null }], ['parent chain mismatch', { productEditionId: 'missing-edition' }],
      ['wrong catalog version', { catalogSnapshotVersion: 'wrong/v1' }], ['missing sizing version', { sizingArtifactVersionId: null }], ['sizing id/hash mismatch', { sizingArtifactVersionContentHash: '0'.repeat(64) }],
      ['unequal compatibility lengths', { compatibilityArtifactVersionContentHashes: [artifactHashes.compatA] }], ['reversed compatibility IDs', { compatibilityArtifactVersionIds: ['u035-compat-b', 'u035-compat-a'], compatibilityArtifactVersionContentHashes: [artifactHashes.compatB, artifactHashes.compatA] }],
      ['duplicate compatibility IDs', { compatibilityArtifactVersionIds: ['u035-compat-a', 'u035-compat-a'] }], ['per-index compatibility hash mismatch', { compatibilityArtifactVersionContentHashes: [artifactHashes.compatB, artifactHashes.compatA] }],
      ['nonpositive term', { termMonths: 0 }],
    ];
    for (const [label, override] of invalid) {
      const id = `u035-invalid-${label.replace(/\W+/g, '-')}`;
      const data = lineData(id, 'subscription_product', override);
      // Rebuild the envelope from the deliberately invalid typed values so the named trigger,
      // rather than an accidental stale JSON mismatch, is the rejecting boundary.
      const built = productSnapshot(id, 'subscription_product', override);
      data.fulfillmentSnapshot = built.snapshot;
      await expect(prisma.quoteLineItem.create({ data })).rejects.toThrow(/quote_line_fulfillment_v1_(complete_chk|validate_trg)|Foreign key/);
    }
    for (const text of ['01.25', '+1.25', '1.250', '1e0']) {
      const data = lineData(`u035-noncanonical-${text.replace(/\W/g, '')}`, 'perpetual_product');
      (data.fulfillmentSnapshot as any).quantity.quantityDecimal = text;
      await expect(prisma.quoteLineItem.create({ data })).rejects.toThrow(/fulfillmentSnapshot/);
    }
    const forged = lineData('u035-forged-catalog', 'perpetual_product');
    (forged.fulfillmentSnapshot as any).catalog.catalogSnapshotHash = '0'.repeat(64);
    await expect(prisma.quoteLineItem.create({ data: forged })).rejects.toThrow(/fulfillmentSnapshot/);
    const extra = lineData('u035-extra-key', 'perpetual_product'); (extra.fulfillmentSnapshot as any).extra = true;
    await expect(prisma.quoteLineItem.create({ data: extra })).rejects.toThrow(/fulfillmentSnapshot/);
    const forgedHash = lineData('u035-forged-hash', 'perpetual_product', { fulfillmentSnapshotHash: '0'.repeat(64) });
    await expect(prisma.quoteLineItem.create({ data: forgedHash })).rejects.toThrow(/caller-supplied/);
    const legacy = await prisma.quoteLineItem.create({ data: { id: 'u035-legacy-line', quoteId: ids.canonicalQuote, quantity: 1, unitPrice: '1', costPrice: '1', revenue: '1', cost: '1', marginPct: '0', quantityDecimal: '1', currency: 'USD' } });
    expect(legacy.fulfillmentSnapshot).toBeNull(); expect(legacy.fulfillmentSnapshotHash).toBeNull();
  });
});
