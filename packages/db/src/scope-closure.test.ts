import { describe, expect, it } from 'vitest';

import {
  buildClosureReport,
  isHex64,
  verifyCompanyTenantIntegrity,
  verifyControlRow,
  verifyProjectClosure,
  verifyProjectSourceFactsFreshness,
  verifyRoleChangeRequestClosure,
  type ClosureFacts,
  type ManifestEntryFacts,
  type QuarantineRowFacts,
  type RawControlRow,
} from './scope-closure';
import { CONTROL_ROW_KEY, REASON_CODES } from './scope-backfill';
import { MODEL_SCOPE_INVENTORY, type DmmfRelationField, type ScopeInventoryEntry } from './scope-inventory';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function reviewedApplyRow(overrides: Partial<RawControlRow> = {}): RawControlRow {
  const sourceRowJson = {
    schemaVersion: 1,
    kind: 'scope-backfill-control',
    mode: 'reviewed_apply',
    reviewDigest: HASH_A,
    sourceFactsDigest: HASH_B,
    counts: { source: 1, resolved: 1, extracted: 0, quarantined: 0, alreadyScoped: 0 },
  };
  return {
    id: 'scope-backfill-control-reviewed-apply',
    sourceModel: CONTROL_ROW_KEY.sourceModel,
    sourceId: CONTROL_ROW_KEY.sourceId,
    reasonCode: REASON_CODES.REVIEWED_APPLY,
    sourceRowJson,
    sourceRowHash: HASH_C,
    candidateScopeJson: [],
    reviewDigest: HASH_A,
    resolvedAt: '2026-07-15T00:00:00.000000Z',
    resolvedBy: 'qa-harness-reviewer',
    resolutionJson: {
      applyState: 'completed',
      reviewDigest: HASH_A,
      sourceFactsDigest: HASH_B,
      sourceRowHash: HASH_C,
      conservation: { before: 6, liveAfter: 2, extracted: 4 },
    },
    ...overrides,
  };
}

function emptyDatabaseRow(overrides: Partial<RawControlRow> = {}): RawControlRow {
  const sourceRowJson = {
    schemaVersion: 1,
    kind: 'scope-backfill-control',
    mode: 'empty_database',
    reviewDigest: HASH_A,
    sourceFactsDigest: HASH_B,
    counts: { source: 0, resolved: 0, extracted: 0, quarantined: 0, alreadyScoped: 0 },
  };
  return {
    id: 'scope-backfill-control-empty-database',
    sourceModel: CONTROL_ROW_KEY.sourceModel,
    sourceId: CONTROL_ROW_KEY.sourceId,
    reasonCode: REASON_CODES.EMPTY_DATABASE,
    sourceRowJson,
    sourceRowHash: HASH_C,
    candidateScopeJson: [],
    reviewDigest: HASH_A,
    resolvedAt: '2026-07-15T00:00:00.000000Z',
    resolvedBy: 'migration:20260715110000_scope_backfill_quarantine',
    resolutionJson: {
      applyState: 'completed',
      reviewDigest: HASH_A,
      sourceFactsDigest: HASH_B,
      sourceRowHash: HASH_C,
      conservation: { before: 0, liveAfter: 0, extracted: 0 },
    },
    ...overrides,
  };
}

describe('isHex64', () => {
  it('accepts exactly 64 lowercase hex characters', () => {
    expect(isHex64(HASH_A)).toBe(true);
  });
  it('rejects uppercase, short, and non-hex strings', () => {
    expect(isHex64('A'.repeat(64))).toBe(false);
    expect(isHex64('a'.repeat(63))).toBe(false);
    expect(isHex64('not-a-hash')).toBe(false);
    expect(isHex64(null)).toBe(false);
  });
});

