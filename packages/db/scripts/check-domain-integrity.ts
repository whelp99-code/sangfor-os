/** U040 full read-only (rollback-only negative probes) domain integrity receipt. */
import { Prisma } from '@prisma/client';

import { prisma } from '../src/index';
import {
  MODEL_SCOPE_INVENTORY,
  REGISTERED_ADDITIONS,
  SCOPE_INVENTORY_BASELINE,
  assertScopeBridgeOnDelete,
  buildScopeInventoryReport,
  deriveStructuralMismatches,
  expectedCategoryCounts,
  expectedCurrentModelCount,
  validateChildViaFkEntries,
  type DmmfRelationField,
  type ScopeInventoryEntry,
} from '../src/scope-inventory';

const client = prisma as any;

const OWNER_AND_PAIR_GUARDS = [
  ['opportunities_owner_scope_guard_trg', 'opportunities_owner_scope_guard_fn', 'opportunities'],
  ['work_tasks_owner_scope_guard_trg', 'work_tasks_owner_scope_guard_fn', 'work_tasks'],
  ['product_skus_catalog_scope_guard_trg', 'product_skus_catalog_scope_guard_fn', 'product_skus'],
  ['sizing_templates_catalog_scope_guard_trg', 'sizing_templates_catalog_scope_guard_fn', 'sizing_templates'],
  ['compatibility_rules_catalog_scope_guard_trg', 'compatibility_rules_catalog_scope_guard_fn', 'compatibility_rules'],
  ['vendor_requests_owner_scope_guard_trg', 'vendor_requests_owner_scope_guard_fn', 'vendor_requests'],
  ['renewal_opportunities_owner_scope_guard_trg', 'renewal_opportunities_owner_scope_guard_fn', 'renewal_opportunities'],
  ['support_sla_policies_current_version_guard_trg', 'support_sla_policies_current_version_guard_fn', 'support_sla_policies'],
  ['support_cases_owner_scope_guard_trg', 'support_cases_owner_scope_guard_fn', 'support_cases'],
  ['vendor_escalations_pair_state_guard_trg', 'vendor_escalations_pair_state_guard_fn', 'vendor_escalations'],
] as const;

const U035_U036_TRIGGER_NAMES = [
  'quotes_canonical_immutable_update_trg', 'quotes_canonical_immutable_delete_trg',
  'quote_commercial_snapshots_immutable_update_trg', 'quote_commercial_snapshots_immutable_delete_trg',
  'vendor_request_events_immutable_update_trg', 'vendor_request_events_immutable_delete_trg',
] as const;
const U038_TRIGGER_NAMES = [
  'engineer_certifications_canonical_insert_guard_trg', 'engineer_certifications_lifecycle_update_guard_trg', 'engineer_certifications_immutable_delete_trg',
  'certification_evidence_scope_guard_trg', 'certification_evidence_immutable_update_guard_trg', 'certification_evidence_immutable_delete_trg',
] as const;

