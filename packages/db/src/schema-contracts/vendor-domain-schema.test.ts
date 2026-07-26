import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_SCOPE_INVENTORY, buildScopeInventoryReport } from '../scope-inventory';
import { dmmfField, dmmfModel } from './helpers';

const U036_MIGRATION_NAME = '20260716003600_u036_vendor_discount_demo_expand';
const U036_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U036_MIGRATION_NAME, 'migration.sql');

function readU036Migration(): string {
  return readFileSync(U036_MIGRATION_PATH, 'utf8');
}

function normalizedFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function denotesRawLicenseMaterial(name: string): boolean {
  const normalized = normalizedFieldName(name);
  if (normalized === 'secretref') return false;
  return /(?:license)?(?:token|key|value|secret)/.test(normalized);
}

describe('U036 vendor, discount, and demo-license schema contract', () => {
  it('exposes the additive discount and vendor request fields with the two required independent counters', () => {
    for (const field of ['vendorRequired', 'approvalRequestId', 'requestedByAssignmentId', 'idempotencyKey', 'createdAt', 'decidedAt']) {
      expect(dmmfField('DiscountRequest', field)).toBeDefined();
    }
    for (const field of ['quoteId', 'discountRequestId', 'customerId', 'requestedByAssignmentId', 'ownerAssignmentId', 'idempotencyKey', 'externalReference', 'submittedAt', 'submissionEvidenceArtifactVersionId', 'createdAt', 'updatedAt']) {
      expect(dmmfField('VendorRequest', field)).toBeDefined();
    }
    for (const field of ['ownershipRevision', 'revision']) {
      const counter = dmmfField('VendorRequest', field);
      expect(counter.type).toBe('Int');
      expect(counter.isRequired).toBe(true);
      expect(counter.default).toBe(0);
    }
  });

  it('uses Restrict for every discount/vendor/timeline provenance edge', () => {
    for (const [model, relation] of [
      ['DiscountRequest', 'quote'], ['DiscountRequest', 'approvalRequest'], ['DiscountRequest', 'requestedByAssignment'],
      ['VendorRequest', 'quote'], ['VendorRequest', 'discountRequest'], ['VendorRequest', 'customer'],
      ['VendorRequest', 'requestedByAssignment'], ['VendorRequest', 'ownerAssignment'], ['VendorRequest', 'submissionEvidenceArtifactVersion'],
      ['VendorRequestEvent', 'request'], ['VendorRequestEvent', 'actorAssignment'],
    ] as const) expect(dmmfField(model, relation).relationOnDelete).toBe('Restrict');
  });

  it('adds one DemoLicense with only a secret reference, required customer scope, and Restrict provenance', () => {
    const demoLicense = dmmfModel('DemoLicense');
    for (const field of ['vendorRequestId', 'productSkuId', 'customerId', 'status', 'createdAt', 'updatedAt']) {
      expect(dmmfField('DemoLicense', field).isRequired).toBe(true);
    }
    expect(dmmfField('DemoLicense', 'secretRef').isRequired).toBe(false);
    for (const relation of ['vendorRequest', 'productSku', 'customer'] as const) {
      expect(dmmfField('DemoLicense', relation).relationOnDelete).toBe('Restrict');
    }
    expect(demoLicense.fields.filter((field) => denotesRawLicenseMaterial(field.name)).map((field) => field.name)).toEqual([]);
  });

  it('installs the one owner-scope guard and both unconditional event immutability triggers', () => {
    const sql = readU036Migration();
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.vendor_requests_owner_scope_guard_fn()');
    expect(sql.match(/CREATE TRIGGER vendor_requests_owner_scope_guard_trg/g)).toHaveLength(1);
    expect(sql).toContain('CREATE TRIGGER vendor_request_events_immutable_update_trg');
    expect(sql).toContain('CREATE TRIGGER vendor_request_events_immutable_delete_trg');
    expect(sql).toContain('BEFORE UPDATE ON "vendor_request_events"');
    expect(sql).toContain('BEFORE DELETE ON "vendor_request_events"');
  });

  it('proves the unmodified inventory checker rejects DemoLicense until its one required-customer CHILD_VIA_FK entry is present', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    const unclassified = Object.values(MODEL_SCOPE_INVENTORY).filter((entry) => entry.model !== 'DemoLicense');
    const rejected = buildScopeInventoryReport(modelNames, unclassified);
    expect(rejected.ok).toBe(false);
    expect(rejected.missingModels).toEqual(['DemoLicense']);
    expect(MODEL_SCOPE_INVENTORY.DemoLicense).toEqual({
      model: 'DemoLicense',
      category: 'CHILD_VIA_FK',
      parentModel: 'Customer',
      relationField: 'customer',
      scalarFkField: 'customerId',
      additionalRequiredRelationFields: ['vendorRequest', 'productSku'],
      nullable: false,
    });
  });
});
