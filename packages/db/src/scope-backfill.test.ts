import { describe, expect, it } from 'vitest';

import {
  CONTROL_ROW_KEY,
  REASON_CODES,
  ROLE_CHANGE_REQUEST_COLUMNS,
  assertLoopbackDatabaseUrl,
  assertSixFractionUtcTimestamp,
  buildEmptyDatabaseControlSourceRowJson,
  buildProjectCandidateScopeJson,
  buildProjectResolutionJson,
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
  manifestFactsProjection,
  matchRequester,
  sortStableIds,
  validateManifestEntryDecision,
  verifyRoleChangeRequestRowEnvelopeRoundTrip,
  type ProjectManifestFacts,
} from './scope-backfill';

describe('sortStableIds', () => {
  it('dedupes and sorts by UTF-16 code-unit order', () => {
    expect(sortStableIds(['b', 'a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('CONTROL_ROW_KEY', () => {
  it('is the exact fixed key for both control row variants', () => {
    expect(CONTROL_ROW_KEY).toEqual({ sourceModel: '__ScopeBackfillControl', sourceId: 'scope-closure/v1' });
  });
});

describe('ROLE_CHANGE_REQUEST_COLUMNS', () => {
  it('is sorted by name COLLATE "C" (plain ASCII order)', () => {
    const sorted = [...ROLE_CHANGE_REQUEST_COLUMNS].sort();
    expect([...ROLE_CHANGE_REQUEST_COLUMNS]).toEqual(sorted);
  });

  it('contains exactly the fixed physical role_change_requests column set', () => {
    expect([...ROLE_CHANGE_REQUEST_COLUMNS]).toEqual([
      'approved_by',
      'company_id',
      'created_at',
      'from_role',
      'id',
      'requested_by',
      'status',
      'to_role',
      'user_id',
    ]);
  });
});

describe('buildRoleChangeRequestRowEnvelope', () => {
  const columnTypes = {
    id: 'text',
    user_id: 'text',
    from_role: 'text',
    to_role: 'text',
    status: 'text',
    requested_by: 'text',
    approved_by: 'text',
    company_id: 'text',
    created_at: 'timestamp',
  };

  it('produces the exact schema shape with columns sorted by name', () => {
    const envelope = buildRoleChangeRequestRowEnvelope(columnTypes, {
      id: 'rcr1',
      user_id: 'u1',
      from_role: 'member',
      to_role: 'admin',
      status: 'pending',
      requested_by: 'u1',
      approved_by: null,
      company_id: null,
      created_at: '2026-07-19T12:34:56.123000Z',
    });
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.sourceModel).toBe('RoleChangeRequest');
    expect(envelope.columns.map((c) => c.name)).toEqual([...ROLE_CHANGE_REQUEST_COLUMNS]);
    expect(envelope.columns.find((c) => c.name === 'approved_by')).toEqual({
      name: 'approved_by',
      pgType: 'text',
      value: null,
    });
    expect(envelope.columns.find((c) => c.name === 'created_at')).toEqual({
      name: 'created_at',
      pgType: 'timestamp',
      value: '2026-07-19T12:34:56.123000Z',
    });
  });

  it('throws when a required column type is missing (structural drift guard)', () => {
    const { company_id, ...rest } = columnTypes;
    expect(() => buildRoleChangeRequestRowEnvelope(rest, {})).toThrow(/company_id/);
  });
});

describe('assertSixFractionUtcTimestamp', () => {
  it('accepts a UTC timestamp with exactly six fractional digits', () => {
    expect(assertSixFractionUtcTimestamp('2026-07-19T12:34:56.123456Z')).toBe('2026-07-19T12:34:56.123456Z');
  });

  it('rejects three-fraction-digit (millisecond only) timestamps', () => {
    expect(() => assertSixFractionUtcTimestamp('2026-07-19T12:34:56.123Z')).toThrow();
  });

  it('rejects a non-UTC offset', () => {
    expect(() => assertSixFractionUtcTimestamp('2026-07-19T12:34:56.123456+09:00')).toThrow();
  });
});

// ── Requester matching (dispatch: exact ID/email, no normalization, ordered) ──────────────────

describe('matchRequester', () => {
  it('an exact ID match wins when there is no email match', () => {
    const result = matchRequester({ idUserIds: ['u1'], emailUserIds: [] });
    expect(result).toEqual({ selectedUserId: 'u1', crossKeyConflict: false });
  });

  it('falls through to the unique exact email match when the ID set is empty', () => {
    const result = matchRequester({ idUserIds: [], emailUserIds: ['u2'] });
    expect(result).toEqual({ selectedUserId: 'u2', crossKeyConflict: false });
  });

  it('both keys pointing at the same user resolve once, not as a conflict', () => {
    const result = matchRequester({ idUserIds: ['u1'], emailUserIds: ['u1'] });
    expect(result).toEqual({ selectedUserId: 'u1', crossKeyConflict: false });
  });

  it('ID and email pointing at different users is an immediate cross-key conflict', () => {
    const result = matchRequester({ idUserIds: ['u1'], emailUserIds: ['u2'] });
    expect(result).toEqual({ selectedUserId: null, crossKeyConflict: true });
  });

  it('no exact key at all (case/trim/Unicode-normalization-only near matches never populate the sets) is no match', () => {
    // Case-only, trim-only, Unicode-normalization-only, users.name, and approved_by near-matches
    // must never appear in idUserIds/emailUserIds in the first place (the caller only performs
    // byte-exact convert_to(...,'UTF8') lookups) — this fixture models that upstream contract.
    const result = matchRequester({ idUserIds: [], emailUserIds: [] });
    expect(result).toEqual({ selectedUserId: null, crossKeyConflict: false });
  });
});

// ── RoleChangeRequest -> Company classification ────────────────────────────────────────────────

describe('classifyRoleChangeCompanyScope', () => {
  it('default/single-project or single-company guessing is rejected: two intersection candidates is ambiguous, never an auto-pick', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: ['c1', 'c2'],
      targetCompanyIds: ['c1', 'c2'],
      missingParentFacts: false,
    });
    expect(decision.classification).toBe('ambiguous');
    expect(decision.reasonCode).toBe(REASON_CODES.COMPANY_AMBIGUOUS);
    expect(decision.candidateCompanyIds).toEqual(['c1', 'c2']);
  });

  it('cross-key requester conflict is ambiguous/scope_requester_ambiguous, checked before company facts', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: ['u2'] },
      targetUserExists: true,
      requesterCompanyIds: ['c1'],
      targetCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({
      classification: 'ambiguous',
      reasonCode: REASON_CODES.REQUESTER_AMBIGUOUS,
      selectedUserId: null,
      candidateCompanyIds: [],
    });
  });

  it('a missing/contradictory Company or Tenant parent is ambiguous/scope_requester_ambiguous', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: ['c1'],
      targetCompanyIds: ['c1'],
      missingParentFacts: true,
    });
    expect(decision.classification).toBe('ambiguous');
    expect(decision.reasonCode).toBe(REASON_CODES.REQUESTER_AMBIGUOUS);
  });

  it('missing requester identity (no exact key at all) is unmatched/scope_requester_unmatched', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: [], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: [],
      targetCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({
      classification: 'unmatched',
      reasonCode: REASON_CODES.REQUESTER_UNMATCHED,
      selectedUserId: null,
      candidateCompanyIds: [],
    });
  });

  it('missing target user is unmatched/scope_requester_unmatched even with a resolved requester', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: false,
      requesterCompanyIds: ['c1'],
      targetCompanyIds: [],
      missingParentFacts: false,
    });
    expect(decision.classification).toBe('unmatched');
    expect(decision.reasonCode).toBe(REASON_CODES.REQUESTER_UNMATCHED);
  });

  it('zero membership on the requester side is unmatched/scope_requester_unmatched', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: [],
      targetCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(decision.classification).toBe('unmatched');
    expect(decision.reasonCode).toBe(REASON_CODES.REQUESTER_UNMATCHED);
  });

  it('zero membership on the target side is unmatched/scope_requester_unmatched', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: ['c1'],
      targetCompanyIds: [],
      missingParentFacts: false,
    });
    expect(decision.classification).toBe('unmatched');
    expect(decision.reasonCode).toBe(REASON_CODES.REQUESTER_UNMATCHED);
  });

  it('an empty intersection with real membership on both sides is unmatched/scope_company_unmatched', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: ['c1'],
      targetCompanyIds: ['c2'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({
      classification: 'unmatched',
      reasonCode: REASON_CODES.COMPANY_UNMATCHED,
      selectedUserId: 'u1',
      candidateCompanyIds: [],
    });
  });

  it('exactly one intersection candidate with consistent parents is resolved', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: ['c1', 'c2'],
      targetCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({
      classification: 'resolved',
      reasonCode: null,
      selectedUserId: 'u1',
      candidateCompanyIds: ['c1'],
    });
  });
});