describe('verifyControlRow — missing/malformed/hand-inserted/stale control row', () => {
  it('fails with CONTROL_ROW_MISSING when no row exists', () => {
    const result = verifyControlRow({ row: null, recomputedSourceRowHash: null, recomputedReviewDigest: null, liveProjectsCount: 0, liveRoleChangeRequestsCount: 0 });
    expect(result.ok).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual(['CONTROL_ROW_MISSING']);
  });

  it('fails with CONTROL_ROW_HAND_INSERTED when the row key does not match the fixed U011 key', () => {
    const row = reviewedApplyRow({ sourceModel: 'SomethingElse' });
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_HAND_INSERTED')).toBe(true);
  });

  it('fails with CONTROL_ROW_HAND_INSERTED when the row id is not a known U011 apply id', () => {
    const row = reviewedApplyRow({ id: 'hand-inserted-row' });
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_HAND_INSERTED')).toBe(true);
  });

  it('fails with CONTROL_ROW_MALFORMED when sourceRowJson is missing required fields', () => {
    const row = reviewedApplyRow({ sourceRowJson: { schemaVersion: 1 } });
    const result = verifyControlRow({ row, recomputedSourceRowHash: null, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.ok).toBe(false);
    expect(result.mode).toBeNull();
    expect(result.blockers).toEqual([{ code: 'CONTROL_ROW_MALFORMED', message: expect.any(String) }]);
  });

  it('fails with CONTROL_ROW_MALFORMED when mode is neither known variant', () => {
    const row = reviewedApplyRow();
    (row.sourceRowJson as { mode: string }).mode = 'partial_apply';
    const result = verifyControlRow({ row, recomputedSourceRowHash: null, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_MALFORMED')).toBe(true);
  });

  it('fails with CONTROL_ROW_DIGEST_NOT_HEX64 when a digest field is not 64 lowercase hex', () => {
    const row = reviewedApplyRow();
    (row.sourceRowJson as { reviewDigest: string }).reviewDigest = 'not-hex';
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_DIGEST_NOT_HEX64')).toBe(true);
  });

  it('fails with CONTROL_ROW_HASH_MISMATCH when the recomputed sourceRowHash disagrees with the stored one (tampered/stale)', () => {
    const row = reviewedApplyRow();
    const result = verifyControlRow({ row, recomputedSourceRowHash: 'd'.repeat(64), recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_HASH_MISMATCH')).toBe(true);
  });

  it('fails with CONTROL_ROW_REVIEW_DIGEST_TAMPERED when the recomputed review digest over candidateScopeJson disagrees (tampered Project source-facts digest)', () => {
    const row = reviewedApplyRow();
    const result = verifyControlRow({
      row,
      recomputedSourceRowHash: row.sourceRowHash,
      recomputedReviewDigest: 'e'.repeat(64),
      liveProjectsCount: 1,
      liveRoleChangeRequestsCount: 0,
    });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_REVIEW_DIGEST_TAMPERED')).toBe(true);
  });

  it('fails with CONTROL_ROW_FIELDS_DISAGREE when resolutionJson.sourceRowHash disagrees with the stored sourceRowHash', () => {
    const row = reviewedApplyRow();
    (row.resolutionJson as { sourceRowHash: string }).sourceRowHash = 'f'.repeat(64);
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_FIELDS_DISAGREE')).toBe(true);
  });

  it('fails with CONTROL_ROW_CONSERVATION_VIOLATED when before != liveAfter + extracted', () => {
    const row = reviewedApplyRow();
    (row.resolutionJson as { conservation: { before: number; liveAfter: number; extracted: number } }).conservation = { before: 6, liveAfter: 2, extracted: 1 };
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_CONSERVATION_VIOLATED')).toBe(true);
  });

  it('fails with CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY when an empty_database row exists but a source table is non-empty', () => {
    const row = emptyDatabaseRow();
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY')).toBe(true);
  });

  it('fails with CONTROL_ROW_MALFORMED when empty_database candidateScopeJson is not an empty array (converting empty to reviewed is a test failure)', () => {
    const row = emptyDatabaseRow({ candidateScopeJson: [{ sourceId: 'p1' }] });
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 0, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_MALFORMED')).toBe(true);
  });

  it('fails with CONTROL_ROW_MALFORMED when resolvedBy is missing (hand-inserted row missing provenance)', () => {
    const row = reviewedApplyRow({ resolvedBy: null });
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 0 });
    expect(result.blockers.some((b) => b.code === 'CONTROL_ROW_MALFORMED')).toBe(true);
  });

  it('accepts a byte/hash/conservation-valid reviewed_apply row, including the non-empty zero-change case', () => {
    const row = reviewedApplyRow({
      resolutionJson: {
        applyState: 'completed',
        reviewDigest: HASH_A,
        sourceFactsDigest: HASH_B,
        sourceRowHash: HASH_C,
        conservation: { before: 5, liveAfter: 5, extracted: 0 },
      },
    });
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: HASH_A, liveProjectsCount: 3, liveRoleChangeRequestsCount: 5 });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('reviewed_apply');
    expect(result.blockers).toEqual([]);
  });

  it('accepts a valid empty_database row while both source tables are still physically empty', () => {
    const row = emptyDatabaseRow();
    const result = verifyControlRow({ row, recomputedSourceRowHash: row.sourceRowHash, recomputedReviewDigest: null, liveProjectsCount: 0, liveRoleChangeRequestsCount: 0 });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('empty_database');
    expect(result.blockers).toEqual([]);
  });
});

describe('verifyProjectClosure — missing Project->Company / incomplete facts / unreviewed override', () => {
  it('flags PROJECT_UNMAPPED for a null-company Project with no manifest entry at all (missing Project->Company)', () => {
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: null }], [], []);
    expect(blockers).toEqual([{ code: 'PROJECT_UNMAPPED', message: expect.any(String), sourceId: 'p1' }]);
  });

  it('flags PROJECT_UNMAPPED when a null-company Project has a manifest entry whose decision is not "quarantine" (an assign that never took effect)', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: 'rev' },
    ];
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: null }], entries, []);
    expect(blockers.some((b) => b.code === 'PROJECT_UNMAPPED')).toBe(true);
  });

  it('flags PROJECT_CANDIDATE_FACTS_MALFORMED for an ambiguous/incomplete quarantine row missing candidateScopeJson (incomplete Project candidate facts)', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'ambiguous', candidateCompanyIds: ['c1', 'c2'], decision: 'quarantine', selectedCompanyId: null, reviewerKey: null },
    ];
    const quarantine: QuarantineRowFacts[] = [
      { sourceModel: 'Project', sourceId: 'p1', reasonCode: 'scope_project_ambiguous', resolvedAt: null, candidateScopeJson: null },
    ];
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: null }], entries, quarantine);
    expect(blockers).toEqual([{ code: 'PROJECT_CANDIDATE_FACTS_MALFORMED', message: expect.any(String), sourceId: 'p1' }]);
  });

  it('flags PROJECT_CANDIDATE_FACTS_MALFORMED when the quarantine candidateScopeJson has the wrong schemaVersion (ambiguous Project candidate facts)', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'ambiguous', candidateCompanyIds: ['c1', 'c2'], decision: 'quarantine', selectedCompanyId: null, reviewerKey: null },
    ];
    const quarantine: QuarantineRowFacts[] = [
      { sourceModel: 'Project', sourceId: 'p1', reasonCode: 'scope_project_ambiguous', resolvedAt: null, candidateScopeJson: { schemaVersion: 'wrong', classification: 'ambiguous', candidateCompanyIds: ['c1', 'c2'], sourceFacts: {} } },
    ];
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: null }], entries, quarantine);
    expect(blockers.some((b) => b.code === 'PROJECT_CANDIDATE_FACTS_MALFORMED')).toBe(true);
  });

  it('accepts a well-formed quarantine row for a genuinely unmatched/ambiguous Project', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'unmatched', candidateCompanyIds: [], decision: 'quarantine', selectedCompanyId: null, reviewerKey: null },
    ];
    const quarantine: QuarantineRowFacts[] = [
      { sourceModel: 'Project', sourceId: 'p1', reasonCode: 'scope_project_unmatched', resolvedAt: null, candidateScopeJson: { schemaVersion: 'project-company-scope/v1', classification: 'unmatched', candidateCompanyIds: [], sourceFacts: {} } },
    ];
    expect(verifyProjectClosure([{ id: 'p1', companyId: null }], entries, quarantine)).toEqual([]);
  });

  it('flags PROJECT_UNREVIEWED_OVERRIDE when a Project has company_id set but its manifest entry does not attest an assign decision to that company (unreviewed Project override)', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'ambiguous', candidateCompanyIds: ['c1', 'c2'], decision: 'quarantine', selectedCompanyId: null, reviewerKey: null },
    ];
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: 'c1' }], entries, []);
    expect(blockers).toEqual([{ code: 'PROJECT_UNREVIEWED_OVERRIDE', message: expect.any(String), sourceId: 'p1' }]);
  });

  it('flags PROJECT_UNREVIEWED_OVERRIDE when the assigned company_id does not match the reviewed selectedCompanyId', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: 'rev' },
    ];
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: 'c2' }], entries, []);
    expect(blockers.some((b) => b.code === 'PROJECT_UNREVIEWED_OVERRIDE')).toBe(true);
  });

  it('flags PROJECT_UNREVIEWED_OVERRIDE when reviewerKey is empty despite an assign decision', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: '' },
    ];
    const blockers = verifyProjectClosure([{ id: 'p1', companyId: 'c1' }], entries, []);
    expect(blockers.some((b) => b.code === 'PROJECT_UNREVIEWED_OVERRIDE')).toBe(true);
  });

  it('accepts a Project whose company_id matches a well-formed assign decision', () => {
    const entries: ManifestEntryFacts[] = [
      { sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: 'qa-harness-reviewer' },
    ];
    expect(verifyProjectClosure([{ id: 'p1', companyId: 'c1' }], entries, [])).toEqual([]);
  });

  it('accepts a Project with company_id set and no manifest entry (never null at review time, resolved from creation)', () => {
    expect(verifyProjectClosure([{ id: 'p1', companyId: 'c1' }], [], [])).toEqual([]);
  });

  it('accepts a Project with company_id set and no manifest available at all (empty_database mode: manifestEntries is null)', () => {
    expect(verifyProjectClosure([{ id: 'p1', companyId: 'c1' }], null, [])).toEqual([]);
  });
});

