import { prisma } from '../src/index';
import { fetchTableColumnTypes, type DigestClient } from '../src/governance-bridge';
import { sqlJsonDigestHex } from '../src/scope-backfill';

const LEGACY_ARTIFACT_SOURCE_TYPES = ['GeneratedDocument', 'LegacyWorkflowDefinitionProject'];
const LEGACY_ARTIFACT_VERSION_SOURCE_TYPES = ['DocumentVersion', 'LegacyWorkflowDefinitionProjectVersion'];
const QUARANTINE_SOURCE_MODELS = ['GeneratedDocument', 'DocumentVersion', 'ApprovalRequest', 'Workflow', 'WorkflowStep'];

interface Check {
  name: string;
  ok: boolean;
  detail: unknown;
}

async function countSql(client: DigestClient, sql: string, ...params: unknown[]): Promise<number> {
  const rows = await client.$queryRawUnsafe<{ count: bigint | number }[]>(sql, ...params);
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<number> {
  const client = prisma as unknown as DigestClient;
  const checks: Check[] = [];

  const bridgedArtifactPointerLeak = await countSql(
    client,
    `SELECT count(*)::text AS count FROM artifacts WHERE legacy_source_type = ANY($1::text[]) AND (current_version_id IS NOT NULL OR current_revision <> 0)`,
    LEGACY_ARTIFACT_SOURCE_TYPES,
  );
  checks.push({ name: 'bridged Artifact pointers remain null/revision-zero', ok: bridgedArtifactPointerLeak === 0, detail: { count: bridgedArtifactPointerLeak } });

  const bridgedArtifactOwnershipRevisionLeak = await countSql(
    client,
    `SELECT count(*)::text AS count FROM artifacts WHERE legacy_source_type = ANY($1::text[]) AND ownership_revision <> 0`,
    LEGACY_ARTIFACT_SOURCE_TYPES,
  );
  checks.push({ name: 'bridged Artifact ownershipRevision stays zero (no owner-transfer CAS run against a legacy row)', ok: bridgedArtifactOwnershipRevisionLeak === 0, detail: { count: bridgedArtifactOwnershipRevisionLeak } });

  const versionHashRows = await client.$queryRawUnsafe<{ id: string; content_hash: string; content_json: unknown; content_hash_version: string }[]>(
    `SELECT id, content_hash, content_json, content_hash_version FROM artifact_versions WHERE legacy_source_type = ANY($1::text[])`,
    LEGACY_ARTIFACT_VERSION_SOURCE_TYPES,
  );
  const { parseCanonicalArtifactContent } = await import('../src/canonical-content-hash');
  let hashMismatchCount = 0;
  for (const row of versionHashRows) {
    const recomputed = parseCanonicalArtifactContent(JSON.stringify(row.content_json));
    if (recomputed.contentHash !== row.content_hash || recomputed.contentHashVersion !== row.content_hash_version) hashMismatchCount += 1;
  }
  checks.push({ name: 'every bridged ArtifactVersion content_hash round-trips from its own content_json (no silent mutation)', ok: hashMismatchCount === 0, detail: { checked: versionHashRows.length, mismatches: hashMismatchCount } });

  const denyTriggerCount = await countSql(
    client,
    `SELECT count(*)::text AS count FROM pg_trigger WHERE tgrelid = 'artifact_versions'::regclass AND tgname IN ('sangfor_artifact_versions_deny_update_trg','sangfor_artifact_versions_deny_delete_trg')`,
  );
  checks.push({ name: 'artifact_versions append-only triggers (U017) are installed — bridged versions are immutable', ok: denyTriggerCount === 2, detail: { count: denyTriggerCount } });

  const canonicalApprovalCount = await countSql(client, `SELECT count(*)::text AS count FROM approval_requests WHERE legacy_unbound = false`);
  checks.push({ name: 'zero canonical (legacyUnbound=false) ApprovalRequest rows exist (U020 creates none)', ok: canonicalApprovalCount === 0, detail: { count: canonicalApprovalCount } });

  const validApprovalCount = await countSql(client, `SELECT count(*)::text AS count FROM approval_current_validity WHERE state = 'valid'`);
  checks.push({ name: 'zero ApprovalCurrentValidity.state=valid rows exist', ok: validApprovalCount === 0, detail: { count: validApprovalCount } });

  const manufacturedDecisionCount = await countSql(client, `SELECT count(*)::text AS count FROM approval_decisions`);
  checks.push({ name: 'zero ApprovalDecision rows exist (none manufactured from legacy status/reason strings)', ok: manufacturedDecisionCount === 0, detail: { count: manufacturedDecisionCount } });

  const activeWorkflowDefinitionCount = await countSql(client, `SELECT count(*)::text AS count FROM workflow_definitions WHERE status = 'active'`);
  checks.push({ name: 'zero active WorkflowDefinition rows exist (no bridged definition is ever activated)', ok: activeWorkflowDefinitionCount === 0, detail: { count: activeWorkflowDefinitionCount } });

  const legacyDefinitionSnapshotLeak = await countSql(
    client,
    `SELECT count(*)::text AS count
     FROM workflow_definitions wd
     JOIN artifacts a ON a.id = (SELECT artifact_id FROM artifact_versions WHERE id = wd.definition_artifact_version_id)
     WHERE a.legacy_source_type = 'LegacyWorkflowDefinitionProject'
       AND wd.status = 'legacy_disabled'
       AND wd.activation_approval_request_id IS NOT NULL`,
  );
  checks.push({ name: 'every legacy_disabled bridged WorkflowDefinition has an exact definition ArtifactVersion link but no approval/activation snapshot', ok: legacyDefinitionSnapshotLeak === 0, detail: { count: legacyDefinitionSnapshotLeak } });

  const resumableRunLeak = await countSql(
    client,
    `SELECT count(*)::text AS count FROM workflow_runs WHERE legacy_source_type = 'Workflow' AND (status <> 'legacy_imported' OR run_approval_request_id IS NOT NULL OR activation_approval_request_id IS NOT NULL)`,
  );
  checks.push({ name: 'every bridged WorkflowRun stays legacy_imported with no run-gate/activation snapshot (never resumable)', ok: resumableRunLeak === 0, detail: { count: resumableRunLeak } });

  const crossScopeArtifacts = await countSql(
    client,
    `SELECT count(*)::text AS count
     FROM artifacts a
     JOIN companies c ON c.id = a.company_id
     JOIN projects p ON p.id = a.project_id
     WHERE a.legacy_source_type = ANY($1::text[]) AND (c.tenant_id <> a.tenant_id OR p.company_id <> a.company_id)`,
    LEGACY_ARTIFACT_SOURCE_TYPES,
  );
  checks.push({ name: 'zero cross-scope edges among bridged Artifacts (tenant/company/project mutually consistent)', ok: crossScopeArtifacts === 0, detail: { count: crossScopeArtifacts } });

  const quarantineConservation: Record<string, { source: number; bridged: number; quarantined: number; ok: boolean }> = {};
  const gdSource = await countSql(client, `SELECT count(*)::text AS count FROM generated_documents`);
  const gdBridged = await countSql(client, `SELECT count(*)::text AS count FROM artifacts WHERE legacy_source_type = 'GeneratedDocument'`);
  const gdQuarantined = await countSql(client, `SELECT count(*)::text AS count FROM scope_backfill_quarantine WHERE source_model = 'GeneratedDocument'`);
  quarantineConservation.GeneratedDocument = { source: gdSource, bridged: gdBridged, quarantined: gdQuarantined, ok: gdSource === gdBridged + gdQuarantined };

  const dvSource = await countSql(client, `SELECT count(*)::text AS count FROM document_versions`);
  const dvBridged = await countSql(client, `SELECT count(*)::text AS count FROM artifact_versions WHERE legacy_source_type = 'DocumentVersion'`);
  const dvQuarantined = await countSql(client, `SELECT count(*)::text AS count FROM scope_backfill_quarantine WHERE source_model = 'DocumentVersion'`);
  quarantineConservation.DocumentVersion = { source: dvSource, bridged: dvBridged, quarantined: dvQuarantined, ok: dvSource === dvBridged + dvQuarantined };

  const arSource = await countSql(client, `SELECT count(*)::text AS count FROM approval_requests`);
  const arQuarantined = await countSql(client, `SELECT count(*)::text AS count FROM scope_backfill_quarantine WHERE source_model = 'ApprovalRequest'`);
  quarantineConservation.ApprovalRequest = { source: arSource, bridged: 0, quarantined: arQuarantined, ok: arSource === arQuarantined };

  const wfSource = await countSql(client, `SELECT count(*)::text AS count FROM workflows`);
  const wfBridged = await countSql(client, `SELECT count(*)::text AS count FROM workflow_runs WHERE legacy_source_type = 'Workflow'`);
  const wfQuarantined = await countSql(client, `SELECT count(*)::text AS count FROM scope_backfill_quarantine WHERE source_model = 'Workflow'`);
  quarantineConservation.Workflow = { source: wfSource, bridged: wfBridged, quarantined: wfQuarantined, ok: wfSource === wfBridged + wfQuarantined };

  const wsSource = await countSql(client, `SELECT count(*)::text AS count FROM workflow_steps`);
  const wsQuarantined = await countSql(client, `SELECT count(*)::text AS count FROM scope_backfill_quarantine WHERE source_model = 'WorkflowStep'`);
  const wsBridgedViaEligibleParent = await countSql(
    client,
    `SELECT count(*)::text AS count FROM workflow_steps ws
     JOIN workflows w ON w.id = ws.workflow_id
     JOIN workflow_runs wr ON wr.legacy_source_type = 'Workflow' AND wr.legacy_source_id = w.id`,
  );
  quarantineConservation.WorkflowStep = { source: wsSource, bridged: wsBridgedViaEligibleParent, quarantined: wsQuarantined, ok: wsSource === wsBridgedViaEligibleParent + wsQuarantined };

  const conservationOk = Object.values(quarantineConservation).every((v) => v.ok);
  checks.push({ name: 'per-model source = bridged + quarantined conservation holds for all five source models', ok: conservationOk, detail: quarantineConservation });

  const doubleCountedRows = await countSql(
    client,
    `SELECT count(*)::text AS count FROM (
       SELECT q.source_model, q.source_id FROM scope_backfill_quarantine q WHERE q.source_model = ANY($1::text[])
       INTERSECT
       SELECT 'GeneratedDocument', a.legacy_source_id FROM artifacts a WHERE a.legacy_source_type = 'GeneratedDocument'
       UNION ALL
       SELECT q.source_model, q.source_id FROM scope_backfill_quarantine q WHERE q.source_model = ANY($1::text[])
       INTERSECT
       SELECT 'DocumentVersion', av.legacy_source_id FROM artifact_versions av WHERE av.legacy_source_type = 'DocumentVersion'
       UNION ALL
       SELECT q.source_model, q.source_id FROM scope_backfill_quarantine q WHERE q.source_model = ANY($1::text[])
       INTERSECT
       SELECT 'Workflow', wr.legacy_source_id FROM workflow_runs wr WHERE wr.legacy_source_type = 'Workflow'
     ) both_sides`,
    QUARANTINE_SOURCE_MODELS,
  );
  checks.push({ name: 'no source row is both bridged and quarantined', ok: doubleCountedRows === 0, detail: { count: doubleCountedRows } });

  const quarantineHashRows = await client.$queryRawUnsafe<{ id: string; source_row_json: unknown; source_row_hash: string }[]>(
    `SELECT id, source_row_json, source_row_hash FROM scope_backfill_quarantine WHERE source_model = ANY($1::text[])`,
    QUARANTINE_SOURCE_MODELS,
  );
  let quarantineHashMismatch = 0;
  for (const row of quarantineHashRows) {
    const rehash = await sqlJsonDigestHex(client, row.source_row_json);
    if (rehash !== row.source_row_hash) quarantineHashMismatch += 1;
  }
  checks.push({ name: 'every governance quarantine row self-hash round-trips (U011 PG-16/UTF8 function)', ok: quarantineHashMismatch === 0, detail: { checked: quarantineHashRows.length, mismatches: quarantineHashMismatch } });

  const columnPresence = {
    generatedDocuments: Object.keys(await fetchTableColumnTypes(client, 'generated_documents')),
    documentVersions: Object.keys(await fetchTableColumnTypes(client, 'document_versions')),
  };
  checks.push({
    name: 'baseline still has neither generated_documents.created_by_id nor document_versions.created_by_id (documents this run\'s zero-eligible-actor expectation)',
    ok: !columnPresence.generatedDocuments.includes('created_by_id') && !columnPresence.documentVersions.includes('created_by_id'),
    detail: columnPresence,
  });

  const ok = checks.every((c) => c.ok);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), ok, checks };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, result: 'REJECTED', message: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
