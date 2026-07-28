import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { dmmfField, dmmfIndex, dmmfModel, executableSql } from './helpers';

const U033_MIGRATION_NAME = '20260716003300_u033_catalog_sizing_compat_expand';
const U033_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U033_MIGRATION_NAME, 'migration.sql');

function readU033Migration(): string {
  return readFileSync(U033_MIGRATION_PATH, 'utf8');
}

function expectScalar(model: string, field: string, type: string, required: boolean, dbName: string) {
  const candidate = dmmfField(model, field);
  expect(candidate.kind).toBe('scalar');
  expect(candidate.type).toBe(type);
  expect(candidate.isRequired).toBe(required);
  expect(candidate.dbName ?? field).toBe(dbName);
  return candidate;
}

function expectOptionalArtifactLinks(model: 'SizingTemplate' | 'CompatibilityRule') {
  expectScalar(model, 'artifactId', 'String', false, 'artifact_id');
  expectScalar(model, 'activeArtifactVersionId', 'String', false, 'active_artifact_version_id');
  const artifact = dmmfField(model, 'artifact');
  const activeArtifactVersion = dmmfField(model, 'activeArtifactVersion');
  expect(artifact.type).toBe('Artifact');
  expect(artifact.isRequired).toBe(false);
  expect(activeArtifactVersion.type).toBe('ArtifactVersion');
  expect(activeArtifactVersion.isRequired).toBe(false);
}

