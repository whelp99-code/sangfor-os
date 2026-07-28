import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_SCOPE_INVENTORY, buildScopeInventoryReport } from '../scope-inventory';
import { dmmfField, dmmfModel } from './helpers';

const U037_MIGRATION_NAME = '20260716003700_u037_delivery_lifecycle_expand';
const U037_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U037_MIGRATION_NAME, 'migration.sql');

function readU037Migration(): string {
  return readFileSync(U037_MIGRATION_PATH, 'utf8');
}

function uniqueIndex(model: string, fields: string[]): boolean {
  if (fields.length === 1) return dmmfField(model, fields[0]).isUnique;
  return dmmfModel(model).uniqueFields.some((candidate) => candidate.join(',') === fields.join(','));
}

describe('U037 delivery lifecycle schema contract', () => {
  it('adds immutable, idempotent DeliveryAcceptance with only the typed acceptance assignment actor', () => {
    for (const field of ['engagementId', 'quoteId', 'artifactVersionId', 'acceptedByAssignmentId', 'acceptedAt', 'acceptanceHash', 'snapshotJson', 'idempotencyKey', 'createdAt'] as const) {
      expect(dmmfField('DeliveryAcceptance', field).isRequired).toBe(true);
    }
    for (const relation of ['engagement', 'quote', 'artifactVersion', 'acceptedByAssignment'] as const) {
      expect(dmmfField('DeliveryAcceptance', relation).relationOnDelete).toBe('Restrict');
    }
    const acceptance = dmmfModel('DeliveryAcceptance');
    expect(acceptance.fields.map((field) => field.name)).not.toContain('actorAssignmentId');
    expect(acceptance.fields.map((field) => field.name)).not.toContain('acceptedBy');
    expect(uniqueIndex('DeliveryAcceptance', ['engagementId'])).toBe(true);
    expect(uniqueIndex('DeliveryAcceptance', ['idempotencyKey'])).toBe(true);
  });

  it('adds delivery provenance only to the three projection models and never adds Subscription ownership', () => {
    for (const [model, fields] of [
      ['CustomerAsset', ['deliveryAcceptanceId', 'sourceQuoteLineItemId', 'productFamilyId', 'productSkuId', 'installedAt', 'activationReference']],
      ['AssetLicense', ['deliveryAcceptanceId', 'sourceQuoteLineItemId', 'secretRef', 'licenseMetricKey', 'licensedQuantity', 'createdAt', 'updatedAt']],
      ['Subscription', ['deliveryAcceptanceId', 'assetLicenseId', 'sourceQuoteLineItemId', 'createdAt', 'updatedAt']],
    ] as const) {
      for (const field of fields) expect(dmmfField(model, field)).toBeDefined();
    }
    for (const [model, relations] of [
      ['CustomerAsset', ['deliveryAcceptance', 'sourceQuoteLineItem', 'productFamily', 'productSku']],
      ['AssetLicense', ['deliveryAcceptance', 'sourceQuoteLineItem']],
      ['Subscription', ['deliveryAcceptance', 'assetLicense', 'sourceQuoteLineItem']],
    ] as const) {
      for (const relation of relations) expect(dmmfField(model, relation).relationOnDelete).toBe('Restrict');
    }
    const subscriptionFields = dmmfModel('Subscription').fields.map((field) => field.name);
    expect(subscriptionFields.filter((field) => /owner|assignment/i.test(field))).toEqual([]);
    const licenseFields = dmmfModel('AssetLicense').fields.map((field) => field.name);
    expect(licenseFields).toContain('licenseKey');
    expect(licenseFields.filter((field) => /(?:raw)?(?:token|key|value|secret)/i.test(field) && !['licenseKey', 'licenseMetricKey', 'secretRef'].includes(field))).toEqual([]);
  });

  it('adds the real renewable asset/source graph, one ownership CAS counter, and reminder idempotency', () => {
    expect(dmmfField('RenewalOpportunity', 'asset').relationOnDelete).toBe('Restrict');
    for (const relation of ['customer', 'subscription', 'opportunity', 'ownerAssignment'] as const) {
      expect(dmmfField('RenewalOpportunity', relation).relationOnDelete).toBe('Restrict');
    }
    const ownershipRevision = dmmfField('RenewalOpportunity', 'ownershipRevision');
    expect(ownershipRevision).toMatchObject({ type: 'Int', isRequired: true, default: 0 });
    expect(dmmfModel('RenewalOpportunity').fields.map((field) => field.name)).not.toContain('revision');
    expect(uniqueIndex('RenewalOpportunity', ['subscriptionId'])).toBe(true);
    for (const field of ['renewalOpportunityId', 'thresholdDays', 'idempotencyKey', 'createdAt'] as const) {
      expect(dmmfField('RenewalReminderEvent', field).isRequired).toBe(true);
    }
    for (const relation of ['renewalOpportunity', 'workTask', 'notificationEvent'] as const) {
      expect(dmmfField('RenewalReminderEvent', relation).relationOnDelete).toBe('Restrict');
    }
    expect(uniqueIndex('RenewalReminderEvent', ['renewalOpportunityId', 'thresholdDays'])).toBe(true);
  });

  it('contains the named Restrict/NOT VALID migration contract and each Prisma index has a hand-written SQL index', () => {
    const sql = readU037Migration();
    expect(sql).toMatch(/ADD CONSTRAINT "renewal_opportunities_asset_id_fkey"\s+FOREIGN KEY \("asset_id"\) REFERENCES "customer_assets"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;/);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.renewal_opportunities_owner_scope_guard_fn()');
    expect(sql.match(/CREATE TRIGGER renewal_opportunities_owner_scope_guard_trg/g)).toHaveLength(1);
    for (const name of [
      'delivery_acceptances_engagement_id_key', 'delivery_acceptances_idempotency_key_key',
      'customer_assets_delivery_acceptance_source_line_uidx', 'asset_licenses_delivery_acceptance_source_line_uidx',
      'subscriptions_delivery_acceptance_source_line_uidx', 'renewal_opportunities_subscription_id_key',
      'renewal_reminder_events_opportunity_threshold_key',
    ]) expect(sql).toContain(`"${name}"`);
    for (const name of [
      'delivery_acceptances_quote_id_idx', 'delivery_acceptances_artifact_version_id_idx', 'delivery_acceptances_accepted_by_assignment_id_idx',
      'customer_assets_delivery_acceptance_id_idx', 'customer_assets_source_quote_line_item_id_idx',
      'asset_licenses_delivery_acceptance_id_idx', 'asset_licenses_source_quote_line_item_id_idx',
      'subscriptions_delivery_acceptance_id_idx', 'subscriptions_source_quote_line_item_id_idx',
      'renewal_opportunities_asset_id_idx', 'renewal_opportunities_subscription_id_idx', 'renewal_opportunities_opportunity_id_idx',
      'renewal_opportunities_owner_assignment_revision_idx', 'renewal_opportunities_idempotency_key_idx',
      'renewal_reminder_events_work_task_id_idx', 'renewal_reminder_events_notification_event_id_idx',
    ]) expect(sql).toContain(`CREATE INDEX "${name}"`);
  });

  it('proves the unmodified inventory checker rejects both U037 models until each has its one mandatory child entry', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    const unclassified = Object.values(MODEL_SCOPE_INVENTORY).filter((entry) => !['DeliveryAcceptance', 'RenewalReminderEvent'].includes(entry.model));
    const rejected = buildScopeInventoryReport(modelNames, unclassified);
    expect(rejected.ok).toBe(false);
    expect(rejected.missingModels).toEqual(['DeliveryAcceptance', 'RenewalReminderEvent']);
    expect(MODEL_SCOPE_INVENTORY.DeliveryAcceptance).toMatchObject({ model: 'DeliveryAcceptance', category: 'CHILD_VIA_FK', parentModel: 'Engagement', relationField: 'engagement', scalarFkField: 'engagementId', nullable: false });
    expect(MODEL_SCOPE_INVENTORY.RenewalReminderEvent).toMatchObject({ model: 'RenewalReminderEvent', category: 'CHILD_VIA_FK', parentModel: 'RenewalOpportunity', relationField: 'renewalOpportunity', scalarFkField: 'renewalOpportunityId', nullable: false });
  });
});
