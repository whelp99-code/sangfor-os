import { readFileSync } from 'node:fs';

import { prisma } from '../src/index';
import {
  CONTROL_ROW_KEY,
  REASON_CODES,
  assertLoopbackDatabaseUrl,
  buildProjectCandidateScopeJson,
  buildProjectResolutionJson,
  buildProjectRowEnvelope,
  buildReviewedApplyControlResolutionJson,
  buildReviewedApplyControlSourceRowJson,
  buildRoleChangeCandidateScopeJson,
  buildRoleChangeRequestRowEnvelope,
  classifyProjectCompanyScope,
  classifyRoleChangeCompanyScope,
  computeManifestDigest,
  decideControlRowOutcome,
  decideProjectApplyOutcome,
  deepJsonEqual,
  fetchProjectColumnTypes,
  fetchProjectLiveRow,
  fetchProjectScopeFacts,
  fetchRoleChangeRequestColumnTypes,
  fetchRoleChangeRequestLiveRow,
  fetchRoleChangeScopeFacts,
  sqlJsonDigestHex,
  validateManifestEntryDecision,
  verifyRoleChangeRequestRowEnvelopeRoundTrip,
  type DigestClient,
  type ProjectManifestEntry,
  type ProjectManifestFacts,
  type ReviewFile,
  type ScopeBackfillConservation,
  type ScopeBackfillCounts,
} from '../src/scope-backfill';

const APPLY = process.env.APPLY === '1';
const SCOPE_REVIEW_FILE = process.env.SCOPE_REVIEW_FILE;
const CONTROL_ID = 'scope-backfill-control-reviewed-apply';