describe('buildRoleChangeCandidateScopeJson', () => {
  it('produces the exact candidateScopeJson shape', () => {
    const decision = classifyRoleChangeCompanyScope({
      requestedByMatch: { idUserIds: ['u1'], emailUserIds: [] },
      targetUserExists: true,
      requesterCompanyIds: ['c1'],
      targetCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    const json = buildRoleChangeCandidateScopeJson({
      decision,
      targetUserId: 'u1',
      targetCompanyIds: ['c1'],
      requesterCompanyIds: ['c1'],
      sourceFacts: { note: 'fixture' },
    });
    expect(json).toEqual({
      schemaVersion: 'role-change-company-scope/v1',
      classification: 'resolved',
      reasonCode: null,
      requestedByMatch: { idUserIds: [], emailUserIds: [], selectedUserId: 'u1' },
      targetUserId: 'u1',
      targetCompanyIds: ['c1'],
      requesterCompanyIds: ['c1'],
      candidateCompanyIds: ['c1'],
      sourceFacts: { note: 'fixture' },
    });
  });
});

// ── Project -> Company classification ──────────────────────────────────────────────────────────

describe('classifyProjectCompanyScope', () => {
  it('a no-member Project is unmatched', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: false,
      membersWithZeroUcr: 0,
      candidateCompanyIds: [],
      missingParentFacts: false,
    });
    expect(decision).toEqual({ classification: 'unmatched', candidateCompanyIds: [] });
  });

  it('members exist but none has any company membership (zero-candidate union) is unmatched', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 2,
      candidateCompanyIds: [],
      missingParentFacts: false,
    });
    expect(decision).toEqual({ classification: 'unmatched', candidateCompanyIds: [] });
  });

  it('members resolving to two companies is ambiguous', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 0,
      candidateCompanyIds: ['c1', 'c2'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({ classification: 'ambiguous', candidateCompanyIds: ['c1', 'c2'] });
  });

  it('a member with no company membership while another candidate exists is ambiguous', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 1,
      candidateCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({ classification: 'ambiguous', candidateCompanyIds: ['c1'] });
  });

  it('a missing Company/Tenant parent is ambiguous even with a single candidate', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 0,
      candidateCompanyIds: ['c1'],
      missingParentFacts: true,
    });
    expect(decision).toEqual({ classification: 'ambiguous', candidateCompanyIds: ['c1'] });
  });

  it('exactly one candidate, every member has membership, no missing parents -> resolved', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 0,
      candidateCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(decision).toEqual({ classification: 'resolved', candidateCompanyIds: ['c1'] });
  });

  it('default/single-project guessing is rejected: a lone Project in the whole DB with an ambiguous member set still classifies ambiguous, never auto-resolved', () => {
    // Models a database that contains exactly ONE Project (the historical one-project-fallback
    // trigger condition in the forbidden backfill-project-scope.ts base) whose members
    // nonetheless resolve to two different companies. The classifier must ignore
    // "there's only one project" entirely and classify purely from membership facts.
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 0,
      candidateCompanyIds: ['company-a', 'company-b'],
      missingParentFacts: false,
    });
    expect(decision.classification).toBe('ambiguous');
  });
});

