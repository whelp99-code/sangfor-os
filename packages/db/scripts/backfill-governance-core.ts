import { readFileSync } from 'node:fs';

import { prisma } from '../src/index';
import {
  GOVERNANCE_REASON_CODES,
  buildGenericRowEnvelope,
  buildGovernanceCandidateScopeJson,
  canonicalizeGovernanceContent,
  classifyApprovalRequest,
  classifyDocumentVersion,
  classifyDocumentVersionScope,
  classifyGeneratedDocument,
  classifyGeneratedDocumentScope,
  classifyWorkflowProjectGroup,
  computeGovernanceReviewDigest,
  computeManifestDigest,
  documentVersionContentPayload,
  fetchActiveUserCompanyRoleIds,
  fetchActorColumnFacts,
  fetchColumnPresent,
  fetchCommandRunActorContext,
  fetchGeneratedDocumentPrimaryScope,
  fetchGeneratedDocumentSecondaryLinks,
  fetchHasActiveProjectMember,
  fetchLosslessRow,
  fetchTableColumnTypes,
  fetchWorkflowProjectGroups,
  legacyArtifactId,
  legacyArtifactVersionId,
  legacyWorkflowDefinitionArtifactId,
  legacyWorkflowDefinitionId,
  legacyWorkflowDefinitionVersionId,
  legacyWorkflowRunId,
  resolveActorAssignment,
  sortStableIds,
  workflowDefinitionContentPayload,
  type ActorResolution,
  type DigestClient,
  type GovernanceManifestEntry,
  type GovernanceReasonCode,
  type SourceModel,
} from '../src/governance-bridge';
import { decideControlRowOutcome, deepJsonEqual, sqlJsonDigestHex } from '../src/scope-backfill';

const APPLY = process.env.APPLY === '1';
const GOVERNANCE_REVIEW_FILE = process.env.GOVERNANCE_REVIEW_FILE;

class GovernanceBackfillError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface GeneratedDocumentClassification {
  id: string;
  templateId: string;
  customerId: string | null;
  pocProjectId: string | null;
  opportunityId: string | null;
  engagementId: string | null;
  title: string;
  bodyMarkdown: string;
  createdAtIso: string;
  eligible: boolean;
  reasonCode: GovernanceReasonCode | null;
  resolvedTenantId: string | null;
  resolvedCompanyId: string | null;
  resolvedProjectId: string | null;
  actorAssignmentId: string | null;
  candidateScopeJson: ReturnType<typeof buildGovernanceCandidateScopeJson>;
}

interface DocumentVersionClassification {
  id: string;
  generatedDocumentId: string;
  version: number;
  bodyMarkdown: string;
  createdAtIso: string;
  eligible: boolean;
  reasonCode: GovernanceReasonCode | null;
  actorAssignmentId: string | null;
  candidateScopeJson: ReturnType<typeof buildGovernanceCandidateScopeJson>;
}

interface WorkflowGroupClassification {
  projectKey: string;
  isDangling: boolean;
  workflowIds: string[];
  commandRunIds: string[];
  eligible: boolean;
  reasonCode: GovernanceReasonCode | null;
  soleAssignmentId: string | null;
  tenantId: string | null;
  companyId: string | null;
  minCreatedAtIso: string | null;
  candidateScopeJson: ReturnType<typeof buildGovernanceCandidateScopeJson>;
}

interface ClassificationResult {
  generatedDocuments: GeneratedDocumentClassification[];
  documentVersions: DocumentVersionClassification[];
  approvalRequestIds: string[];
  workflowGroups: WorkflowGroupClassification[];
  workflowStepsByWorkflowId: Map<string, string[]>;
  manifest: GovernanceManifestEntry[];
  reviewDigest: string;
}

async function fetchProjectCompanyTenantChain(
  client: DigestClient,
  projectId: string,
): Promise<{ projectExists: boolean; companyId: string | null; companyExists: boolean; tenantId: string | null; tenantExists: boolean }> {
  const rows = await client.$queryRawUnsafe<{ project_exists: boolean; company_id: string | null; company_exists: boolean; tenant_id: string | null; tenant_exists: boolean }[]>(
    `SELECT
       (p.id IS NOT NULL) AS project_exists,
       p.company_id AS company_id,
       (c.id IS NOT NULL) AS company_exists,
       c.tenant_id AS tenant_id,
       (t.id IS NOT NULL) AS tenant_exists
     FROM (SELECT $1::text AS id) x
     LEFT JOIN projects p ON p.id = x.id
     LEFT JOIN companies c ON c.id = p.company_id
     LEFT JOIN tenants t ON t.id = c.tenant_id`,
    projectId,
  );
  const r = rows[0]!;
  return { projectExists: r.project_exists, companyId: r.company_id, companyExists: r.company_exists, tenantId: r.tenant_id, tenantExists: r.tenant_exists };
}