describe('verifyProjectSourceFactsFreshness — tampered Project source-facts digest', () => {
  it('flags PROJECT_SOURCE_FACTS_TAMPERED when an assigned entry disagrees with a fresh live recompute', () => {
    const entries: ManifestEntryFacts[] = [{ sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: 'rev' }];
    const withHashes = entries.map((e) => ({ ...e, sourceRowHash: HASH_A, sourceFactsDigest: HASH_B }));
    const blockers = verifyProjectSourceFactsFreshness(entries, withHashes, [{ sourceId: 'p1', liveSourceRowHash: HASH_A, liveSourceFactsDigest: 'tampered-digest'.padEnd(64, '0') }]);
    expect(blockers).toEqual([{ code: 'PROJECT_SOURCE_FACTS_TAMPERED', message: expect.any(String), sourceId: 'p1' }]);
  });

  it('accepts an assigned entry whose recorded hashes match a fresh live recompute', () => {
    const entries: ManifestEntryFacts[] = [{ sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: 'rev' }];
    const withHashes = entries.map((e) => ({ ...e, sourceRowHash: HASH_A, sourceFactsDigest: HASH_B }));
    const blockers = verifyProjectSourceFactsFreshness(entries, withHashes, [{ sourceId: 'p1', liveSourceRowHash: HASH_A, liveSourceFactsDigest: HASH_B }]);
    expect(blockers).toEqual([]);
  });

  it('ignores quarantine-decision entries (freshness only matters for assign)', () => {
    const entries: ManifestEntryFacts[] = [{ sourceId: 'p1', classification: 'ambiguous', candidateCompanyIds: [], decision: 'quarantine', selectedCompanyId: null, reviewerKey: null }];
    const withHashes = entries.map((e) => ({ ...e, sourceRowHash: HASH_A, sourceFactsDigest: HASH_B }));
    const blockers = verifyProjectSourceFactsFreshness(entries, withHashes, [{ sourceId: 'p1', liveSourceRowHash: 'different'.padEnd(64, '0'), liveSourceFactsDigest: HASH_B }]);
    expect(blockers).toEqual([]);
  });
});