describe('buildProjectCandidateScopeJson', () => {
  it('produces the exact shape for an ambiguous Project', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 0,
      candidateCompanyIds: ['c1', 'c2'],
      missingParentFacts: false,
    });
    const json = buildProjectCandidateScopeJson({ decision, sourceFacts: { tuples: [] } });
    expect(json).toEqual({
      schemaVersion: 'project-company-scope/v1',
      classification: 'ambiguous',
      candidateCompanyIds: ['c1', 'c2'],
      sourceFacts: { tuples: [] },
    });
  });

  it('refuses to build a quarantine payload for a resolved Project (resolved Projects are assigned, never quarantined)', () => {
    const decision = classifyProjectCompanyScope({
      hasMembers: true,
      membersWithZeroUcr: 0,
      candidateCompanyIds: ['c1'],
      missingParentFacts: false,
    });
    expect(() => buildProjectCandidateScopeJson({ decision, sourceFacts: {} })).toThrow();
  });
});

describe('buildProjectResolutionJson', () => {
  it('produces the exact resolutionJson shape for a later reviewed assignment', () => {
    const json = buildProjectResolutionJson({
      companyId: 'c1',
      tenantId: 't1',
      reviewDigest: 'a'.repeat(64),
      sourceFactsDigest: 'b'.repeat(64),
    });
    expect(json).toEqual({
      schemaVersion: 1,
      resolution: 'assigned',
      companyId: 'c1',
      tenantId: 't1',
      reviewDigest: 'a'.repeat(64),
      sourceFactsDigest: 'b'.repeat(64),
    });
  });
});

