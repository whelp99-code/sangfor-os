import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_SCOPE_INVENTORY, buildScopeInventoryReport } from './scope-inventory';

const MIGRATION = join(__dirname, '../prisma/migrations/20260716004200_u042_retention_legal_hold_ownership_expand/migration.sql');
const FIXTURE = join(__dirname, 'fixtures/u042-governance-pre-migration.sql');
const RUNNER = join(__dirname, '../scripts/run-db-contract.ts');
const NEW_MODELS = [
  'RetentionPolicy', 'RetentionPolicyVersion', 'RetentionAssignment', 'LegalHold', 'LegalHoldScope',
  'RetentionRun', 'RetentionRunItem', 'ExportCapability', 'OwnershipTransfer', 'OwnershipTransferItem',
] as const;

function model(name: string) {
  const found = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing Prisma model ${name}`);
  return found;
}

function field(modelName: string, fieldName: string) {
  const found = model(modelName).fields.find((candidate) => candidate.name === fieldName);
  if (!found) throw new Error(`missing ${modelName}.${fieldName}`);
  return found;
}

describe('U042 GOV-01 governance schema contract', () => {
  it('adds exactly the ten planned Prisma models and preserves the 189-model inventory', () => {
    expect(Prisma.dmmf.datamodel.models).toHaveLength(189);
    for (const name of NEW_MODELS) expect(model(name)).toBeDefined();
    const report = buildScopeInventoryReport(Prisma.dmmf.datamodel.models.map((candidate) => candidate.name), Object.values(MODEL_SCOPE_INVENTORY));
    expect(report).toMatchObject({ ok: true, currentModelCount: 189, missingModels: [], unknownModels: [], duplicateModels: [], errors: [] });
  });

  it('uses canonical activation/company authority rather than legacy fields or nullable artifact correlation', () => {
    for (const name of ['DataExportRequest', 'ArtifactAccessEvent']) {
      expect(field(name, 'canonicalActivatedAt').dbName).toBe('canonical_activated_at');
      expect(field(name, 'companyId').dbName).toBe('company_id');
      expect(field(name, 'artifactVersionId').isRequired).toBe(false);
    }
    expect(field('DataExportRequest', 'canonicalStatus').dbName).toBe('canonical_status');
    expect(field('ArtifactAccessEvent', 'accessType').dbName).toBe('canonical_access_type');
    expect(field('ArtifactAccessEvent', 'createdAt').dbName).toBe('canonical_created_at');
  });

  it('pins immutable retention receipts and ownership tuples to restrictive parents', () => {
    for (const name of ['phase', 'status', 'revision', 'previewHash', 'inputHash', 'auditLogId']) expect(field('RetentionRun', name).isRequired).toBe(true);
    for (const name of ['retentionRunId', 'phase', 'ordinal', 'resourceKind', 'resourceId', 'documentId', 'projectId', 'policyVersionId', 'preActionHash', 'holdSetHash', 'decision', 'outcome']) expect(field('RetentionRunItem', name).isRequired).toBe(true);
    expect(field('RetentionRunItem', 'retentionRun').relationOnDelete).toBe('Restrict');
    expect(field('OwnershipTransferItem', 'ownershipTransfer').relationOnDelete).toBe('Restrict');
    expect(field('ExportCapability', 'exportRequest').relationOnDelete).toBe('Restrict');
  });

  it('declares the checked migration, exact authority names, and no raw target-content receipt field', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const trigger of [
      'retention_runs_immutable_update_trg', 'retention_runs_immutable_delete_trg',
      'retention_run_items_immutable_update_trg', 'retention_run_items_immutable_delete_trg',
      'retention_policy_versions_immutable_update_trg', 'retention_policy_versions_immutable_delete_trg',
      'legal_hold_scopes_immutable_update_trg', 'legal_hold_scopes_immutable_delete_trg',
      'artifact_access_events_canonical_insert_guard_trg', 'artifact_access_events_immutable_update_trg', 'artifact_access_events_immutable_delete_trg',
      'data_export_requests_canonical_insert_guard_trg', 'data_export_requests_lifecycle_update_guard_trg', 'data_export_requests_immutable_delete_trg',
      'export_capabilities_canonical_insert_guard_trg', 'export_capabilities_lifecycle_update_guard_trg', 'export_capabilities_immutable_delete_trg',
      'ownership_transfers_canonical_insert_guard_trg', 'ownership_transfers_lifecycle_update_guard_trg', 'ownership_transfers_immutable_delete_trg',
      'ownership_transfer_items_canonical_insert_guard_trg', 'ownership_transfer_items_immutable_update_trg', 'ownership_transfer_items_immutable_delete_trg',
    ]) expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
    expect(sql).toContain('data_export_requests_canonical_activation_chk');
    expect(sql).toContain('artifact_access_events_canonical_activation_chk');
    expect(model('RetentionRunItem').fields.some((candidate) => /^(content|body|payload)$/i.test(candidate.name))).toBe(false);
  });

  it('enumerates immutable lifecycle identity fields while preserving only the exact transition surfaces', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const exportLifecycle = sql.match(/CREATE OR REPLACE FUNCTION public\.data_export_requests_lifecycle_update_guard_fn\(\)[\s\S]*?\$fn\$;/)?.[0] ?? '';
    const capabilityLifecycle = sql.match(/CREATE OR REPLACE FUNCTION public\.export_capabilities_lifecycle_update_guard_fn\(\)[\s\S]*?\$fn\$;/)?.[0] ?? '';
    const transferLifecycle = sql.match(/CREATE OR REPLACE FUNCTION public\.ownership_transfers_lifecycle_update_guard_fn\(\)[\s\S]*?\$fn\$;/)?.[0] ?? '';

    for (const name of ['artifact_content_hash', 'classification', 'requested_by_assignment_id', 'request_input_hash', 'audit_log_id', 'expires_at']) {
      expect(exportLifecycle).toContain(`NEW.${name}`);
      expect(exportLifecycle).toContain(`OLD.${name}`);
    }
    for (const name of ['export_request_id', 'artifact_version_id', 'requester_assignment_id', 'token_digest', 'expires_at']) {
      expect(capabilityLifecycle).toContain(`NEW.${name}`);
      expect(capabilityLifecycle).toContain(`OLD.${name}`);
    }
    for (const name of ['role_change_request_id', 'source_assignment_id', 'successor_assignment_id', 'preview_hash', 'item_count', 'preview_input_hash', 'preview_audit_log_id']) {
      expect(transferLifecycle).toContain(`NEW.${name}`);
      expect(transferLifecycle).toContain(`OLD.${name}`);
    }
    expect(transferLifecycle).toContain('NEW.revision <> OLD.revision + 1');
    expect(transferLifecycle).toContain('ownership transfer tuple count/order/hash mismatch');
  });

  it('DB-enforces company correlations, enum/denial vocabulary, and dry-run/local-purge identities', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const constraint of [
      'data_export_requests_company_bindings_chk',
      'artifact_access_events_company_bindings_chk',
      'legal_hold_scopes_company_bindings_chk',
      'retention_runs_company_bindings_chk',
    ]) {
      expect(sql).toContain(constraint);
    }
    expect(sql).toContain("'public','internal','confidential','restricted'");
    expect(sql).toContain("'view','copy','download','export','share','print'");
    expect(sql).toContain("'allowed','denied'");
    expect(sql).toContain(`"policy_result" = 'allowed' AND "denial_reason" IS NULL`);
    expect(sql).toContain(`"policy_result" = 'denied'`);
    expect(sql).toContain(`"execution_mode" = 'dry_run'`);
    expect(sql).toContain(`"would_purge_count" = "candidate_count"`);
    expect(sql).toContain(`"execution_mode" = 'local_purge'`);
    expect(sql).toContain(`"purged_count" <= "max_items"`);
    expect(sql).toContain('retention_run_items_parent_shape_chk');
  });

  it('uses the U017 RFC8785 JCS canonicalizer for quarantine hashes and proves a real U041-prefix upgrade', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const fixture = readFileSync(FIXTURE, 'utf8');
    const runner = readFileSync(RUNNER, 'utf8');
    const governanceRunner = runner.slice(runner.indexOf('export async function runGovernanceSchemaSuite'));

    expect(sql).toContain('public.sangfor_sha256_utf8(public.sangfor_rfc8785_jcs_v1(');
    expect(sql).not.toContain('jsonb text is canonical');
    expect(governanceRunner).toContain(`name <= NEW_MIGRATION_NAME_U041`);
    expect(governanceRunner).toContain(`migrate: false`);
    expect(governanceRunner).toContain(`src/fixtures/u042-governance-pre-migration.sql`);
    expect(governanceRunner.indexOf('const beforeRaw = await execSql')).toBeLessThan(governanceRunner.indexOf('addMigrationToView(view, NEW_MIGRATION_NAME_U042)'));
    expect(governanceRunner).toContain(`runMigrateDiff(ctx.databaseUrl, true)`);
    expect(governanceRunner).toContain(`No difference detected`);
    for (const table of [
      'data_export_requests',
      'artifact_access_events',
      'artifacts',
      'approval_requests',
      'opportunities',
      'work_tasks',
      'vendor_requests',
      'renewal_opportunities',
      'support_cases',
    ]) {
      expect(fixture).toContain(`INSERT INTO ${table}`);
    }
  });

  it('pins the behavioral matrix and exact 10-function/23-trigger catalog assertions', () => {
    const runner = readFileSync(RUNNER, 'utf8');
    for (const marker of [
      'export same-transition immutable hash tamper denied',
      'capability same-transition digest tamper denied',
      'cross-company legal hold artifact version denied',
      'cross-company retention manifest denied',
      'dry run purged count identity denied',
      'local purge would-purge count identity denied',
      'forged ownership preview hash denied by final tuple',
      'ownership item parent owner mismatch denied',
      'no-op update denied',
      'delete denied',
    ]) {
      expect(runner).toContain(marker);
    }
    expect(runner).toContain('authorityRows.length !== 23');
    expect(runner).toContain('observedFunctions.length !== 10');
    expect(runner).toContain('row.eventCount !== 1');
  });
});