describe('verifyCompanyTenantIntegrity — Company->Tenant mismatch', () => {
  it('flags COMPANY_TENANT_ORPHAN when a Company references a tenant that does not exist', () => {
    const blockers = verifyCompanyTenantIntegrity([{ companyId: 'c1', tenantId: 't-missing', tenantExists: false }]);
    expect(blockers).toEqual([{ code: 'COMPANY_TENANT_ORPHAN', message: expect.any(String), sourceId: 'c1' }]);
  });

  it('accepts a Company whose tenant exists', () => {
    expect(verifyCompanyTenantIntegrity([{ companyId: 'c1', tenantId: 't1', tenantExists: true }])).toEqual([]);
  });
});

describe('verifyRoleChangeRequestClosure — live null company / stale quarantine / unrepresented source', () => {
  it('flags ROLE_CHANGE_REQUEST_LIVE_NULL_COMPANY when any live row still has company_id IS NULL', () => {
    const blockers = verifyRoleChangeRequestClosure({ liveNullCompanyCount: 2, liveTotalCount: 5, quarantineExtractedCount: 0, staleQuarantineLiveOverlapCount: 0, conservation: null });
    expect(blockers.some((b) => b.code === 'ROLE_CHANGE_REQUEST_LIVE_NULL_COMPANY')).toBe(true);
  });

  it('flags QUARANTINE_STALE when a quarantine row for RoleChangeRequest still overlaps a live row (stale quarantine)', () => {
    const blockers = verifyRoleChangeRequestClosure({ liveNullCompanyCount: 0, liveTotalCount: 5, quarantineExtractedCount: 3, staleQuarantineLiveOverlapCount: 1, conservation: null });
    expect(blockers).toEqual([{ code: 'QUARANTINE_STALE', message: expect.any(String) }]);
  });

  it('flags ROLE_CHANGE_REQUEST_UNREPRESENTED_SOURCE when the live total count disagrees with control-row conservation.liveAfter (missing extraction)', () => {
    const blockers = verifyRoleChangeRequestClosure({ liveNullCompanyCount: 0, liveTotalCount: 3, quarantineExtractedCount: 4, staleQuarantineLiveOverlapCount: 0, conservation: { before: 6, liveAfter: 2, extracted: 4 } });
    expect(blockers.some((b) => b.code === 'ROLE_CHANGE_REQUEST_UNREPRESENTED_SOURCE')).toBe(true);
  });

  it('flags ROLE_CHANGE_REQUEST_EXTRACTION_MISMATCH when quarantine extraction count disagrees with control-row conservation.extracted (tampered RoleChangeRequest extraction)', () => {
    const blockers = verifyRoleChangeRequestClosure({ liveNullCompanyCount: 0, liveTotalCount: 2, quarantineExtractedCount: 3, staleQuarantineLiveOverlapCount: 0, conservation: { before: 6, liveAfter: 2, extracted: 4 } });
    expect(blockers.some((b) => b.code === 'ROLE_CHANGE_REQUEST_EXTRACTION_MISMATCH')).toBe(true);
  });

  it('accepts a fully closed RoleChangeRequest state that reconciles conservation exactly', () => {
    const blockers = verifyRoleChangeRequestClosure({ liveNullCompanyCount: 0, liveTotalCount: 2, quarantineExtractedCount: 4, staleQuarantineLiveOverlapCount: 0, conservation: { before: 6, liveAfter: 2, extracted: 4 } });
    expect(blockers).toEqual([]);
  });

  it('accepts zero live nulls with no control row conservation available (e.g. resolved-from-creation database)', () => {
    expect(verifyRoleChangeRequestClosure({ liveNullCompanyCount: 0, liveTotalCount: 0, quarantineExtractedCount: 0, staleQuarantineLiveOverlapCount: 0, conservation: null })).toEqual([]);
  });
});