// ── Reviewed manifest / review-file digest ─────────────────────────────────────────────────────

const manifestFacts: ProjectManifestFacts[] = [
  {
    sourceModel: 'Project',
    sourceId: 'p2',
    sourceRowHash: 'h2',
    sourceFactsDigest: 'f2',
    classification: 'unmatched',
    candidateCompanyIds: [],
  },
  {
    sourceModel: 'Project',
    sourceId: 'p1',
    sourceRowHash: 'h1',
    sourceFactsDigest: 'f1',
    classification: 'resolved',
    candidateCompanyIds: ['c1'],
  },
];

describe('manifestFactsProjection', () => {
  it('sorts by sourceId and strips reviewer-supplied fields', () => {
    const projected = manifestFactsProjection(manifestFacts);
    expect(projected.map((e) => e.sourceId)).toEqual(['p1', 'p2']);
    expect(Object.keys(projected[0]!).sort()).toEqual(
      ['sourceModel', 'sourceId', 'sourceRowHash', 'sourceFactsDigest', 'classification', 'candidateCompanyIds'].sort(),
    );
  });

  it('a reviewer-decorated entry set projects to the SAME facts as the bare dry-run set (decision fields never affect the digest input)', () => {
    const decorated = manifestFacts.map((e) => ({
      ...e,
      decision: e.classification === 'resolved' ? ('assign' as const) : ('quarantine' as const),
      selectedCompanyId: e.classification === 'resolved' ? e.candidateCompanyIds[0]! : null,
      reviewerKey: 'qa-harness',
      rationale: 'fixture',
    }));
    expect(manifestFactsProjection(decorated)).toEqual(manifestFactsProjection(manifestFacts));
  });

  it('any drift in the underlying facts (a stale/tampered candidate set) changes the projection', () => {
    const tampered = manifestFacts.map((e) => (e.sourceId === 'p1' ? { ...e, candidateCompanyIds: ['c1', 'c2'] } : e));
    expect(manifestFactsProjection(tampered)).not.toEqual(manifestFactsProjection(manifestFacts));
  });
});

