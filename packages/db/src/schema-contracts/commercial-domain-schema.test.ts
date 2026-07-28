import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { canonicalizeRfc8785 } from '../canonical-content-hash';
import { MODEL_SCOPE_INVENTORY, buildScopeInventoryReport } from '../scope-inventory';
import { dmmfField, dmmfModel } from './helpers';

const U035_MIGRATION_NAME = '20260716003500_u035_quote_version_snapshot_expand';
const U035_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U035_MIGRATION_NAME, 'migration.sql');

function readU035Migration(): string {
  return readFileSync(U035_MIGRATION_PATH, 'utf8');
}

describe('U035 commercial domain schema contract', () => {
  it('exposes the immutable Quote version and QuoteCommercialSnapshot model', () => {
    const quote = dmmfModel('Quote');
    expect(quote.fields.find((field) => field.name === 'contentHash')).toBeDefined();
    expect(dmmfField('Quote', 'opportunity').relationOnDelete).toBe('Restrict');
    expect(dmmfModel('QuoteCommercialSnapshot')).toBeDefined();
  });

  it('exposes every exact quote-line-fulfillment/v1 typed field and Restrict provenance links', () => {
    for (const field of [
      'lineType', 'quantityDecimal', 'currency', 'sourceServiceLineItemId', 'sourceCostStatus',
      'productFamilyId', 'productFamilyKey', 'productEditionId', 'productEditionKey', 'skuId', 'skuCode',
      'termMonths', 'licenseMetricId', 'licenseMetricKey', 'licenseMetricSnapshotHash', 'deploymentType',
      'supportLevel', 'fulfillmentKind', 'catalogSnapshotVersion', 'catalogSnapshotHash',
      'sizingArtifactVersionId', 'sizingArtifactVersionContentHash', 'compatibilityArtifactVersionIds',
      'compatibilityArtifactVersionContentHashes', 'fulfillmentSnapshot', 'fulfillmentSnapshotHash',
    ]) expect(dmmfField('QuoteLineItem', field)).toBeDefined();
    for (const relation of ['quote', 'sku', 'sourceServiceLineItem', 'productFamily', 'productEdition', 'licenseMetric', 'sizingArtifactVersion'] as const) {
      expect(dmmfField('QuoteLineItem', relation).relationOnDelete).toBe('Restrict');
    }
  });

  it('installs all authoritative immutable-history and fulfillment validation triggers', () => {
    const sql = readU035Migration();
    for (const trigger of [
      'quotes_canonical_immutable_update_trg', 'quotes_canonical_immutable_delete_trg',
      'quote_commercial_snapshots_immutable_update_trg', 'quote_commercial_snapshots_immutable_delete_trg',
      'quote_line_fulfillment_v1_validate_trg',
    ]) expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
    expect(sql).toContain('quote_line_fulfillment_v1_complete_chk');
  });

  it('shares RFC-8785 JCS conformance vectors with the PostgreSQL trigger contract', () => {
    const vector = { z: null, a: [true, '€'], '😀': 'astral', '\uE000': 'bmp' };
    const canonical = canonicalizeRfc8785(vector);
    expect(canonical).toBe('{"a":[true,"€"],"z":null,"😀":"astral","":"bmp"}');
    expect(createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')).toBe('baaa93bc8f65d9a5c57e735cf9930a8c9f87971d7b848680ca3aa25098d5174f');
    expect(readU035Migration()).toContain('public.sangfor_rfc8785_jcs_v1');
    expect(readU035Migration()).toContain('public.sangfor_sha256_utf8');
  });

  it('proves the unmodified inventory checker would reject the new model before its one CHILD_VIA_FK entry is registered', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    const unclassified = Object.values(MODEL_SCOPE_INVENTORY).filter((entry) => entry.model !== 'QuoteCommercialSnapshot');
    const rejected = buildScopeInventoryReport(modelNames, unclassified);
    expect(rejected.ok).toBe(false);
    expect(rejected.missingModels).toEqual(['QuoteCommercialSnapshot']);
    expect(MODEL_SCOPE_INVENTORY.QuoteCommercialSnapshot).toEqual({
      model: 'QuoteCommercialSnapshot', category: 'CHILD_VIA_FK', parentModel: 'Quote', relationField: 'quote', scalarFkField: 'quoteId', nullable: false,
    });
  });
});