const REAL_ENTRIES: ScopeInventoryEntry[] = Object.values(MODEL_SCOPE_INVENTORY);
const REAL_MODEL_NAMES = REAL_ENTRIES.map((e) => e.model);
const REAL_DMMF: DmmfRelationField[] = REAL_ENTRIES.filter(
  (e): e is Extract<ScopeInventoryEntry, { category: 'CHILD_VIA_FK' }> => e.category === 'CHILD_VIA_FK',
).map((e) => ({
  model: e.model,
  relationField: e.relationField,
  targetModel: e.parentModel,
  scalarFkFields: [e.scalarFkField],
  mandatory: true,
  onDelete: 'Restrict',
}));

function validClosureFacts(): ClosureFacts {
  return {
    currentModelNames: REAL_MODEL_NAMES,
    inventoryEntries: REAL_ENTRIES,
    dmmfRelations: REAL_DMMF,
    controlRow: {
      row: reviewedApplyRow({
        resolutionJson: {
          applyState: 'completed',
          reviewDigest: HASH_A,
          sourceFactsDigest: HASH_B,
          sourceRowHash: HASH_C,
          conservation: { before: 2, liveAfter: 2, extracted: 0 },
        },
      }),
      recomputedSourceRowHash: HASH_C,
      recomputedReviewDigest: HASH_A,
      liveProjectsCount: 1,
      liveRoleChangeRequestsCount: 1,
    },
    projects: [{ id: 'p1', companyId: 'c1' }],
    manifestEntries: [{ sourceId: 'p1', classification: 'resolved', candidateCompanyIds: ['c1'], decision: 'assign', selectedCompanyId: 'c1', reviewerKey: 'qa-harness-reviewer' }],
    quarantineRows: [],
    companyTenantRows: [{ companyId: 'c1', tenantId: 't1', tenantExists: true }],
    roleChangeRequest: { liveNullCompanyCount: 0, liveTotalCount: 1, quarantineExtractedCount: 0, staleQuarantineLiveOverlapCount: 0, conservation: { before: 1, liveAfter: 1, extracted: 0 } },
  };
}