describe('validateManifestEntryDecision', () => {
  it('rejects a null decision (unreviewed row) — closure is blocked until a human decides', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[1]!,
      decision: null,
      selectedCompanyId: null,
      reviewerKey: null,
      rationale: null,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects decision=assign with no reviewerKey (an unreviewed override)', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[1]!,
      decision: 'assign',
      selectedCompanyId: 'c1',
      reviewerKey: '',
      rationale: 'because',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects decision=assign with no rationale', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[1]!,
      decision: 'assign',
      selectedCompanyId: 'c1',
      reviewerKey: 'reviewer-1',
      rationale: '',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects decision=assign with no selectedCompanyId', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[1]!,
      decision: 'assign',
      selectedCompanyId: null,
      reviewerKey: 'reviewer-1',
      rationale: 'because',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects decision=quarantine that still carries a selectedCompanyId', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[0]!,
      decision: 'quarantine',
      selectedCompanyId: 'c1',
      reviewerKey: null,
      rationale: null,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a fully reviewed assign decision', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[1]!,
      decision: 'assign',
      selectedCompanyId: 'c1',
      reviewerKey: 'reviewer-1',
      rationale: 'sole resolved candidate',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a quarantine decision with no selectedCompanyId', () => {
    const result = validateManifestEntryDecision({
      ...manifestFacts[0]!,
      decision: 'quarantine',
      selectedCompanyId: null,
      reviewerKey: null,
      rationale: null,
    });
    expect(result.ok).toBe(true);
  });
});

// ── Round-trip / hash-drift / conflict decisions ───────────────────────────────────────────────

describe('verifyRoleChangeRequestRowEnvelopeRoundTrip', () => {
  const columnTypes = { id: 'text', user_id: 'text', from_role: 'text', to_role: 'text', status: 'text', requested_by: 'text', approved_by: 'text', company_id: 'text', created_at: 'timestamp' };
  const values = { id: 'r1', user_id: 'u1', from_role: 'a', to_role: 'b', status: 'pending', requested_by: 'u1', approved_by: null, company_id: null, created_at: '2026-07-19T00:00:00.000000Z' };

  it('passes when the live row matches the built envelope exactly', () => {
    const envelope = buildRoleChangeRequestRowEnvelope(columnTypes, values);
    expect(verifyRoleChangeRequestRowEnvelopeRoundTrip(envelope, values)).toEqual({ ok: true, mismatches: [] });
  });

  it('fails (non-round-trippable / concurrently changed) when a live column value differs', () => {
    const envelope = buildRoleChangeRequestRowEnvelope(columnTypes, values);
    const changedLive = { ...values, status: 'approved' };
    const result = verifyRoleChangeRequestRowEnvelopeRoundTrip(envelope, changedLive);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual(['status']);
  });
});

describe('decideProjectApplyOutcome', () => {
  const base = {
    liveSourceRowHash: 'h',
    reviewedSourceRowHash: 'h',
    liveSourceFactsDigest: 'f',
    reviewedSourceFactsDigest: 'f',
  };

  it('assigns a null-scope Project whose hashes match the review file', () => {
    expect(decideProjectApplyOutcome({ ...base, currentCompanyId: null, reviewedCompanyId: 'c1' })).toBe('assigned');
  });

  it('a stale digest (row or facts drifted since dry-run) produces zero writes for that row', () => {
    expect(
      decideProjectApplyOutcome({ ...base, liveSourceRowHash: 'different', currentCompanyId: null, reviewedCompanyId: 'c1' }),
    ).toBe('stale_manifest');
    expect(
      decideProjectApplyOutcome({ ...base, liveSourceFactsDigest: 'different', currentCompanyId: null, reviewedCompanyId: 'c1' }),
    ).toBe('stale_manifest');
  });

  it('a concurrently-set company_id equal to the reviewed value is already-consistent, not overwritten', () => {
    expect(decideProjectApplyOutcome({ ...base, currentCompanyId: 'c1', reviewedCompanyId: 'c1' })).toBe('already_consistent');
  });

  it('a concurrently changed source (company_id set to something else) produces a conflict', () => {
    expect(decideProjectApplyOutcome({ ...base, currentCompanyId: 'c2', reviewedCompanyId: 'c1' })).toBe('conflict');
  });
});