class ScopeBackfillError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function buildProjectManifest(client: DigestClient): Promise<{ entries: ProjectManifestEntry[]; reviewDigest: string }> {
  const columnTypes = await fetchProjectColumnTypes(client);
  const nullProjects = await client.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM projects WHERE company_id IS NULL ORDER BY id`,
  );

  const entries: ProjectManifestEntry[] = [];
  for (const { id } of nullProjects) {
    const live = await fetchProjectLiveRow(client, id);
    if (!live) continue;
    const envelope = buildProjectRowEnvelope(columnTypes, live as unknown as Record<string, string | null>);
    const sourceRowHash = await sqlJsonDigestHex(client, envelope);
    const { facts, tuples } = await fetchProjectScopeFacts(client, id);
    const decision = classifyProjectCompanyScope(facts);
    const sourceFacts = { schemaVersion: 1, sourceModel: 'Project', sourceId: id, tuples };
    const sourceFactsDigest = await sqlJsonDigestHex(client, sourceFacts);
    entries.push({
      sourceModel: 'Project',
      sourceId: id,
      sourceRowHash,
      sourceFactsDigest,
      classification: decision.classification,
      candidateCompanyIds: decision.candidateCompanyIds,
      decision: null,
      selectedCompanyId: null,
      reviewerKey: null,
      rationale: null,
    });
  }

  const reviewDigest = await computeManifestDigest(client, entries as ProjectManifestFacts[]);
  return { entries, reviewDigest };
}

interface RoleChangeSummary {
  counts: { resolved: number; ambiguous: number; unmatched: number };
  ids: { resolved: string[]; ambiguous: string[]; unmatched: string[] };
}

async function summarizeRoleChangeRequests(client: DigestClient): Promise<RoleChangeSummary> {
  const rows = await client.$queryRawUnsafe<{ id: string; user_id: string; requested_by: string }[]>(
    `SELECT id, user_id, requested_by FROM role_change_requests WHERE company_id IS NULL ORDER BY id`,
  );
  const counts = { resolved: 0, ambiguous: 0, unmatched: 0 };
  const ids: RoleChangeSummary['ids'] = { resolved: [], ambiguous: [], unmatched: [] };
  for (const row of rows) {
    const facts = await fetchRoleChangeScopeFacts(client, row);
    const decision = classifyRoleChangeCompanyScope(facts);
    counts[decision.classification] += 1;
    ids[decision.classification].push(row.id);
  }
  return { counts, ids };
}

async function runDryRun() {
  const { entries, reviewDigest } = await buildProjectManifest(prisma);
  const roleChangeRequests = await summarizeRoleChangeRequests(prisma);
  const report = {
    schemaVersion: 1,
    mode: 'dry_run',
    generatedAt: new Date().toISOString(),
    reviewDigest,
    projects: { entries, count: entries.length },
    roleChangeRequests,
    writes: 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function loadReviewFile(path: string): ReviewFile {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ReviewFile> & { dryRunDigest?: string };
  if (parsed.schemaVersion !== 1) throw new ScopeBackfillError('BAD_REVIEW_FILE', 'SCOPE_REVIEW_FILE schemaVersion must be 1');
  if (!parsed.reviewerKey || parsed.reviewerKey.trim().length === 0) {
    throw new ScopeBackfillError('BAD_REVIEW_FILE', 'SCOPE_REVIEW_FILE requires a non-empty top-level reviewerKey');
  }
  if (!Array.isArray(parsed.entries)) throw new ScopeBackfillError('BAD_REVIEW_FILE', 'SCOPE_REVIEW_FILE requires an entries array');
  if (!Array.isArray(parsed.roleChangeRequestIds)) {
    throw new ScopeBackfillError('BAD_REVIEW_FILE', 'SCOPE_REVIEW_FILE requires a roleChangeRequestIds array captured at dry-run time');
  }
  if (typeof parsed.dryRunDigest !== 'string' || parsed.dryRunDigest.length === 0) {
    throw new ScopeBackfillError('BAD_REVIEW_FILE', 'SCOPE_REVIEW_FILE requires a dryRunDigest attesting the dry-run facts it reviewed');
  }
  return parsed as ReviewFile & { dryRunDigest: string };
}

interface ProjectOutcomeRecord {
  sourceId: string;
  outcome: string;
  companyId: string | null;
}

interface RoleChangeOutcomeRecord {
  sourceId: string;
  outcome: 'resolved' | 'extracted' | 'already_resolved' | 'already_extracted';
  companyId?: string;
  sourceRowHash?: string;
}

async function runApply() {
  if (!SCOPE_REVIEW_FILE) {
    throw new ScopeBackfillError('MISSING_REVIEW_FILE', 'APPLY=1 requires SCOPE_REVIEW_FILE');
  }
  const reviewFile = loadReviewFile(SCOPE_REVIEW_FILE) as ReviewFile & { dryRunDigest: string };

  for (const entry of reviewFile.entries) {
    const validation = validateManifestEntryDecision(entry);
    if (!validation.ok) {
      throw new ScopeBackfillError('UNREVIEWED_OR_INVALID_DECISION', `entry ${entry.sourceId}: ${validation.reason}`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const selfDigest = await computeManifestDigest(tx as unknown as DigestClient, reviewFile.entries as ProjectManifestFacts[]);
    if (selfDigest !== reviewFile.dryRunDigest) {
      throw new ScopeBackfillError(
        'STALE_MANIFEST',
        `SCOPE_REVIEW_FILE canonical JSON SHA-256 (${selfDigest}) does not equal its embedded dryRunDigest (${reviewFile.dryRunDigest})`,
      );
    }

    const client = tx as unknown as DigestClient;
    const projectOutcomes: ProjectOutcomeRecord[] = [];
    let projectAssigned = 0;
    let projectAlreadyConsistent = 0;
    let projectConflicts = 0;
    let projectQuarantinedThisRun = 0;

    for (const entry of reviewFile.entries) {
      const live = await fetchProjectLiveRow(client, entry.sourceId);
      if (!live) {
        projectOutcomes.push({ sourceId: entry.sourceId, outcome: 'missing', companyId: null });
        continue;
      }
      // A previously-assigned entry's live row-hash necessarily differs from its pre-assignment
      // dry-run snapshot (company_id is now set), so the drift check below — which is only valid
      // against a row still in its ORIGINAL null-scope state — must never run for a row that is
      // already exactly at its reviewed target: that is the expected post-apply state, not drift.
      if (entry.decision === 'assign' && live.company_id === entry.selectedCompanyId) {
        projectAlreadyConsistent += 1;
        projectOutcomes.push({ sourceId: entry.sourceId, outcome: 'already_consistent', companyId: live.company_id });
        continue;
      }

      const columnTypes = await fetchProjectColumnTypes(client);
      const envelope = buildProjectRowEnvelope(columnTypes, live as unknown as Record<string, string | null>);
      const liveSourceRowHash = await sqlJsonDigestHex(client, envelope);
      const { tuples } = await fetchProjectScopeFacts(client, entry.sourceId);
      const sourceFacts = { schemaVersion: 1, sourceModel: 'Project', sourceId: entry.sourceId, tuples };
      const liveSourceFactsDigest = await sqlJsonDigestHex(client, sourceFacts);

      const drifted = liveSourceRowHash !== entry.sourceRowHash || liveSourceFactsDigest !== entry.sourceFactsDigest;
      if (drifted) {
        projectConflicts += 1;
        projectOutcomes.push({ sourceId: entry.sourceId, outcome: 'stale_manifest', companyId: live.company_id });
        continue;
      }

      if (entry.decision === 'quarantine') {
        const reasonCode =
          entry.classification === 'ambiguous' ? REASON_CODES.PROJECT_AMBIGUOUS : REASON_CODES.PROJECT_UNMATCHED;
        const candidateScopeJson = buildProjectCandidateScopeJson({
          decision: { classification: entry.classification as 'ambiguous' | 'unmatched', candidateCompanyIds: entry.candidateCompanyIds },
          sourceFacts,
        });
        const existingQuarantine = await tx.scopeBackfillQuarantine.findUnique({
          where: { sourceModel_sourceId: { sourceModel: 'Project', sourceId: entry.sourceId } },
        });
        const alreadyIdentical =
          existingQuarantine !== null &&
          existingQuarantine.reasonCode === reasonCode &&
          existingQuarantine.sourceRowHash === liveSourceRowHash &&
          deepJsonEqual(existingQuarantine.candidateScopeJson, candidateScopeJson);
        if (!alreadyIdentical) {
          await tx.scopeBackfillQuarantine.upsert({
            where: { sourceModel_sourceId: { sourceModel: 'Project', sourceId: entry.sourceId } },
            update: {
              reasonCode,
              sourceRowJson: envelope as object,
              sourceRowHash: liveSourceRowHash,
              candidateScopeJson: candidateScopeJson as object,
              lastSeenAt: new Date(),
            },
            create: {
              sourceModel: 'Project',
              sourceId: entry.sourceId,
              reasonCode,
              sourceRowJson: envelope as object,
              sourceRowHash: liveSourceRowHash,
              candidateScopeJson: candidateScopeJson as object,
            },
          });
          projectQuarantinedThisRun += 1;
        }
        projectOutcomes.push({ sourceId: entry.sourceId, outcome: alreadyIdentical ? 'already_quarantined' : 'quarantined', companyId: null });
        continue;
      }

      if (entry.decision !== 'assign') {
        throw new ScopeBackfillError('BAD_REVIEW_FILE', `entry ${entry.sourceId}: unknown decision ${String(entry.decision)}`);
      }
      const selectedCompanyId = entry.selectedCompanyId as string;
      const outcome = decideProjectApplyOutcome({
        currentCompanyId: live.company_id,
        reviewedCompanyId: selectedCompanyId,
        liveSourceRowHash,
        reviewedSourceRowHash: entry.sourceRowHash,
        liveSourceFactsDigest,
        reviewedSourceFactsDigest: entry.sourceFactsDigest,
      });

      if (outcome === 'assigned') {
        const company = await tx.company.findUnique({ where: { id: selectedCompanyId }, select: { id: true, tenantId: true } });
        if (!company) throw new ScopeBackfillError('BAD_REVIEW_FILE', `selectedCompanyId ${selectedCompanyId} does not exist`);
        const updated = await client.$executeRawUnsafe(
          `UPDATE projects SET company_id = $1 WHERE id = $2 AND company_id IS NULL`,
          selectedCompanyId,
          entry.sourceId,
        );
        if (updated !== 1) throw new ScopeBackfillError('CAS_FAILED', `Project ${entry.sourceId} CAS update affected ${updated} rows`);
        const resolutionJson = buildProjectResolutionJson({
          companyId: selectedCompanyId,
          tenantId: company.tenantId,
          reviewDigest: selfDigest,
          sourceFactsDigest: entry.sourceFactsDigest,
        });
        const existingQuarantine = await tx.scopeBackfillQuarantine.findUnique({
          where: { sourceModel_sourceId: { sourceModel: 'Project', sourceId: entry.sourceId } },
        });
        if (existingQuarantine) {
          await tx.scopeBackfillQuarantine.update({
            where: { id: existingQuarantine.id },
            data: { resolvedAt: new Date(), resolvedBy: reviewFile.reviewerKey, resolutionJson: resolutionJson as object, lastSeenAt: new Date() },
          });
        }
        projectAssigned += 1;
        projectOutcomes.push({ sourceId: entry.sourceId, outcome: 'assigned', companyId: selectedCompanyId });
      } else if (outcome === 'already_consistent') {
        projectAlreadyConsistent += 1;
        projectOutcomes.push({ sourceId: entry.sourceId, outcome: 'already_consistent', companyId: live.company_id });
      } else {
        projectConflicts += 1;
        projectOutcomes.push({ sourceId: entry.sourceId, outcome, companyId: live.company_id });
      }
    }

    // A fixed id set captured at dry-run time, NOT a live re-query: RoleChangeRequest resolution
    // is fully automatic, but `WHERE company_id IS NULL` would silently shrink on a rerun as
    // rows resolve/extract, making the control row's counts non-reproducible.
    const rcrIds = [...reviewFile.roleChangeRequestIds].sort();
    const roleChangeOutcomes: RoleChangeOutcomeRecord[] = [];
    let rcrResolvedThisRun = 0;
    let rcrExtractedThisRun = 0;
    const columnTypes = await fetchRoleChangeRequestColumnTypes(client);

    for (const id of rcrIds) {
      const live = await fetchRoleChangeRequestLiveRow(client, id);
      if (!live) {
        const existing = await tx.scopeBackfillQuarantine.findUnique({
          where: { sourceModel_sourceId: { sourceModel: 'RoleChangeRequest', sourceId: id } },
        });
        if (!existing) throw new ScopeBackfillError('MISSING_EXTRACTION_RECORD', `RoleChangeRequest ${id} has no live row and no quarantine record`);
        roleChangeOutcomes.push({ sourceId: id, outcome: 'already_extracted' });
        continue;
      }
      if (live.company_id !== null) {
        roleChangeOutcomes.push({ sourceId: id, outcome: 'already_resolved', companyId: live.company_id });
        continue;
      }

      const facts = await fetchRoleChangeScopeFacts(client, live);
      const decision = classifyRoleChangeCompanyScope(facts);

      if (decision.classification === 'resolved') {
        const companyId = decision.candidateCompanyIds[0] as string;
        const updated = await client.$executeRawUnsafe(
          `UPDATE role_change_requests SET company_id = $1 WHERE id = $2 AND company_id IS NULL`,
          companyId,
          id,
        );
        if (updated !== 1) throw new ScopeBackfillError('CAS_FAILED', `RoleChangeRequest ${id} CAS update affected ${updated} rows`);
        rcrResolvedThisRun += 1;
        roleChangeOutcomes.push({ sourceId: id, outcome: 'resolved', companyId });
        continue;
      }

      const envelope = buildRoleChangeRequestRowEnvelope(columnTypes, live as unknown as Record<string, string | null>);
      const sourceRowHash = await sqlJsonDigestHex(client, envelope);
      const roundTrip = verifyRoleChangeRequestRowEnvelopeRoundTrip(envelope, live as unknown as Record<string, string | null>);
      if (!roundTrip.ok) {
        throw new ScopeBackfillError('NON_ROUND_TRIPPABLE', `RoleChangeRequest ${id} snapshot failed round-trip on columns: ${roundTrip.mismatches.join(', ')}`);
      }
      const candidateScopeJson = buildRoleChangeCandidateScopeJson({
        decision,
        targetUserId: live.user_id,
        targetCompanyIds: facts.targetCompanyIds,
        requesterCompanyIds: facts.requesterCompanyIds,
        sourceFacts: { schemaVersion: 1, sourceModel: 'RoleChangeRequest', sourceId: id },
      });

      await tx.scopeBackfillQuarantine.upsert({
        where: { sourceModel_sourceId: { sourceModel: 'RoleChangeRequest', sourceId: id } },
        update: {
          reasonCode: decision.reasonCode as string,
          sourceRowJson: envelope as object,
          sourceRowHash,
          candidateScopeJson: candidateScopeJson as object,
          lastSeenAt: new Date(),
        },
        create: {
          sourceModel: 'RoleChangeRequest',
          sourceId: id,
          reasonCode: decision.reasonCode as string,
          sourceRowJson: envelope as object,
          sourceRowHash,
          candidateScopeJson: candidateScopeJson as object,
        },
      });

      const verifyRows = await client.$queryRawUnsafe<{ source_row_hash: string }[]>(
        `SELECT source_row_hash FROM scope_backfill_quarantine WHERE source_model = $1 AND source_id = $2`,
        'RoleChangeRequest',
        id,
      );
      if (verifyRows[0]?.source_row_hash !== sourceRowHash) {
        throw new ScopeBackfillError('HASH_VERIFY_FAILED', `RoleChangeRequest ${id} quarantine hash did not verify after insert`);
      }

      const deleted = await client.$executeRawUnsafe(`DELETE FROM role_change_requests WHERE id = $1`, id);
      if (deleted !== 1) throw new ScopeBackfillError('EXTRACTION_FAILED', `RoleChangeRequest ${id} extraction delete affected ${deleted} rows`);

      rcrExtractedThisRun += 1;
      roleChangeOutcomes.push({ sourceId: id, outcome: 'extracted', sourceRowHash });
    }

    // Stable, cumulative counts derived from the FIXED id sets (manifest entries + rcrIds), not
    // from this invocation's own outcome tallies — so a rerun that changes nothing produces the
    // exact same counts (and therefore the exact same control-row bytes) as the run before it.
    const rcrLiveAfterRows = await client.$queryRawUnsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM role_change_requests WHERE id = ANY($1::text[])`,
      rcrIds,
    );
    const rcrBefore = rcrIds.length;
    const rcrLiveAfter = Number(rcrLiveAfterRows[0]?.count ?? '0');
    const rcrExtractedStable = rcrBefore - rcrLiveAfter;
    const conservation: ScopeBackfillConservation = { before: rcrBefore, liveAfter: rcrLiveAfter, extracted: rcrExtractedStable };
    if (conservation.before !== conservation.liveAfter + conservation.extracted) {
      throw new ScopeBackfillError(
        'CONSERVATION_VIOLATED',
        `before=${conservation.before} liveAfter=${conservation.liveAfter} extracted=${conservation.extracted}`,
      );
    }

    const projectResolvedStable = reviewFile.entries.filter((e) => e.decision === 'assign').length;
    const projectQuarantinedStable = reviewFile.entries.filter((e) => e.decision === 'quarantine').length;
    const counts: ScopeBackfillCounts = {
      source: reviewFile.entries.length + rcrBefore,
      resolved: projectResolvedStable + rcrLiveAfter,
      extracted: rcrExtractedStable,
      quarantined: projectQuarantinedStable,
      alreadyScoped: 0,
    };
    const changedCount = projectAssigned + rcrResolvedThisRun + rcrExtractedThisRun + projectQuarantinedThisRun;

    const sourceFactsDigestForControl = await sqlJsonDigestHex(client, {
      schemaVersion: 1,
      sourceModel: '__ScopeBackfillSourceFacts',
      projectManifestEntryIds: reviewFile.entries.map((e) => e.sourceId).sort(),
      roleChangeRequestIds: rcrIds,
    });
    const controlSourceRowJson = buildReviewedApplyControlSourceRowJson({
      reviewDigest: selfDigest,
      sourceFactsDigest: sourceFactsDigestForControl,
      counts,
    });
    const controlSourceRowHash = await sqlJsonDigestHex(client, controlSourceRowJson);
    const controlResolutionJson = buildReviewedApplyControlResolutionJson({
      reviewDigest: selfDigest,
      sourceFactsDigest: sourceFactsDigestForControl,
      sourceRowHash: controlSourceRowHash,
      conservation,
      changedCount,
    });

    const existingControlRows = await client.$queryRawUnsafe<
      { id: string; source_row_json: unknown; reason_code: string; candidate_scope_json: unknown }[]
    >(
      `SELECT id, source_row_json, reason_code, candidate_scope_json FROM scope_backfill_quarantine WHERE source_model = $1 AND source_id = $2 FOR UPDATE`,
      CONTROL_ROW_KEY.sourceModel,
      CONTROL_ROW_KEY.sourceId,
    );
    const existingControl = existingControlRows[0] ?? null;
    const controlOutcome = decideControlRowOutcome(
      existingControl
        ? { sourceRowJson: existingControl.source_row_json, reasonCode: existingControl.reason_code, candidateScopeJson: existingControl.candidate_scope_json }
        : null,
      { sourceRowJson: controlSourceRowJson, reasonCode: REASON_CODES.REVIEWED_APPLY, candidateScopeJson: reviewFile.entries },
    );

    if (controlOutcome === 'conflict') {
      throw new ScopeBackfillError(
        'CONTROL_ROW_CONFLICT',
        `an existing scope backfill control row does not match this apply's payload (reasonCode=${existingControl?.reason_code}); refusing to overwrite`,
      );
    }

    if (controlOutcome === 'insert') {
      await tx.scopeBackfillQuarantine.create({
        data: {
          id: CONTROL_ID,
          sourceModel: CONTROL_ROW_KEY.sourceModel,
          sourceId: CONTROL_ROW_KEY.sourceId,
          reasonCode: REASON_CODES.REVIEWED_APPLY,
          sourceRowJson: controlSourceRowJson as object,
          sourceRowHash: controlSourceRowHash,
          candidateScopeJson: reviewFile.entries as unknown as object,
          reviewDigest: selfDigest,
          resolvedAt: new Date(),
          resolvedBy: reviewFile.reviewerKey,
          resolutionJson: controlResolutionJson as object,
        },
      });
    }

    const verifyControl = await tx.scopeBackfillQuarantine.findUniqueOrThrow({
      where: { sourceModel_sourceId: { sourceModel: CONTROL_ROW_KEY.sourceModel, sourceId: CONTROL_ROW_KEY.sourceId } },
    });
    const rehash = await sqlJsonDigestHex(client, verifyControl.sourceRowJson);
    if (rehash !== verifyControl.sourceRowHash) {
      throw new ScopeBackfillError('CONTROL_ROW_HASH_MISMATCH', 'control row failed post-write re-hash verification');
    }
    if (verifyControl.reviewDigest !== selfDigest && controlOutcome === 'insert') {
      throw new ScopeBackfillError('CONTROL_ROW_DIGEST_MISMATCH', 'control row reviewDigest does not match this apply');
    }

    return {
      reviewDigest: selfDigest,
      counts,
      conservation,
      changedCount,
      controlOutcome,
      controlSourceRowHash: verifyControl.sourceRowHash,
      projectOutcomes,
      roleChangeOutcomes,
    };
  });

  const report = {
    schemaVersion: 1,
    mode: 'apply',
    result: 'PASS',
    generatedAt: new Date().toISOString(),
    ...result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new ScopeBackfillError('MISSING_DATABASE_URL', 'DATABASE_URL is required');
  assertLoopbackDatabaseUrl(databaseUrl);

  if (APPLY) {
    await runApply();
  } else {
    await runDryRun();
  }
}

main()
  .catch((error) => {
    const code = error instanceof ScopeBackfillError ? error.code : 'UNEXPECTED';
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, result: 'REJECTED', code, message: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