// The U033-U039 FK surface whose delete semantics preserve immutable/provenance history.  U032
// owner references and U034 assessor are intentionally SetNull compatibility links, so are not
// part of this Restrict/NoAction receipt.
const RESTRICT_FKS = [
  'product_families_company_id_fkey', 'product_editions_family_id_fkey', 'license_metrics_product_family_id_fkey', 'product_skus_license_metric_id_fkey', 'sizing_templates_artifact_id_fkey', 'sizing_templates_active_artifact_version_id_fkey', 'compatibility_rules_artifact_id_fkey', 'compatibility_rules_active_artifact_version_id_fkey',
  'quote_line_items_quote_id_fkey', 'quotes_supersedes_quote_id_fkey', 'quotes_artifact_version_id_fkey', 'quote_line_items_source_service_line_item_id_fkey', 'quote_line_items_product_family_id_fkey', 'quote_line_items_product_edition_id_fkey', 'quote_line_items_license_metric_id_fkey', 'quote_line_items_sizing_artifact_version_id_fkey', 'quote_commercial_snapshots_quote_id_fkey',
  'discount_requests_quote_id_fkey', 'vendor_request_events_request_id_fkey', 'discount_requests_approval_request_id_fkey', 'discount_requests_requested_by_assignment_id_fkey', 'vendor_requests_quote_id_fkey', 'vendor_requests_discount_request_id_fkey', 'vendor_requests_customer_id_fkey', 'vendor_requests_requested_by_assignment_id_fkey', 'vendor_requests_owner_assignment_id_fkey', 'vendor_requests_submission_evidence_artifact_version_id_fkey', 'vendor_request_events_actor_assignment_id_fkey', 'demo_licenses_vendor_request_id_fkey', 'demo_licenses_product_sku_id_fkey', 'demo_licenses_customer_id_fkey',
  'delivery_acceptances_engagement_id_fkey', 'delivery_acceptances_quote_id_fkey', 'delivery_acceptances_artifact_version_id_fkey', 'delivery_acceptances_accepted_by_assignment_id_fkey', 'customer_assets_delivery_acceptance_id_fkey', 'customer_assets_source_quote_line_item_id_fkey', 'customer_assets_product_family_id_fkey', 'customer_assets_product_sku_id_fkey', 'asset_licenses_delivery_acceptance_id_fkey', 'asset_licenses_source_quote_line_item_id_fkey', 'subscriptions_delivery_acceptance_id_fkey', 'subscriptions_asset_license_id_fkey', 'subscriptions_source_quote_line_item_id_fkey', 'renewal_opportunities_customer_id_fkey', 'renewal_opportunities_asset_id_fkey', 'renewal_opportunities_subscription_id_fkey', 'renewal_opportunities_opportunity_id_fkey', 'renewal_opportunities_owner_assignment_id_fkey', 'renewal_reminder_events_renewal_opportunity_id_fkey', 'renewal_reminder_events_work_task_id_fkey', 'renewal_reminder_events_notification_event_id_fkey',
  'certification_definitions_company_id_fkey', 'certification_definitions_product_family_id_fkey', 'certification_evidence_certification_id_fkey', 'certification_evidence_artifact_version_id_fkey', 'certification_evidence_verified_by_assignment_id_fkey', 'engineer_skills_company_id_fkey', 'engineer_skills_engineer_membership_id_fkey', 'engineer_skills_product_family_id_fkey', 'engineer_skills_source_artifact_version_id_fkey', 'engineer_skills_verified_by_assignment_id_fkey', 'engineer_eligibility_policies_company_id_fkey', 'engineer_eligibility_policies_product_family_id_fkey', 'engineer_eligibility_policies_certification_definition_id_fkey', 'engagement_capability_requirements_engagement_id_fkey', 'engagement_capability_requirements_eligibility_policy_id_fkey', 'engagement_capability_requirements_product_family_id_fkey', 'engagement_capability_requirements_cert_definition_id_fkey', 'engineer_assignments_requirement_id_fkey', 'engineer_assignments_engineer_membership_id_fkey', 'engineer_assignments_assigned_by_assignment_id_fkey', 'engineer_certifications_definition_id_fkey', 'engineer_certifications_engineer_membership_id_fkey',
  'support_sla_policies_company_id_fkey', 'support_sla_policies_current_version_id_fkey', 'support_sla_policy_versions_company_id_fkey', 'support_sla_policy_versions_policy_company_fkey', 'support_cases_customer_id_fkey', 'support_cases_asset_id_fkey', 'support_cases_owner_assignment_id_fkey', 'support_cases_rca_artifact_version_id_fkey', 'support_case_sla_snapshots_support_case_id_fkey', 'support_case_sla_snapshots_policy_version_id_fkey', 'vendor_escalations_case_id_fkey', 'vendor_escalations_vendor_request_id_fkey', 'vendor_escalations_submission_evidence_artifact_version_id_fkey',
] as const;

const DEFERRED_VALIDATION_NAMES = [
  'product_families_company_required_chk', 'renewal_opportunities_asset_id_fkey',
  'deal_qualifications_budget_score_bant_tf_range_chk', 'deal_qualifications_authority_score_bant_tf_range_chk', 'deal_qualifications_need_score_bant_tf_range_chk', 'deal_qualifications_timeline_score_bant_tf_range_chk', 'deal_qualifications_technical_fit_score_bant_tf_range_chk', 'deal_qualifications_score_total_bant_tf_range_chk', 'deal_qualifications_revision_bant_tf_positive_chk', 'deal_qualifications_assessed_by_assignment_id_fkey',
  'quotes_content_hash_format_chk', 'quote_commercial_snapshots_snapshot_hash_format_chk', 'quote_line_fulfillment_v1_complete_chk',
  'engineer_certifications_status_chk', 'engineer_certifications_revision_chk', 'engineer_certifications_lifecycle_chk', 'engineer_certifications_definition_id_fkey', 'engineer_certifications_engineer_membership_id_fkey',
  'support_sla_policies_company_required_chk', 'support_sla_policies_company_id_fkey', 'support_sla_policies_current_version_id_fkey', 'support_sla_policy_versions_values_chk', 'support_sla_policy_versions_company_id_fkey', 'support_sla_policy_versions_policy_company_fkey', 'support_cases_customer_id_fkey', 'support_cases_asset_id_fkey', 'support_cases_owner_assignment_id_fkey', 'support_cases_rca_artifact_version_id_fkey', 'support_case_sla_snapshots_values_chk', 'support_case_sla_snapshots_support_case_id_fkey', 'support_case_sla_snapshots_policy_version_id_fkey',
  ...RESTRICT_FKS,
] as const;