describe('decideControlRowOutcome', () => {
  const candidate = { sourceRowJson: { mode: 'reviewed_apply', a: 1 }, reasonCode: REASON_CODES.REVIEWED_APPLY, candidateScopeJson: [{ p: 1 }] };

  it('inserts when no control row exists yet', () => {
    expect(decideControlRowOutcome(null, candidate)).toBe('insert');
  });

  it('an identical rerun (same reasonCode, sourceRowJson, and candidateScopeJson) is a no-op', () => {
    expect(
      decideControlRowOutcome(
        { sourceRowJson: { mode: 'reviewed_apply', a: 1 }, reasonCode: REASON_CODES.REVIEWED_APPLY, candidateScopeJson: [{ p: 1 }] },
        candidate,
      ),
    ).toBe('identical_noop');
  });

  it('an existing empty-database sentinel blocks a reviewed apply in a now-non-empty database (the two control variants never replace one another)', () => {
    const emptySentinel = { sourceRowJson: { mode: 'empty_database', a: 0 }, reasonCode: REASON_CODES.EMPTY_DATABASE, candidateScopeJson: [] };
    expect(decideControlRowOutcome(emptySentinel, candidate)).toBe('conflict');
  });

  it('a mismatched/hand-inserted control row (different sourceRowJson, same reasonCode) blocks', () => {
    const tampered = { sourceRowJson: { mode: 'reviewed_apply', a: 999 }, reasonCode: REASON_CODES.REVIEWED_APPLY, candidateScopeJson: [{ p: 1 }] };
    expect(decideControlRowOutcome(tampered, candidate)).toBe('conflict');
  });

  it('a hand-tampered candidateScopeJson (reviewed manifest payload) blocks even when sourceRowJson and reasonCode are untouched', () => {
    const tampered = { sourceRowJson: { mode: 'reviewed_apply', a: 1 }, reasonCode: REASON_CODES.REVIEWED_APPLY, candidateScopeJson: [] };
    expect(decideControlRowOutcome(tampered, candidate)).toBe('conflict');
  });

  it('data inserted after the empty-database sentinel (source no longer empty) blocks rather than silently replacing it', () => {
    const emptySentinel = { sourceRowJson: { mode: 'empty_database', a: 0 }, reasonCode: REASON_CODES.EMPTY_DATABASE, candidateScopeJson: [] };
    const nowNonEmptyCandidate = { sourceRowJson: { mode: 'reviewed_apply', a: 1, counts: { source: 3 } }, reasonCode: REASON_CODES.REVIEWED_APPLY, candidateScopeJson: [{ p: 1 }] };
    expect(decideControlRowOutcome(emptySentinel, nowNonEmptyCandidate)).toBe('conflict');
  });
});