describe('buildClosureReport — null mandatory child FK / valid closed graph', () => {
  it('reports zero blockers for a fully valid closed graph', () => {
    const report = buildClosureReport(validClosureFacts());
    expect(report.blockers).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('flags a CHILD_VIA_FK entry whose live scalar FK is nullable (null mandatory child FK)', () => {
    const facts = validClosureFacts();
    facts.dmmfRelations = facts.dmmfRelations.map((r) => (r.model === 'ProjectMember' ? { ...r, mandatory: false } : r));
    const report = buildClosureReport(facts);
    expect(report.ok).toBe(false);
    expect(report.childFkErrors.some((e) => e.code === 'DEAD_END_CHAIN' && e.model === 'ProjectMember')).toBe(true);
    expect(report.blockers.some((b) => b.sourceId === 'ProjectMember')).toBe(true);
  });

  it('flags an inventory count mismatch when the live model count drifts from 151', () => {
    const facts = validClosureFacts();
    facts.currentModelNames = [...facts.currentModelNames, 'NotARealModel'];
    const report = buildClosureReport(facts);
    expect(report.ok).toBe(false);
    expect(report.inventory.ok).toBe(false);
  });

  it('propagates a missing control row as a blocking closure report', () => {
    const facts = validClosureFacts();
    facts.controlRow = { row: null, recomputedSourceRowHash: null, recomputedReviewDigest: null, liveProjectsCount: 1, liveRoleChangeRequestsCount: 1 };
    const report = buildClosureReport(facts);
    expect(report.ok).toBe(false);
    expect(report.controlRow.blockers.some((b) => b.code === 'CONTROL_ROW_MISSING')).toBe(true);
  });

  it('reports zero blockers for a valid empty-path closed graph (both source tables empty, empty_database sentinel)', () => {
    const facts = validClosureFacts();
    facts.projects = [];
    facts.manifestEntries = null;
    facts.companyTenantRows = [];
    facts.controlRow = {
      row: emptyDatabaseRow(),
      recomputedSourceRowHash: HASH_C,
      recomputedReviewDigest: null,
      liveProjectsCount: 0,
      liveRoleChangeRequestsCount: 0,
    };
    facts.roleChangeRequest = { liveNullCompanyCount: 0, liveTotalCount: 0, quarantineExtractedCount: 0, staleQuarantineLiveOverlapCount: 0, conservation: { before: 0, liveAfter: 0, extracted: 0 } };
    const report = buildClosureReport(facts);
    expect(report.blockers).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