function literals(values: readonly string[]) { return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(','); }
async function rows<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T[]> { return client.$queryRawUnsafe(sql, ...params); }
async function count(sql: string): Promise<number> { return Number((await rows<{ count: number }>(sql))[0]?.count ?? 0); }
function dmmfRelations(): DmmfRelationField[] {
  const relations: DmmfRelationField[] = [];
  for (const model of Prisma.dmmf.datamodel.models) for (const field of model.fields) {
    if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
    const scalarFkFields = [...field.relationFromFields];
    relations.push({ model: model.name, relationField: field.name, targetModel: field.type, scalarFkFields, mandatory: field.isRequired !== false && scalarFkFields.every((name) => model.fields.find((item) => item.name === name)?.isRequired), onDelete: field.relationOnDelete ?? null });
  }
  return relations;
}
async function rollbackReject(sql: string): Promise<boolean> {
  let rejected = false;
  await client.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SAVEPOINT u040_integrity_negative');
    try { await tx.$executeRawUnsafe(sql); } catch { rejected = true; await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT u040_integrity_negative'); }
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT u040_integrity_negative');
  });
  return rejected;
}

async function main() {
  const triggerRows = await rows<{ trigger: string; fn: string; table: string; enabled: string }>(`SELECT trigger.tgname AS trigger, function.proname AS fn, relation.relname AS table, trigger.tgenabled AS enabled FROM pg_trigger trigger JOIN pg_proc function ON function.oid=trigger.tgfoid JOIN pg_class relation ON relation.oid=trigger.tgrelid WHERE NOT trigger.tgisinternal`);
  const triggerByName = new Map(triggerRows.map((row) => [row.trigger, row]));
  const guards = OWNER_AND_PAIR_GUARDS.map(([trigger, fn, table]) => ({ trigger, function: fn, table, actual: triggerByName.get(trigger) ?? null, ok: triggerByName.get(trigger)?.fn === fn && triggerByName.get(trigger)?.table === table && triggerByName.get(trigger)?.enabled === 'O' }));
  const six035036 = U035_U036_TRIGGER_NAMES.map((trigger) => ({ trigger, actual: triggerByName.get(trigger) ?? null, ok: triggerByName.get(trigger)?.enabled === 'O' }));
  const six038 = U038_TRIGGER_NAMES.map((trigger) => ({ trigger, actual: triggerByName.get(trigger) ?? null, ok: triggerByName.get(trigger)?.enabled === 'O' }));

  const foreignKeys = await rows<{ name: string; delete_action: string; validated: boolean }>(`SELECT conname AS name, confdeltype AS delete_action, convalidated AS validated FROM pg_constraint WHERE contype='f' AND conname IN (${literals(RESTRICT_FKS)}) ORDER BY conname`);
  const fkByName = new Map(foreignKeys.map((row) => [row.name, row]));
  const fkReceipt = RESTRICT_FKS.map((name) => ({ name, ...(fkByName.get(name) ?? { delete_action: null, validated: false }), ok: ['r', 'a'].includes(fkByName.get(name)?.delete_action ?? '') }));
  const deferred = await rows<{ name: string; validated: boolean }>(`SELECT conname AS name, convalidated AS validated FROM pg_constraint WHERE conname IN (${literals([...new Set(DEFERRED_VALIDATION_NAMES)])}) ORDER BY conname`);
  const deferredNames = new Set(deferred.map((row) => row.name));
  const invalidValidatedConstraints = deferred.filter((row) => !row.validated).map((row) => row.name).sort();
  const missingDeferredConstraints = [...new Set(DEFERRED_VALIDATION_NAMES)].filter((name) => !deferredNames.has(name)).sort();

  const ownershipTables = ['opportunities', 'work_tasks', 'vendor_requests', 'renewal_opportunities', 'support_cases'];
  const negativeOwnership = Object.fromEntries(await Promise.all(ownershipTables.map(async (table) => [table, await count(`SELECT count(*)::int AS count FROM ${table} WHERE ownership_revision < 0`)])));
  const ownershipFunctions = await rows<{ name: string; definition: string }>(`SELECT proname AS name, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname IN ('opportunities_owner_scope_guard_fn','work_tasks_owner_scope_guard_fn','vendor_requests_owner_scope_guard_fn','renewal_opportunities_owner_scope_guard_fn','support_cases_owner_scope_guard_fn')`);
  const casContracts = ownershipFunctions.map((row) => ({ name: row.name, requiresCompareAndSwap: /ownership_revision[\s\S]*\+ 1/.test(row.definition), ownerOnlyMutation: /may change only|owner_assignment_id change requires/.test(row.definition) }));
  const opportunityOwner = await rows<{ id: string }>("SELECT id FROM opportunities WHERE id='u040_opportunity' AND owner_assignment_id IS NOT NULL AND ownership_revision=0");
  const ownerCas = opportunityOwner.length === 1 ? {
    staleAffected: await count("SELECT count(*)::int AS count FROM opportunities WHERE id='u040_opportunity' AND owner_assignment_id='not-the-owner' AND ownership_revision=0"),
    replayAffected: await count("SELECT count(*)::int AS count FROM opportunities WHERE id='u040_opportunity' AND owner_assignment_id IS NULL AND ownership_revision=0"),
    successSnapshot: await rows("SELECT owner_assignment_id, ownership_revision FROM opportunities WHERE id='u040_opportunity'"),
  } : { staleAffected: 0, replayAffected: 0, successSnapshot: [] };

  const certificationRows = await rows<{ id: string }>("SELECT id FROM engineer_certifications WHERE id='u040_certification' AND status='legacy_unverified' AND revision=0");
  const rollbackOnly = {
    certificationIllegalUpdateRejected: certificationRows.length === 1 ? await rollbackReject("UPDATE engineer_certifications SET \"productName\"='illegal' WHERE id='u040_certification'") : false,
    certificationIllegalDeleteRejected: certificationRows.length === 1 ? await rollbackReject("DELETE FROM engineer_certifications WHERE id='u040_certification'") : false,
    evidenceUpdateGuardPresent: triggerByName.get('certification_evidence_immutable_update_guard_trg')?.enabled === 'O',
    evidenceDeleteGuardPresent: triggerByName.get('certification_evidence_immutable_delete_trg')?.enabled === 'O',
    matrixFunctions: (await rows<{ name: string; definition: string }>("SELECT proname AS name, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname IN ('engineer_certifications_lifecycle_update_guard_fn','engineer_certifications_immutable_delete_fn','certification_evidence_scope_guard_fn','certification_evidence_immutable_update_guard_fn','certification_evidence_immutable_delete_fn')")).map((row) => ({ name: row.name, rejects: /RAISE EXCEPTION/.test(row.definition) })),
  };

  const dmmf = dmmfRelations(); const entries: ScopeInventoryEntry[] = Object.values(MODEL_SCOPE_INVENTORY);
  const inventory = buildScopeInventoryReport(Prisma.dmmf.datamodel.models.map((model) => model.name), entries);
  const scopeErrors = [...inventory.errors, ...validateChildViaFkEntries(entries, dmmf), ...deriveStructuralMismatches(entries, dmmf)];
  const projectCompany = dmmf.find((relation) => relation.model === 'Project' && relation.relationField === 'company');
  const scopeBridge = assertScopeBridgeOnDelete(projectCompany?.onDelete ?? null);
  const expectedModelCount = expectedCurrentModelCount();
  const expectedTallies = expectedCategoryCounts();
  const m1 = {
    literalBaseline: { modelCount: 150, tallies: { GLOBAL_SHARED: 13, TENANT_ROOT: 1, COMPANY_ROOT: 32, PROJECT_ROOT: 44, CHILD_VIA_FK: 60 }, recorded: SCOPE_INVENTORY_BASELINE },
    exactAdditions: { count: REGISTERED_ADDITIONS.length, uniqueCount: new Set(REGISTERED_ADDITIONS.map((item) => item.model)).size, additions: REGISTERED_ADDITIONS },
    current: { modelCount: Prisma.dmmf.datamodel.models.length, registryCount: Object.keys(MODEL_SCOPE_INVENTORY).length, tallies: inventory.tallies },
    closure: { missing: inventory.missingModels.length, stale: inventory.unknownModels.length, duplicate: inventory.duplicateModels.length, ambiguous: scopeErrors.filter((error) => error.code === 'AMBIGUOUS_ROOT').length, optionalOnlyFk: scopeErrors.filter((error) => error.code === 'NULLABLE_CHAIN' || error.code === 'DEAD_END_CHAIN').length, errors: scopeErrors, projectCompanyRestrict: scopeBridge.ok },
  };

  const data = {
    renewalAssetOrphan: await count('SELECT count(*)::int AS count FROM renewal_opportunities renewal LEFT JOIN customer_assets asset ON asset.id=renewal.asset_id WHERE renewal.asset_id IS NOT NULL AND asset.id IS NULL'),
    catalogNull: await count('SELECT (SELECT count(*) FROM product_families WHERE company_id IS NULL)+(SELECT count(*) FROM license_metrics WHERE product_family_id IS NULL) AS count'),
    catalogDuplicate: await count('SELECT count(*)::int AS count FROM (SELECT lower(vendor), lower(name) FROM product_families GROUP BY lower(vendor), lower(name) HAVING count(*) > 1) duplicate'),
    opportunityOwnerCrossScope: await count('SELECT count(*)::int AS count FROM opportunities opportunity JOIN projects project ON project.id=opportunity.project_id JOIN user_company_roles assignment ON assignment.id=opportunity.owner_assignment_id WHERE opportunity.owner_assignment_id IS NOT NULL AND assignment.company_id IS DISTINCT FROM project.company_id'),
    unresolvedQuarantine: await rows('SELECT source_model, reason_code, count(*)::int AS count FROM scope_backfill_quarantine WHERE resolved_at IS NULL GROUP BY source_model, reason_code ORDER BY source_model, reason_code'),
    explicitNullable: { supportCasesWithoutDeadlineAndSnapshot: await count('SELECT count(*)::int AS count FROM support_cases support WHERE support.sla_deadline IS NULL AND NOT EXISTS (SELECT 1 FROM support_case_sla_snapshots snapshot WHERE snapshot.support_case_id=support.id)') },
    unknownCategoryCount: await count("SELECT count(*)::int AS count FROM scope_backfill_quarantine WHERE lower(reason_code) LIKE '%unknown%'"),
  };
  const report = {
    schemaVersion: 2,
    guardPairs: guards,
    sixU035U036Triggers: six035036,
    sixU038Triggers: six038,
    restrictForeignKeys: fkReceipt,
    validatedDeferredConstraints: { invalid: invalidValidatedConstraints, missing: missingDeferredConstraints, count: deferred.length },
    ownership: { nonNegative: negativeOwnership, casContracts, staleAndReplay: ownerCas, u059SnapshotNamed: 'ownershipRevision compare-and-swap receipt' },
    rollbackOnly,
    m1,
    data,
  };
  const ok = guards.every((item) => item.ok) && six035036.every((item) => item.ok) && six038.every((item) => item.ok)
    && fkReceipt.every((item) => item.ok) && invalidValidatedConstraints.length === 0 && missingDeferredConstraints.length === 0
    && Object.values(negativeOwnership).every((value) => value === 0) && casContracts.length === 5 && casContracts.every((item) => item.requiresCompareAndSwap && item.ownerOnlyMutation)
    && ownerCas.staleAffected === 0 && ownerCas.replayAffected === 0 && rollbackOnly.certificationIllegalUpdateRejected && rollbackOnly.certificationIllegalDeleteRejected && rollbackOnly.evidenceUpdateGuardPresent && rollbackOnly.evidenceDeleteGuardPresent && rollbackOnly.matrixFunctions.every((item) => item.rejects)
    && m1.exactAdditions.count === m1.exactAdditions.uniqueCount && m1.current.modelCount === expectedModelCount && m1.current.registryCount === expectedModelCount && Object.entries(expectedTallies).every(([category, count]) => m1.current.tallies[category as keyof typeof m1.current.tallies] === count) && m1.closure.missing === 0 && m1.closure.stale === 0 && m1.closure.duplicate === 0 && m1.closure.ambiguous === 0 && m1.closure.optionalOnlyFk === 0 && m1.closure.projectCompanyRestrict
    && data.renewalAssetOrphan === 0 && data.catalogNull === 0 && data.catalogDuplicate === 0 && data.opportunityOwnerCrossScope === 0 && data.unresolvedQuarantine.length === 0 && data.unknownCategoryCount === 0;
  process.stdout.write(`${JSON.stringify({ ...report, ok }, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => { process.stderr.write(`U040_INTEGRITY_REJECTED ${String(error)}\n`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