describe('deepJsonEqual', () => {
  it('is order-independent over object keys', () => {
    expect(deepJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('detects nested array/object differences', () => {
    expect(deepJsonEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
  });

  it('the second-apply control row report is byte-identical to the first', () => {
    const first = buildReviewedApplyControlSourceRowJson({
      reviewDigest: 'r',
      sourceFactsDigest: 'f',
      counts: { source: 2, resolved: 1, extracted: 1, quarantined: 1, alreadyScoped: 0 },
    });
    const rerun = buildReviewedApplyControlSourceRowJson({
      reviewDigest: 'r',
      sourceFactsDigest: 'f',
      counts: { source: 2, resolved: 1, extracted: 1, quarantined: 1, alreadyScoped: 0 },
    });
    expect(deepJsonEqual(first, rerun)).toBe(true);
  });
});

// ── Control row payload shapes ──────────────────────────────────────────────────────────────────

describe('buildReviewedApplyControlSourceRowJson / buildReviewedApplyControlResolutionJson', () => {
  it('produce the exact reviewed_apply shapes, including a zero-change already-closed apply', () => {
    const counts = { source: 5, resolved: 3, extracted: 2, quarantined: 2, alreadyScoped: 0 };
    const sourceRowJson = buildReviewedApplyControlSourceRowJson({ reviewDigest: 'rd', sourceFactsDigest: 'sfd', counts });
    expect(sourceRowJson).toEqual({
      schemaVersion: 1,
      kind: 'scope-backfill-control',
      mode: 'reviewed_apply',
      reviewDigest: 'rd',
      sourceFactsDigest: 'sfd',
      counts,
    });

    const zeroChange = buildReviewedApplyControlResolutionJson({
      reviewDigest: 'rd',
      sourceFactsDigest: 'sfd',
      sourceRowHash: 'srh',
      conservation: { before: 5, liveAfter: 5, extracted: 0 },
      changedCount: 0,
    });
    expect(zeroChange).toEqual({
      schemaVersion: 1,
      applyState: 'completed',
      reviewDigest: 'rd',
      sourceFactsDigest: 'sfd',
      sourceRowHash: 'srh',
      conservation: { before: 5, liveAfter: 5, extracted: 0 },
      changedCount: 0,
    });
    expect(Object.values(zeroChange.conservation).every((n) => typeof n === 'number' && n >= 0)).toBe(true);
  });
});

describe('buildEmptyDatabaseControlSourceRowJson', () => {
  it('produces the exact empty_database sentinel shape with all counts zero', () => {
    const json = buildEmptyDatabaseControlSourceRowJson({ reviewDigest: 'rd', sourceFactsDigest: 'sfd' });
    expect(json).toEqual({
      schemaVersion: 1,
      kind: 'scope-backfill-control',
      mode: 'empty_database',
      reviewDigest: 'rd',
      sourceFactsDigest: 'sfd',
      counts: { source: 0, resolved: 0, extracted: 0, quarantined: 0, alreadyScoped: 0 },
    });
  });
});

// ── Runner safety ───────────────────────────────────────────────────────────────────────────────

describe('assertLoopbackDatabaseUrl', () => {
  it('accepts 127.0.0.1', () => {
    expect(() => assertLoopbackDatabaseUrl('postgresql://u:p@127.0.0.1:5432/db')).not.toThrow();
  });

  it('refuses a caller-supplied remote DB URL', () => {
    expect(() => assertLoopbackDatabaseUrl('postgresql://u:p@prod-db.example.com:5432/db')).toThrow(/refusing non-loopback/);
  });

  it('refuses an unparseable URL', () => {
    expect(() => assertLoopbackDatabaseUrl('not-a-url')).toThrow();
  });
});

// ── SQL-side digest (structural — the actual digest call requires a live Postgres connection and
// is exercised in scope-backfill.integration.test.ts; this only proves the module never imports a
// JS hashing/serialization library as a substitute). ───────────────────────────────────────────

describe('hashing contract', () => {
  it('this module does not import a JS crypto/hash serializer (sourceRowHash must be SQL-computed only)', async () => {
    const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./scope-backfill.ts', import.meta.url), 'utf8'));
    expect(src).not.toMatch(/from ['"]node:crypto['"]/);
    expect(src).not.toMatch(/from ['"]crypto['"]/);
    expect(src).not.toMatch(/createHash/);
  });

  it('computeManifestDigest and sqlJsonDigestHex are exported as async functions requiring a DigestClient (no synchronous JS fallback path)', async () => {
    const mod = await import('./scope-backfill');
    expect(mod.computeManifestDigest.constructor.name).toBe('AsyncFunction');
    expect(mod.sqlJsonDigestHex.constructor.name).toBe('AsyncFunction');
  });
});

void computeManifestDigest;