/** Runs the ENTIRE deterministic classification pass against whatever client is supplied (a plain
 * read-only pass for dry-run, or the apply transaction for the fresh re-classification apply
 * compares against its GOVERNANCE_REVIEW_FILE's attested digest). Pure decisions live in
 * governance-bridge.ts; this function is only the DB-fact orchestration around them. */
async function classifyAll(client: DigestClient): Promise<ClassificationResult> {
  const gdColumnPresent = await fetchColumnPresent(client, 'generated_documents', 'created_by_id');
  const dvColumnPresent = await fetchColumnPresent(client, 'document_versions', 'created_by_id');

  const gdRows = await client.$queryRawUnsafe<
    { id: string; template_id: string; customer_id: string | null; poc_project_id: string | null; opportunity_id: string | null; engagement_id: string | null; title: string; body_markdown: string; created_at: string }[]
  >(
    `SELECT id, template_id, customer_id, poc_project_id, opportunity_id, engagement_id, title, body_markdown,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM generated_documents ORDER BY id`,
  );

  const generatedDocuments: GeneratedDocumentClassification[] = [];
  for (const row of gdRows) {
    const primaryScope = await fetchGeneratedDocumentPrimaryScope(client, row.template_id);
    const secondaryLinks = await fetchGeneratedDocumentSecondaryLinks(client, {
      customerId: row.customer_id,
      pocProjectId: row.poc_project_id,
      opportunityId: row.opportunity_id,
      engagementId: row.engagement_id,
    });
    const scope = classifyGeneratedDocumentScope(primaryScope, secondaryLinks);
    const actorFacts = await fetchActorColumnFacts(client, {
      columnPresent: gdColumnPresent,
      rawUserId: null,
      companyId: scope.resolvedCompanyId,
      projectId: scope.resolvedProjectId,
      atIso: row.created_at,
    });
    const actor = resolveActorAssignment(actorFacts);
    const decision = classifyGeneratedDocument(scope, actor);
    const candidateScopeJson = buildGovernanceCandidateScopeJson({
      sourceModel: 'GeneratedDocument',
      sourceId: row.id,
      failures: decision.failures,
      candidateTenantIds: scope.resolvedTenantId ? [scope.resolvedTenantId] : [],
      candidateCompanyIds: scope.resolvedCompanyId ? [scope.resolvedCompanyId] : [],
      candidateProjectIds: scope.resolvedProjectId ? [scope.resolvedProjectId] : [],
      candidateArtifactIds: [],
      candidateArtifactVersionIds: [],
      candidateActorAssignmentIds: actor.candidateActorAssignmentIds,
      candidateOwnerAssignmentIds: actor.candidateActorAssignmentIds,
      sourceForeignKeys: scope.sourceForeignKeys,
      blockingSource: null,
    });
    generatedDocuments.push({
      id: row.id,
      templateId: row.template_id,
      customerId: row.customer_id,
      pocProjectId: row.poc_project_id,
      opportunityId: row.opportunity_id,
      engagementId: row.engagement_id,
      title: row.title,
      bodyMarkdown: row.body_markdown,
      createdAtIso: row.created_at,
      eligible: decision.eligible,
      reasonCode: decision.reasonCode,
      resolvedTenantId: scope.resolvedTenantId,
      resolvedCompanyId: scope.resolvedCompanyId,
      resolvedProjectId: scope.resolvedProjectId,
      actorAssignmentId: actor.assignmentId,
      candidateScopeJson,
    });
  }
  const gdById = new Map(generatedDocuments.map((d) => [d.id, d]));

  const dvRows = await client.$queryRawUnsafe<{ id: string; generated_document_id: string; version: number; body_markdown: string; created_at: string }[]>(
    `SELECT id, generated_document_id, version, body_markdown,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM document_versions ORDER BY id`,
  );
  const duplicateGroups = await client.$queryRawUnsafe<{ generated_document_id: string; version: number; cnt: number }[]>(
    `SELECT generated_document_id, version, count(*)::int AS cnt FROM document_versions GROUP BY 1, 2 HAVING count(*) > 1`,
  );
  const duplicateKeySet = new Set(duplicateGroups.map((d) => `${d.generated_document_id} ${d.version}`));

  const documentVersions: DocumentVersionClassification[] = [];
  for (const row of dvRows) {
    const parent = gdById.get(row.generated_document_id);
    const scope = classifyDocumentVersionScope(
      {
        generatedDocumentExists: parent !== undefined,
        parentEligible: parent?.eligible ?? false,
        parentReasonCode: parent?.reasonCode ?? null,
        siblingVersionCount: duplicateKeySet.has(`${row.generated_document_id} ${row.version}`) ? 2 : 1,
      },
      row.generated_document_id,
    );
    const actorFacts = await fetchActorColumnFacts(client, {
      columnPresent: dvColumnPresent,
      rawUserId: null,
      companyId: parent?.resolvedCompanyId ?? null,
      projectId: parent?.resolvedProjectId ?? null,
      atIso: row.created_at,
    });
    const actor = resolveActorAssignment(actorFacts);
    const content = canonicalizeGovernanceContent(documentVersionContentPayload(row.body_markdown));
    const decision = classifyDocumentVersion(scope, actor, content);
    const candidateScopeJson = buildGovernanceCandidateScopeJson({
      sourceModel: 'DocumentVersion',
      sourceId: row.id,
      failures: decision.failures,
      candidateTenantIds: [],
      candidateCompanyIds: [],
      candidateProjectIds: [],
      candidateArtifactIds: [],
      candidateArtifactVersionIds: [],
      candidateActorAssignmentIds: actor.candidateActorAssignmentIds,
      candidateOwnerAssignmentIds: [],
      sourceForeignKeys: [],
      blockingSource: scope.blockingSource,
    });
    documentVersions.push({
      id: row.id,
      generatedDocumentId: row.generated_document_id,
      version: row.version,
      bodyMarkdown: row.body_markdown,
      createdAtIso: row.created_at,
      eligible: decision.eligible,
      reasonCode: decision.reasonCode,
      actorAssignmentId: actor.assignmentId,
      candidateScopeJson,
    });
  }

  const approvalRequestIds = (await client.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM approval_requests ORDER BY id`)).map((r) => r.id);

  const groups = await fetchWorkflowProjectGroups(client);
  const workflowGroups: WorkflowGroupClassification[] = [];
  const workflowStepsByWorkflowId = new Map<string, string[]>();
  const allSteps = await client.$queryRawUnsafe<{ id: string; workflow_id: string }[]>(`SELECT id, workflow_id FROM workflow_steps ORDER BY id`);
  for (const step of allSteps) {
    const list = workflowStepsByWorkflowId.get(step.workflow_id) ?? [];
    list.push(step.id);
    workflowStepsByWorkflowId.set(step.workflow_id, list);
  }

  for (const [projectKey, members] of groups) {
    const isDangling = projectKey.startsWith('__dangling__:');
    let projectScopeComplete = true;
    let tenantId: string | null = null;
    let companyId: string | null = null;
    if (!isDangling) {
      const chain = await fetchProjectCompanyTenantChain(client, projectKey);
      projectScopeComplete = chain.projectExists && chain.companyId !== null && chain.companyExists && chain.tenantExists;
      tenantId = chain.tenantId;
      companyId = chain.companyId;
    }

    const memberFacts = [];
    const createdAts: string[] = [];
    for (const member of members) {
      const ctx = await fetchCommandRunActorContext(client, member.commandRunId);
      const scopeAgrees = !isDangling && ctx.commandRunExists && ctx.projectId === projectKey;
      let actor: ActorResolution;
      if (!ctx.commandRunExists || ctx.requestedById === null || ctx.companyId === null || ctx.projectId === null || ctx.createdAtIso === null) {
        actor = resolveActorAssignment({ columnPresent: true, rawUserId: null, matchingUserCompanyRoleIds: [], hasActiveProjectMember: false });
      } else {
        const facts = await fetchActorColumnFacts(client, { columnPresent: true, rawUserId: ctx.requestedById, companyId: ctx.companyId, projectId: ctx.projectId, atIso: ctx.createdAtIso });
        actor = resolveActorAssignment(facts);
      }
      if (ctx.createdAtIso) createdAts.push(ctx.createdAtIso);
      memberFacts.push({ workflowId: member.workflowId, commandRunId: member.commandRunId, commandRunExists: ctx.commandRunExists, scopeAgrees, actor });
    }

    const decision = classifyWorkflowProjectGroup(memberFacts, projectScopeComplete);
    const verifiedActorIds = sortStableIds(memberFacts.filter((m) => m.actor.eligible).map((m) => m.actor.assignmentId as string));
    const candidateScopeJson = buildGovernanceCandidateScopeJson({
      sourceModel: 'Workflow',
      sourceId: isDangling ? members[0]!.workflowId : projectKey,
      failures: decision.failures,
      candidateTenantIds: tenantId ? [tenantId] : [],
      candidateCompanyIds: companyId ? [companyId] : [],
      candidateProjectIds: isDangling ? [] : [projectKey],
      candidateArtifactIds: [],
      candidateArtifactVersionIds: [],
      candidateActorAssignmentIds: verifiedActorIds,
      candidateOwnerAssignmentIds: verifiedActorIds,
      sourceForeignKeys: [],
      blockingSource: null,
    });

    workflowGroups.push({
      projectKey,
      isDangling,
      workflowIds: decision.sortedWorkflowIds,
      commandRunIds: sortStableIds(members.map((m) => m.commandRunId)),
      eligible: decision.eligible,
      reasonCode: decision.reasonCode,
      soleAssignmentId: decision.soleAssignmentId,
      tenantId,
      companyId,
      minCreatedAtIso: createdAts.length > 0 ? createdAts.sort()[0]! : null,
      candidateScopeJson,
    });
  }

  const manifest: GovernanceManifestEntry[] = [];
  for (const d of generatedDocuments) manifest.push({ sourceModel: 'GeneratedDocument', sourceId: d.id, decision: d.eligible ? 'map' : 'quarantine', reasonCode: d.reasonCode });
  for (const v of documentVersions) manifest.push({ sourceModel: 'DocumentVersion', sourceId: v.id, decision: v.eligible ? 'map' : 'quarantine', reasonCode: v.reasonCode });
  for (const id of approvalRequestIds) manifest.push({ sourceModel: 'ApprovalRequest', sourceId: id, decision: 'quarantine', reasonCode: GOVERNANCE_REASON_CODES.MISSING_SOURCE });
  for (const g of workflowGroups) {
    for (const workflowId of g.workflowIds) {
      manifest.push({ sourceModel: 'Workflow', sourceId: workflowId, decision: g.eligible ? 'map' : 'quarantine', reasonCode: g.reasonCode });
      for (const stepId of workflowStepsByWorkflowId.get(workflowId) ?? []) {
        manifest.push({ sourceModel: 'WorkflowStep', sourceId: stepId, decision: g.eligible ? 'map' : 'quarantine', reasonCode: g.reasonCode });
      }
    }
  }

  return { generatedDocuments, documentVersions, approvalRequestIds, workflowGroups, workflowStepsByWorkflowId, manifest, reviewDigest: computeManifestDigest(manifest) };
}

async function runDryRun() {
  const result = await classifyAll(prisma as unknown as DigestClient);
  const report = {
    schemaVersion: 1,
    mode: 'dry_run',
    generatedAt: new Date().toISOString(),
    reviewDigest: result.reviewDigest,
    generatedDocuments: { count: result.generatedDocuments.length, mapped: result.generatedDocuments.filter((d) => d.eligible).length, quarantined: result.generatedDocuments.filter((d) => !d.eligible).length },
    documentVersions: { count: result.documentVersions.length, mapped: result.documentVersions.filter((d) => d.eligible).length, quarantined: result.documentVersions.filter((d) => !d.eligible).length },
    approvalRequests: { count: result.approvalRequestIds.length, quarantined: result.approvalRequestIds.length },
    workflowProjectGroups: result.workflowGroups.map((g) => ({ projectId: g.isDangling ? null : g.projectKey, workflowIds: g.workflowIds, eligible: g.eligible, reasonCode: g.reasonCode, soleAssignmentId: g.soleAssignmentId })),
    manifest: result.manifest,
    writes: 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

interface ReviewFile {
  schemaVersion: 1;
  reviewerKey: string;
  dryRunDigest: string;
  manifest: GovernanceManifestEntry[];
}

function loadReviewFile(path: string): ReviewFile {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ReviewFile>;
  if (parsed.schemaVersion !== 1) throw new GovernanceBackfillError('BAD_REVIEW_FILE', 'GOVERNANCE_REVIEW_FILE schemaVersion must be 1');
  if (!parsed.reviewerKey || parsed.reviewerKey.trim().length === 0) throw new GovernanceBackfillError('BAD_REVIEW_FILE', 'GOVERNANCE_REVIEW_FILE requires a non-empty reviewerKey');
  if (typeof parsed.dryRunDigest !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.dryRunDigest)) {
    throw new GovernanceBackfillError('BAD_REVIEW_FILE', 'GOVERNANCE_REVIEW_FILE requires a lowercase sha256 hex dryRunDigest');
  }
  if (!Array.isArray(parsed.manifest)) throw new GovernanceBackfillError('BAD_REVIEW_FILE', 'GOVERNANCE_REVIEW_FILE requires a manifest array captured at dry-run time');
  return parsed as ReviewFile;
}

async function upsertQuarantine(
  tx: DigestClient & { scopeBackfillQuarantine: any },
  sourceModel: SourceModel,
  sourceId: string,
  envelope: unknown,
  sourceRowHash: string,
  candidateScopeJson: ReturnType<typeof buildGovernanceCandidateScopeJson>,
  reasonCode: GovernanceReasonCode,
): Promise<'inserted' | 'identical_noop'> {
  const existing = await tx.scopeBackfillQuarantine.findUnique({ where: { sourceModel_sourceId: { sourceModel, sourceId } } });
  const outcome = decideControlRowOutcome(
    existing ? { sourceRowJson: existing.sourceRowJson, reasonCode: existing.reasonCode, candidateScopeJson: existing.candidateScopeJson } : null,
    { sourceRowJson: envelope, reasonCode, candidateScopeJson },
  );
  if (outcome === 'conflict') {
    throw new GovernanceBackfillError('QUARANTINE_ROW_CONFLICT', `existing ScopeBackfillQuarantine row for ${sourceModel}:${sourceId} does not match the freshly computed payload (tampered or pre-existing conflicting row)`);
  }
  if (outcome === 'insert') {
    await tx.scopeBackfillQuarantine.create({
      data: {
        sourceModel,
        sourceId,
        reasonCode,
        sourceRowJson: envelope as object,
        sourceRowHash,
        candidateScopeJson: candidateScopeJson as unknown as object,
        reviewDigest: computeGovernanceReviewDigest(candidateScopeJson),
      },
    });
    return 'inserted';
  }
  return 'identical_noop';
}

/** Postgres JSONB does not preserve object-key insertion order (unlike the `json` type) — a
 * jsonb column round-tripped through a read carries Postgres's own internal key order, which can
 * differ from the order the JS side originally serialized, so a plain `JSON.stringify` equality
 * check is unsound here. `deepJsonEqual` (reused verbatim from scope-backfill.ts) compares by
 * value, independent of key order. */
function fieldsMatch(existing: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.keys(expected).every((k) => {
    const e = existing[k];
    const x = expected[k];
    if (e instanceof Date && typeof x === 'string') return e.toISOString() === x || e.getTime() === Date.parse(x);
    if (typeof e === 'object' && e !== null && typeof x === 'object' && x !== null) return deepJsonEqual(e, x);
    return e === x;
  });
}

async function runApply() {
  if (!GOVERNANCE_REVIEW_FILE) throw new GovernanceBackfillError('MISSING_REVIEW_FILE', 'APPLY=1 requires GOVERNANCE_REVIEW_FILE');
  const reviewFile = loadReviewFile(GOVERNANCE_REVIEW_FILE);
  const selfDigest = computeManifestDigest(reviewFile.manifest);
  if (selfDigest !== reviewFile.dryRunDigest) {
    throw new GovernanceBackfillError('TAMPERED_REVIEW_FILE', `GOVERNANCE_REVIEW_FILE manifest digest (${selfDigest}) does not equal its own attested dryRunDigest (${reviewFile.dryRunDigest})`);
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const client = tx as unknown as DigestClient;
      const fresh = await classifyAll(client);
      if (fresh.reviewDigest !== reviewFile.dryRunDigest) {
        throw new GovernanceBackfillError(
          'STALE_MANIFEST',
          `live re-classification digest (${fresh.reviewDigest}) no longer matches the reviewed dryRunDigest (${reviewFile.dryRunDigest}) — a source changed since dry-run`,
        );
      }

      const qtx = tx as unknown as DigestClient & { scopeBackfillQuarantine: any; artifact: any; artifactVersion: any; workflowDefinition: any; workflowRun: any };
      const outcomes = { generatedDocuments: { mapped: 0, quarantined: 0, alreadyPresent: 0 }, documentVersions: { mapped: 0, quarantined: 0, alreadyPresent: 0 }, approvalRequests: { quarantined: 0 }, workflowGroups: { mapped: 0, quarantined: 0, alreadyPresent: 0 } };

      for (const doc of fresh.generatedDocuments) {
        const locked = await fetchLosslessRow(client, 'generated_documents', 'id', doc.id, true);
        if (!locked) continue;
        const envelope = buildGenericRowEnvelope('GeneratedDocument', locked.columnTypes, locked.values);
        const sourceRowHash = await sqlJsonDigestHex(client, envelope);

        if (!doc.eligible) {
          const outcome = await upsertQuarantine(qtx, 'GeneratedDocument', doc.id, envelope, sourceRowHash, doc.candidateScopeJson, doc.reasonCode as GovernanceReasonCode);
          if (outcome === 'inserted') outcomes.generatedDocuments.quarantined += 1;
          continue;
        }

        const artifactId = legacyArtifactId(doc.id);
        const expected = {
          tenantId: doc.resolvedTenantId as string,
          companyId: doc.resolvedCompanyId as string,
          projectId: doc.resolvedProjectId as string,
          artifactType: 'legacy_document',
          classification: 'restricted',
          origin: 'legacy_import',
          title: doc.title,
          createdByAssignmentId: doc.actorAssignmentId as string,
          ownerAssignmentId: doc.actorAssignmentId as string,
          legacySourceType: 'GeneratedDocument',
          legacySourceId: doc.id,
          currentVersionId: null,
          currentRevision: 0,
        };
        const existing = await qtx.artifact.findUnique({ where: { id: artifactId } });
        if (!existing) {
          await qtx.artifact.create({ data: { id: artifactId, ...expected, ownershipRevision: 0, createdAt: new Date(doc.createdAtIso), updatedAt: new Date(doc.createdAtIso) } });
          outcomes.generatedDocuments.mapped += 1;
        } else if (fieldsMatch(existing, expected)) {
          outcomes.generatedDocuments.alreadyPresent += 1;
        } else {
          throw new GovernanceBackfillError('ARTIFACT_CONFLICT', `existing Artifact ${artifactId} does not byte-match the expected legacy GeneratedDocument bridge fields`);
        }
      }

      for (const ver of fresh.documentVersions) {
        const locked = await fetchLosslessRow(client, 'document_versions', 'id', ver.id, true);
        if (!locked) continue;
        const envelope = buildGenericRowEnvelope('DocumentVersion', locked.columnTypes, locked.values);
        const sourceRowHash = await sqlJsonDigestHex(client, envelope);

        if (!ver.eligible) {
          const outcome = await upsertQuarantine(qtx, 'DocumentVersion', ver.id, envelope, sourceRowHash, ver.candidateScopeJson, ver.reasonCode as GovernanceReasonCode);
          if (outcome === 'inserted') outcomes.documentVersions.quarantined += 1;
          continue;
        }

        const content = canonicalizeGovernanceContent(documentVersionContentPayload(ver.bodyMarkdown));
        if (!content.ok) throw new GovernanceBackfillError('UNEXPECTED_NON_CANONICAL_CONTENT', `document version ${ver.id} was classified eligible but failed canonicalization`);
        const artifactVersionId = legacyArtifactVersionId(ver.id);
        const parentArtifactId = legacyArtifactId(ver.generatedDocumentId);
        const expected = {
          artifactId: parentArtifactId,
          version: ver.version,
          contentHashVersion: content.contentHashVersion,
          canonicalContentEnvelope: content.canonicalContentEnvelope,
          contentHash: content.contentHash,
          contentJson: content.contentJson,
          status: 'legacy_unreviewed',
          createdByAssignmentId: ver.actorAssignmentId as string,
          legacySourceType: 'DocumentVersion',
          legacySourceId: ver.id,
        };
        const existing = await qtx.artifactVersion.findUnique({ where: { id: artifactVersionId } });
        if (!existing) {
          await qtx.artifactVersion.create({ data: { id: artifactVersionId, ...expected, createdAt: new Date(ver.createdAtIso) } });
          outcomes.documentVersions.mapped += 1;
        } else if (fieldsMatch(existing, expected)) {
          outcomes.documentVersions.alreadyPresent += 1;
        } else {
          throw new GovernanceBackfillError('ARTIFACT_VERSION_CONFLICT', `existing ArtifactVersion ${artifactVersionId} does not byte-match the expected legacy DocumentVersion bridge fields`);
        }
      }

      for (const id of fresh.approvalRequestIds) {
        const locked = await fetchLosslessRow(client, 'approval_requests', 'id', id, true);
        if (!locked) continue;
        const envelope = buildGenericRowEnvelope('ApprovalRequest', locked.columnTypes, locked.values);
        const sourceRowHash = await sqlJsonDigestHex(client, envelope);
        const decision = classifyApprovalRequest();
        const candidateScopeJson = buildGovernanceCandidateScopeJson({
          sourceModel: 'ApprovalRequest',
          sourceId: id,
          failures: decision.failures,
          candidateTenantIds: [],
          candidateCompanyIds: [],
          candidateProjectIds: [],
          candidateArtifactIds: [],
          candidateArtifactVersionIds: [],
          candidateActorAssignmentIds: [],
          candidateOwnerAssignmentIds: [],
          sourceForeignKeys: [],
          blockingSource: null,
        });
        const outcome = await upsertQuarantine(qtx, 'ApprovalRequest', id, envelope, sourceRowHash, candidateScopeJson, decision.reasonCode);
        if (outcome === 'inserted') outcomes.approvalRequests.quarantined += 1;
      }

      for (const group of fresh.workflowGroups) {
        const stepIds = group.workflowIds.flatMap((wfId) => fresh.workflowStepsByWorkflowId.get(wfId) ?? []);

        if (!group.eligible) {
          for (const workflowId of group.workflowIds) {
            const lockedWf = await fetchLosslessRow(client, 'workflows', 'id', workflowId, true);
            if (lockedWf) {
              const envelope = buildGenericRowEnvelope('Workflow', lockedWf.columnTypes, lockedWf.values);
              const hash = await sqlJsonDigestHex(client, envelope);
              const outcome = await upsertQuarantine(qtx, 'Workflow', workflowId, envelope, hash, group.candidateScopeJson, group.reasonCode as GovernanceReasonCode);
              if (outcome === 'inserted') outcomes.workflowGroups.quarantined += 1;
            }
          }
          for (const stepId of stepIds) {
            const lockedStep = await fetchLosslessRow(client, 'workflow_steps', 'id', stepId, true);
            if (lockedStep) {
              const envelope = buildGenericRowEnvelope('WorkflowStep', lockedStep.columnTypes, lockedStep.values);
              const hash = await sqlJsonDigestHex(client, envelope);
              await upsertQuarantine(qtx, 'WorkflowStep', stepId, envelope, hash, group.candidateScopeJson, group.reasonCode as GovernanceReasonCode);
            }
          }
          continue;
        }

        const A = group.soleAssignmentId as string;
        const P = group.projectKey;
        const minCreatedAt = new Date(group.minCreatedAtIso as string);
        const content = canonicalizeGovernanceContent(workflowDefinitionContentPayload(P));
        if (!content.ok) throw new GovernanceBackfillError('UNEXPECTED_NON_CANONICAL_CONTENT', `workflow-definition content for project ${P} failed canonicalization`);

        const artifactId = legacyWorkflowDefinitionArtifactId(P);
        const artifactExpected = {
          tenantId: group.tenantId as string,
          companyId: group.companyId as string,
          projectId: P,
          artifactType: 'workflow-definition',
          classification: 'restricted',
          origin: 'legacy_import',
          title: `Legacy command-simulation workflow definition (project ${P})`,
          createdByAssignmentId: A,
          ownerAssignmentId: A,
          legacySourceType: 'LegacyWorkflowDefinitionProject',
          legacySourceId: P,
          currentVersionId: null,
          currentRevision: 0,
        };
        const existingArtifact = await qtx.artifact.findUnique({ where: { id: artifactId } });
        const groupWasNew = !existingArtifact;
        if (!existingArtifact) {
          await qtx.artifact.create({ data: { id: artifactId, ...artifactExpected, ownershipRevision: 0, createdAt: minCreatedAt, updatedAt: minCreatedAt } });
        } else if (!fieldsMatch(existingArtifact, artifactExpected)) {
          throw new GovernanceBackfillError('ARTIFACT_CONFLICT', `existing Artifact ${artifactId} does not byte-match the expected legacy workflow-definition bridge fields`);
        }

        const artifactVersionId = legacyWorkflowDefinitionVersionId(P);
        const versionExpected = {
          artifactId,
          version: 1,
          contentHashVersion: content.contentHashVersion,
          canonicalContentEnvelope: content.canonicalContentEnvelope,
          contentHash: content.contentHash,
          contentJson: content.contentJson,
          status: 'legacy_unreviewed',
          createdByAssignmentId: A,
          legacySourceType: 'LegacyWorkflowDefinitionProjectVersion',
          legacySourceId: `${P}:1`,
        };
        const existingVersion = await qtx.artifactVersion.findUnique({ where: { id: artifactVersionId } });
        if (!existingVersion) {
          await qtx.artifactVersion.create({ data: { id: artifactVersionId, ...versionExpected, createdAt: minCreatedAt } });
        } else if (!fieldsMatch(existingVersion, versionExpected)) {
          throw new GovernanceBackfillError('ARTIFACT_VERSION_CONFLICT', `existing ArtifactVersion ${artifactVersionId} does not byte-match the expected legacy workflow-definition-version bridge fields`);
        }

        const definitionId = legacyWorkflowDefinitionId(P);
        const definitionExpected = {
          tenantId: group.tenantId as string,
          companyId: group.companyId as string,
          projectId: P,
          workflowKey: 'legacy-command-simulation',
          name: 'Legacy Command Simulation',
          version: 1,
          revision: 0,
          status: 'legacy_disabled',
          definitionArtifactVersionId: artifactVersionId,
          definitionHashVersion: content.contentHashVersion,
          definitionHash: content.contentHash,
          definitionJson: content.contentJson,
          createdByAssignmentId: A,
        };
        const existingDefinition = await qtx.workflowDefinition.findUnique({ where: { id: definitionId } });
        if (!existingDefinition) {
          await qtx.workflowDefinition.create({ data: { id: definitionId, ...definitionExpected, createdAt: minCreatedAt, updatedAt: minCreatedAt } });
        } else if (!fieldsMatch(existingDefinition, definitionExpected)) {
          throw new GovernanceBackfillError('WORKFLOW_DEFINITION_CONFLICT', `existing WorkflowDefinition ${definitionId} does not byte-match the expected legacy provenance`);
        }

        for (const workflowId of group.workflowIds) {
          const wfRow = await client.$queryRawUnsafe<{ created_at: string }[]>(
            `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at FROM workflows WHERE id = $1`,
            workflowId,
          );
          const runCreatedAt = wfRow[0]?.created_at ? new Date(wfRow[0].created_at) : minCreatedAt;
          const runId = legacyWorkflowRunId(workflowId);
          const runExpected = {
            tenantId: group.tenantId as string,
            companyId: group.companyId as string,
            projectId: P,
            workflowDefinitionId: definitionId,
            definitionVersion: 1,
            definitionArtifactVersionId: artifactVersionId,
            definitionArtifactHashVersion: content.contentHashVersion,
            definitionArtifactHash: content.contentHash,
            requestedByAssignmentId: A,
            requestedSessionId: `legacy-import-session:${workflowId}`,
            idempotencyKey: `legacy-import:${workflowId}`,
            status: 'legacy_imported',
            legacySourceType: 'Workflow',
            legacySourceId: workflowId,
          };
          const existingRun = await qtx.workflowRun.findUnique({ where: { id: runId } });
          if (!existingRun) {
            await qtx.workflowRun.create({ data: { id: runId, ...runExpected, revision: 0, createdAt: runCreatedAt, updatedAt: runCreatedAt } });
          } else if (!fieldsMatch(existingRun, runExpected)) {
            throw new GovernanceBackfillError('WORKFLOW_RUN_CONFLICT', `existing WorkflowRun ${runId} does not byte-match the expected legacy provenance`);
          }
        }
        if (groupWasNew) outcomes.workflowGroups.mapped += 1;
        else outcomes.workflowGroups.alreadyPresent += 1;
      }

      return outcomes;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  const report = { schemaVersion: 1, mode: 'apply', result: 'PASS', generatedAt: new Date().toISOString(), reviewDigest: reviewFile.dryRunDigest, ...result };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new GovernanceBackfillError('MISSING_DATABASE_URL', 'DATABASE_URL is required');
  if (APPLY) {
    await runApply();
  } else {
    await runDryRun();
  }
}

main()
  .catch((error) => {
    const code = error instanceof GovernanceBackfillError ? error.code : 'UNEXPECTED';
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, result: 'REJECTED', code, message: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