describe('U033 catalog sizing and compatibility DMMF contract', () => {
  it('keeps the U040-tightened canonical company ownership and lifecycle metadata on ProductFamily', () => {
    expectScalar('ProductFamily', 'companyId', 'String', true, 'company_id');
    expectScalar('ProductFamily', 'familyKey', 'String', false, 'family_key');
    expectScalar('ProductFamily', 'vendorKey', 'String', false, 'vendor_key');
    expectScalar('ProductFamily', 'category', 'String', false, 'category');
    expectScalar('ProductFamily', 'status', 'String', false, 'status');
    expectScalar('ProductFamily', 'archivedAt', 'DateTime', false, 'archived_at');
    expectScalar('ProductFamily', 'createdAt', 'DateTime', false, 'created_at');
    expectScalar('ProductFamily', 'updatedAt', 'DateTime', false, 'updated_at');
    const company = dmmfField('ProductFamily', 'company');
    expect(company.type).toBe('Company');
    expect(company.isRequired).toBe(true);
    expect(company.relationFromFields).toEqual(['companyId']);
    expect(company.relationOnDelete).toBe('Restrict');
    expect(dmmfIndex('ProductFamily', ['companyId', 'status', 'archivedAt', 'updatedAt', 'id'])).toBe(true);
    expect(dmmfIndex('ProductFamily', ['companyId', 'vendorKey', 'familyKey'])).toBe(true);
  });

  it('keeps ProductEdition and ProductSku on their family chain while adding optional compatibility metadata', () => {
    for (const field of ['editionKey', 'status'] as const) expectScalar('ProductEdition', field, 'String', false, field === 'editionKey' ? 'edition_key' : field);
    for (const field of ['archivedAt', 'createdAt', 'updatedAt'] as const) expectScalar('ProductEdition', field, 'DateTime', false, field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
    expect(dmmfField('ProductEdition', 'family').relationOnDelete).toBe('Restrict');
    expect(dmmfIndex('ProductEdition', ['familyId', 'status', 'archivedAt', 'updatedAt', 'id'])).toBe(true);
    expect(dmmfIndex('ProductEdition', ['familyId', 'editionKey'])).toBe(true);

    expectScalar('ProductSku', 'licenseMetricId', 'String', false, 'license_metric_id');
    for (const field of ['currency', 'deploymentType', 'supportLevel', 'status'] as const) expectScalar('ProductSku', field, 'String', false, field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
    expectScalar('ProductSku', 'termMonths', 'Int', false, 'term_months');
    for (const field of ['archivedAt', 'createdAt', 'updatedAt'] as const) expectScalar('ProductSku', field, 'DateTime', false, field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
    expect(dmmfField('ProductSku', 'canonicalLicenseMetric').type).toBe('LicenseMetric');
    expect(dmmfField('ProductSku', 'canonicalLicenseMetric').isRequired).toBe(false);
    expect(dmmfIndex('ProductSku', ['editionId', 'status', 'archivedAt', 'updatedAt', 'id'])).toBe(true);
  });

  it('keeps the U040-tightened LicenseMetric family link', () => {
    expectScalar('LicenseMetric', 'productFamilyId', 'String', true, 'product_family_id');
    expectScalar('LicenseMetric', 'description', 'String', false, 'description');
    expectScalar('LicenseMetric', 'status', 'String', false, 'status');
    expectScalar('LicenseMetric', 'createdAt', 'DateTime', false, 'created_at');
    expectScalar('LicenseMetric', 'updatedAt', 'DateTime', false, 'updated_at');
    const family = dmmfField('LicenseMetric', 'productFamily');
    expect(family.type).toBe('ProductFamily');
    expect(family.isRequired).toBe(true);
    expect(family.relationOnDelete).toBe('Restrict');
    expect(dmmfIndex('LicenseMetric', ['productFamilyId', 'status', 'updatedAt', 'id'])).toBe(true);
  });

  it('uses Artifact and ArtifactVersion pointers for optional, inactive sizing and compatibility drafts', () => {
    expectScalar('SizingTemplate', 'templateKey', 'String', false, 'template_key');
    expectScalar('SizingTemplate', 'status', 'String', false, 'status');
    expectScalar('SizingTemplate', 'createdAt', 'DateTime', false, 'created_at');
    expectScalar('SizingTemplate', 'updatedAt', 'DateTime', false, 'updated_at');
    expectOptionalArtifactLinks('SizingTemplate');
    expect(dmmfIndex('SizingTemplate', ['productFamilyId', 'status', 'updatedAt', 'id'])).toBe(true);
    expect(dmmfIndex('SizingTemplate', ['productFamilyId', 'templateKey'])).toBe(true);

    expectScalar('CompatibilityRule', 'ruleKey', 'String', false, 'rule_key');
    expectScalar('CompatibilityRule', 'severity', 'String', false, 'severity');
    expectScalar('CompatibilityRule', 'status', 'String', false, 'status');
    expectScalar('CompatibilityRule', 'createdAt', 'DateTime', false, 'created_at');
    expectScalar('CompatibilityRule', 'updatedAt', 'DateTime', false, 'updated_at');
    expectOptionalArtifactLinks('CompatibilityRule');
    expect(dmmfIndex('CompatibilityRule', ['sourceSkuId', 'status', 'updatedAt', 'id'])).toBe(true);
    expect(dmmfIndex('CompatibilityRule', ['sourceSkuId', 'ruleKey'])).toBe(true);
  });

  it('lets the generated client type a draft without an active version and an exact Artifact/ArtifactVersion link', () => {
    const sizingDraft: Prisma.SizingTemplateCreateInput = {
      name: 'Draft sizing',
      configJson: { legacy: true },
      family: { connect: { id: 'family-a' } },
    };
    const linkedSizingDraft: Prisma.SizingTemplateCreateInput = {
      name: 'Linked sizing',
      configJson: { canonical: true },
      family: { connect: { id: 'family-a' } },
      artifact: { connect: { id: 'artifact-a' } },
      activeArtifactVersion: { connect: { id: 'artifact-version-a' } },
    };
    expect(sizingDraft.activeArtifactVersion).toBeUndefined();
    expect(linkedSizingDraft.artifact?.connect?.id).toBe('artifact-a');
    expect(linkedSizingDraft.activeArtifactVersion?.connect?.id).toBe('artifact-version-a');
  });

  it('retains legacy inline catalog payloads and creates no shadow version model', () => {
    expectScalar('ProductSku', 'licenseMetric', 'String', false, 'license_metric');
    expectScalar('SizingTemplate', 'configJson', 'Json', true, 'config_json');
    expectScalar('CompatibilityRule', 'configJson', 'Json', true, 'config_json');
    expect(() => dmmfModel('SizingTemplateVersion')).toThrow(/not found/);
    expect(() => dmmfModel('CompatibilityRuleVersion')).toThrow(/not found/);
  });
});

describe('U033 expand migration safety and catalog scope guards', () => {
  it('is expand-only and emits matching index DDL for each new schema index', () => {
    const sql = readU033Migration();
    const executable = executableSql(sql);
    expect(executable).not.toMatch(/(?:^|;)\s*(?:INSERT\s+INTO|UPDATE\s+["a-z_]+|DELETE\s+FROM)\b/im);
    expect(executable).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|INDEX|FUNCTION|TRIGGER)\b/i);
    expect(sql).toMatch(/ALTER TABLE "product_editions" DROP CONSTRAINT "product_editions_family_id_fkey";/);
    expect(sql).toMatch(/ALTER TABLE "product_editions" ADD CONSTRAINT "product_editions_family_id_fkey" FOREIGN KEY \("family_id"\) REFERENCES "product_families"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/);
    expect(executable).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(executable).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);
    expect(sql).toMatch(/ADD CONSTRAINT "product_families_company_required_chk" CHECK \("company_id" IS NOT NULL\) NOT VALID(?:,|;)/);
    for (const index of [
      'product_families_company_id_status_archived_at_updated_at_i_idx',
      'product_families_company_id_vendor_key_family_key_idx',
      'product_editions_family_id_status_archived_at_updated_at_id_idx',
      'product_editions_family_id_edition_key_idx',
      'license_metrics_product_family_id_status_updated_at_id_idx',
      'product_skus_edition_id_status_archived_at_updated_at_id_idx',
      'product_skus_license_metric_id_idx',
      'sizing_templates_product_family_id_status_updated_at_id_idx',
      'sizing_templates_product_family_id_template_key_idx',
      'sizing_templates_artifact_id_active_artifact_version_id_idx',
      'compatibility_rules_source_sku_id_status_updated_at_id_idx',
      'compatibility_rules_source_sku_id_rule_key_idx',
      'compatibility_rules_artifact_id_active_artifact_version_id_idx',
    ]) expect(sql).toMatch(new RegExp(`CREATE INDEX "${index}"`));
  });

  it('installs exact guards so canonical catalog writes cannot be global or cross-company', () => {
    const sql = readU033Migration();
    for (const [table, fn, trigger] of [
      ['product_skus', 'product_skus_catalog_scope_guard_fn', 'product_skus_catalog_scope_guard_trg'],
      ['sizing_templates', 'sizing_templates_catalog_scope_guard_fn', 'sizing_templates_catalog_scope_guard_trg'],
      ['compatibility_rules', 'compatibility_rules_catalog_scope_guard_fn', 'compatibility_rules_catalog_scope_guard_trg'],
    ] as const) {
      expect((sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`, 'g')) ?? []).length).toBe(1);
      expect((sql.match(new RegExp(`CREATE TRIGGER ${trigger}\\s+BEFORE INSERT OR UPDATE ON ${table}`, 'g')) ?? []).length).toBe(1);
    }
    expect(sql).toMatch(/license metric ProductFamily\.companyId differs from SKU ProductFamily\.companyId/);
    expect(sql).toMatch(/Artifact\.companyId differs from SizingTemplate ProductFamily\.companyId/);
    expect(sql).toMatch(/ArtifactVersion does not belong to SizingTemplate\.artifactId/);
    expect(sql).toMatch(/source and target SKU ProductFamily\.companyId values differ/);
    expect(sql).toMatch(/Artifact\.companyId differs from CompatibilityRule ProductFamily\.companyId/);
    expect(sql).toMatch(/ArtifactVersion does not belong to CompatibilityRule\.artifactId/);
    expect(sql).toMatch(/legacy catalog scope is non-canonical and cannot be active, quoted, or imported/);
  });
});
