/**
 * U011 — reviewed, idempotent scope backfill with ambiguity quarantine.
 *
 * Split into two layers:
 *   - Pure decision functions (no I/O) that take already-fetched facts and return a
 *     classification, exhaustively unit-tested in `scope-backfill.test.ts`.
 *   - Thin DB-touching functions that fetch facts via Postgres (raw SQL, byte-exact — never a
 *     Prisma relation that could silently normalize/trim) and delegate to the pure functions,
 *     exercised by `scope-backfill.integration.test.ts` and `scripts/run-db-contract.ts`.
 *
 * Every content hash in this module is computed by Postgres itself —
 *   `encode(public.digest(pg_catalog.convert_to(<value>::jsonb::text,'UTF8'),'sha256'),'hex')`
 * — never by a JS JSON serializer, because `jsonb::text` is Postgres's canonical
 * (key-order-independent) serialization; hashing our own JS key-insertion order instead would
 * not be reproducible across processes.
 */
import type { PrismaClient } from '@prisma/client';

/** Minimal surface this module needs from a Prisma client OR an interactive transaction. */
export type DigestClient = Pick<PrismaClient, '$queryRaw' | '$queryRawUnsafe' | '$executeRawUnsafe'>;

export const CONTROL_ROW_KEY = Object.freeze({
  sourceModel: '__ScopeBackfillControl',
  sourceId: 'scope-closure/v1',
});

export const REASON_CODES = Object.freeze({
  REQUESTER_AMBIGUOUS: 'scope_requester_ambiguous',
  COMPANY_AMBIGUOUS: 'scope_company_ambiguous',
  REQUESTER_UNMATCHED: 'scope_requester_unmatched',
  COMPANY_UNMATCHED: 'scope_company_unmatched',
  PROJECT_AMBIGUOUS: 'scope_project_ambiguous',
  PROJECT_UNMATCHED: 'scope_project_unmatched',
  REVIEWED_APPLY: 'scope_backfill_reviewed_apply',
  EMPTY_DATABASE: 'scope_backfill_empty_database',
} as const);

export type ScopeClassification = 'resolved' | 'ambiguous' | 'unmatched' | 'already_scoped';

/** Unique array sorted by UTF-16 code-unit order (JS's default string sort already does this). */
export function sortStableIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

export async function sqlJsonDigestHex(client: DigestClient, value: unknown): Promise<string> {
  const text = JSON.stringify(value ?? null);
  const rows = await client.$queryRawUnsafe<{ hash: string }[]>(
    `SELECT encode(public.digest(pg_catalog.convert_to(($1::jsonb)::text,'UTF8'),'sha256'),'hex') AS hash`,
    text,
  );
  const hash = rows[0]?.hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`sqlJsonDigestHex: unexpected digest result ${JSON.stringify(rows)}`);
  }
  return hash;
}

/** Validates a value already produced by SQL's `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` —
 * a pass-through check, not a reformatter, so this module never re-derives the timestamp text. */
export function assertSixFractionUtcTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) {
    throw new Error(`assertSixFractionUtcTimestamp: not a UTC six-fraction timestamp: ${value}`);
  }
  return value;
}

export interface RoleChangeRequestColumn {
  name: string;
  pgType: string;
  value: string | null;
}

export interface RoleChangeRequestRowEnvelope {
  schemaVersion: 1;
  sourceModel: 'RoleChangeRequest';
  columns: RoleChangeRequestColumn[];
}

/** Fixed physical column set of `role_change_requests`, sorted by name COLLATE "C" (equal to
 * plain ASCII sort here since every column name is lowercase snake_case ASCII). */
export const ROLE_CHANGE_REQUEST_COLUMNS = Object.freeze([
  'approved_by',
  'company_id',
  'created_at',
  'from_role',
  'id',
  'requested_by',
  'status',
  'to_role',
  'user_id',
] as const);

export function buildRoleChangeRequestRowEnvelope(
  columnTypes: Record<string, string>,
  values: Record<string, string | null>,
): RoleChangeRequestRowEnvelope {
  const columns: RoleChangeRequestColumn[] = ROLE_CHANGE_REQUEST_COLUMNS.map((name) => {
    const pgType = columnTypes[name];
    if (!pgType) throw new Error(`buildRoleChangeRequestRowEnvelope: missing pg_catalog type for column "${name}"`);
    return { name, pgType, value: values[name] ?? null };
  });
  return { schemaVersion: 1, sourceModel: 'RoleChangeRequest', columns };
}

export interface RequesterKeySets {
  /** users.id rows whose id is byte-equal to requested_by. Normally 0 or 1 (PK). */
  idUserIds: string[];
  /** users.email rows whose email is byte-equal to requested_by. Normally 0 or 1 (unique). */
  emailUserIds: string[];
}

export interface RequesterMatchResult {
  selectedUserId: string | null;
  crossKeyConflict: boolean;
}

/**
 * ID-key wins first; email-key is used only when the ID-key set is empty; both keys resolving to
 * the same user is one match; both keys non-empty and pointing at different users is an
 * immediate cross-key conflict. No trim/case-fold/Unicode-normalization/locale comparison
 * anywhere in this function or its callers — a value that only matches after such a transform
 * must never reach here as a hit.
 */
export function matchRequester(keys: RequesterKeySets): RequesterMatchResult {
  const idIds = sortStableIds(keys.idUserIds);
  const emailIds = sortStableIds(keys.emailUserIds);

  if (idIds.length > 0 && emailIds.length > 0) {
    const union = new Set([...idIds, ...emailIds]);
    if (union.size > 1) {
      return { selectedUserId: null, crossKeyConflict: true };
    }
    return { selectedUserId: idIds[0]!, crossKeyConflict: false };
  }
  if (idIds.length > 0) return { selectedUserId: idIds[0]!, crossKeyConflict: false };
  if (emailIds.length > 0) return { selectedUserId: emailIds[0]!, crossKeyConflict: false };
  return { selectedUserId: null, crossKeyConflict: false };
}

export type RoleChangeCompanyReasonCode =
  | typeof REASON_CODES.REQUESTER_AMBIGUOUS
  | typeof REASON_CODES.COMPANY_AMBIGUOUS
  | typeof REASON_CODES.REQUESTER_UNMATCHED
  | typeof REASON_CODES.COMPANY_UNMATCHED;

export interface RoleChangeScopeFacts {
  requestedByMatch: RequesterKeySets;
  targetUserExists: boolean;
  /** UserCompanyRole.companyId for the selected requester user, filtered to companies whose
   * Company row (and that Company's Tenant) exist. */
  requesterCompanyIds: string[];
  /** UserCompanyRole.companyId for the target user (role_change_requests.user_id), filtered the
   * same way. */
  targetCompanyIds: string[];
  /** true when any raw candidate (before filtering) referenced a Company or Tenant that does
   * not exist. */
  missingParentFacts: boolean;
}

export interface RoleChangeScopeDecision {
  classification: 'resolved' | 'ambiguous' | 'unmatched';
  reasonCode: RoleChangeCompanyReasonCode | null;
  selectedUserId: string | null;
  candidateCompanyIds: string[];
}

/** First-applicable order: cross-key conflict/missing-parent facts -> requester-ambiguous;
 * more than one intersection candidate -> company-ambiguous; no exact key / missing target user
 * / zero membership on either side -> requester-unmatched; empty intersection -> company-unmatched;
 * otherwise resolved. */
export function classifyRoleChangeCompanyScope(facts: RoleChangeScopeFacts): RoleChangeScopeDecision {
  const { selectedUserId, crossKeyConflict } = matchRequester(facts.requestedByMatch);

  if (crossKeyConflict || facts.missingParentFacts) {
    return {
      classification: 'ambiguous',
      reasonCode: REASON_CODES.REQUESTER_AMBIGUOUS,
      selectedUserId,
      candidateCompanyIds: [],
    };
  }

  const candidateCompanyIds = sortStableIds(
    facts.requesterCompanyIds.filter((id) => facts.targetCompanyIds.includes(id)),
  );

  if (candidateCompanyIds.length > 1) {
    return {
      classification: 'ambiguous',
      reasonCode: REASON_CODES.COMPANY_AMBIGUOUS,
      selectedUserId,
      candidateCompanyIds,
    };
  }

  const hasExactKey = facts.requestedByMatch.idUserIds.length > 0 || facts.requestedByMatch.emailUserIds.length > 0;
  const requesterHasMembership = selectedUserId !== null && facts.requesterCompanyIds.length > 0;
  const targetHasMembership = facts.targetCompanyIds.length > 0;

  if (!hasExactKey || !facts.targetUserExists || selectedUserId === null || !requesterHasMembership || !targetHasMembership) {
    return {
      classification: 'unmatched',
      reasonCode: REASON_CODES.REQUESTER_UNMATCHED,
      selectedUserId,
      candidateCompanyIds: [],
    };
  }

  if (candidateCompanyIds.length === 0) {
    return {
      classification: 'unmatched',
      reasonCode: REASON_CODES.COMPANY_UNMATCHED,
      selectedUserId,
      candidateCompanyIds: [],
    };
  }

  return { classification: 'resolved', reasonCode: null, selectedUserId, candidateCompanyIds };
}

export interface RoleChangeCandidateScopeJsonInput {
  decision: RoleChangeScopeDecision;
  targetUserId: string;
  targetCompanyIds: string[];
  requesterCompanyIds: string[];
  sourceFacts: unknown;
}

export function buildRoleChangeCandidateScopeJson(input: RoleChangeCandidateScopeJsonInput) {
  return {
    schemaVersion: 'role-change-company-scope/v1',
    classification: input.decision.classification,
    reasonCode: input.decision.reasonCode,
    requestedByMatch: {
      idUserIds: [] as string[],
      emailUserIds: [] as string[],
      selectedUserId: input.decision.selectedUserId,
    },
    targetUserId: input.targetUserId,
    targetCompanyIds: sortStableIds(input.targetCompanyIds),
    requesterCompanyIds: sortStableIds(input.requesterCompanyIds),
    candidateCompanyIds: input.decision.candidateCompanyIds,
    sourceFacts: input.sourceFacts,
  };
}

export interface ProjectMemberCompanyTuple {
  projectMemberId: string;
  userId: string;
  userCompanyRoleId: string;
  companyId: string;
  tenantId: string;
}

export interface ProjectScopeFacts {
  hasMembers: boolean;
  /** count of distinct ProjectMember rows whose user has zero UserCompanyRole rows. */
  membersWithZeroUcr: number;
  /** distinct companyId values from the join, filtered to companies whose Company row (and that
   * Company's Tenant) exist. */
  candidateCompanyIds: string[];
  /** true when any raw tuple (before filtering) referenced a Company or Tenant that does not
   * exist. */
  missingParentFacts: boolean;
}

export interface ProjectScopeDecision {
  classification: 'resolved' | 'ambiguous' | 'unmatched';
  candidateCompanyIds: string[];
}

/** No members, or a zero-candidate union -> unmatched; more than one company in the union,
 * a missing Company/Tenant parent, or a member with zero membership while another candidate
 * exists -> ambiguous; otherwise resolved. */
export function classifyProjectCompanyScope(facts: ProjectScopeFacts): ProjectScopeDecision {
  const candidateCompanyIds = sortStableIds(facts.candidateCompanyIds);

  if (!facts.hasMembers || candidateCompanyIds.length === 0) {
    return { classification: 'unmatched', candidateCompanyIds: [] };
  }
  if (candidateCompanyIds.length > 1) {
    return { classification: 'ambiguous', candidateCompanyIds };
  }
  if (facts.missingParentFacts) {
    return { classification: 'ambiguous', candidateCompanyIds };
  }
  if (facts.membersWithZeroUcr > 0) {
    return { classification: 'ambiguous', candidateCompanyIds };
  }
  return { classification: 'resolved', candidateCompanyIds };
}

export interface ProjectCandidateScopeJsonInput {
  decision: ProjectScopeDecision;
  sourceFacts: unknown;
}

/** Only for ambiguous/unmatched Project quarantine rows — a `resolved` Project is reviewed and
 * assigned, never quarantined. */
export function buildProjectCandidateScopeJson(input: ProjectCandidateScopeJsonInput) {
  if (input.decision.classification === 'resolved') {
    throw new Error('buildProjectCandidateScopeJson: resolved Projects are never quarantined');
  }
  return {
    schemaVersion: 'project-company-scope/v1',
    classification: input.decision.classification,
    candidateCompanyIds: input.decision.candidateCompanyIds,
    sourceFacts: input.sourceFacts,
  };
}

export function buildProjectResolutionJson(input: {
  companyId: string;
  tenantId: string;
  reviewDigest: string;
  sourceFactsDigest: string;
}) {
  return {
    schemaVersion: 1,
    resolution: 'assigned',
    companyId: input.companyId,
    tenantId: input.tenantId,
    reviewDigest: input.reviewDigest,
    sourceFactsDigest: input.sourceFactsDigest,
  };
}

export interface ProjectManifestFacts {
  sourceModel: 'Project';
  sourceId: string;
  sourceRowHash: string;
  sourceFactsDigest: string;
  classification: 'resolved' | 'ambiguous' | 'unmatched';
  candidateCompanyIds: string[];
}

export type ProjectManifestDecision = 'assign' | 'quarantine';

export interface ProjectManifestEntry extends ProjectManifestFacts {
  decision: ProjectManifestDecision | null;
  selectedCompanyId: string | null;
  reviewerKey: string | null;
  rationale: string | null;
}

export interface ReviewFile {
  schemaVersion: 1;
  reviewerKey: string;
  entries: ProjectManifestEntry[];
  /** The exact RoleChangeRequest ids considered at dry-run time. RoleChangeRequest resolution is
   * fully automatic (no per-row human decision), but apply still needs a FIXED id set — re-querying
   * `WHERE company_id IS NULL` on a rerun would silently shrink as rows resolve/extract, breaking
   * the invariant that a rerun's control-row counts are byte-identical to the first successful run. */
  roleChangeRequestIds: string[];
}

/**
 * Strips reviewer-supplied fields (decision/selectedCompanyId/reviewerKey/rationale) so the
 * dry-run digest and the review-file digest hash the same objective facts: a reviewer's added
 * decisions layer on top without changing the digest, while drift in the underlying facts
 * themselves (a stale/tampered manifest) does change it and is rejected at apply time.
 */
export function manifestFactsProjection(entries: ProjectManifestFacts[]): ProjectManifestFacts[] {
  return [...entries]
    .map((e) => ({
      sourceModel: e.sourceModel,
      sourceId: e.sourceId,
      sourceRowHash: e.sourceRowHash,
      sourceFactsDigest: e.sourceFactsDigest,
      classification: e.classification,
      candidateCompanyIds: sortStableIds(e.candidateCompanyIds),
    }))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
}

export async function computeManifestDigest(client: DigestClient, entries: ProjectManifestFacts[]): Promise<string> {
  return sqlJsonDigestHex(client, manifestFactsProjection(entries));
}

export function validateManifestEntryDecision(entry: ProjectManifestEntry): { ok: boolean; reason?: string } {
  if (entry.decision === 'assign') {
    if (!entry.selectedCompanyId) return { ok: false, reason: 'assign requires selectedCompanyId' };
    if (!entry.reviewerKey || entry.reviewerKey.trim().length === 0) return { ok: false, reason: 'assign requires non-empty reviewerKey' };
    if (!entry.rationale || entry.rationale.trim().length === 0) return { ok: false, reason: 'assign requires non-empty rationale' };
    return { ok: true };
  }
  if (entry.decision === 'quarantine') {
    if (entry.selectedCompanyId !== null) return { ok: false, reason: 'quarantine requires selectedCompanyId=null' };
    return { ok: true };
  }
  return { ok: false, reason: 'decision must be "assign" or "quarantine"' };
}

export interface ScopeBackfillCounts {
  source: number;
  resolved: number;
  extracted: number;
  quarantined: number;
  alreadyScoped: number;
}

export interface ScopeBackfillConservation {
  before: number;
  liveAfter: number;
  extracted: number;
}

export function buildReviewedApplyControlSourceRowJson(input: {
  reviewDigest: string;
  sourceFactsDigest: string;
  counts: ScopeBackfillCounts;
}) {
  return {
    schemaVersion: 1,
    kind: 'scope-backfill-control',
    mode: 'reviewed_apply',
    reviewDigest: input.reviewDigest,
    sourceFactsDigest: input.sourceFactsDigest,
    counts: input.counts,
  };
}

export function buildReviewedApplyControlResolutionJson(input: {
  reviewDigest: string;
  sourceFactsDigest: string;
  sourceRowHash: string;
  conservation: ScopeBackfillConservation;
  changedCount: number;
}) {
  return {
    schemaVersion: 1,
    applyState: 'completed',
    reviewDigest: input.reviewDigest,
    sourceFactsDigest: input.sourceFactsDigest,
    sourceRowHash: input.sourceRowHash,
    conservation: input.conservation,
    changedCount: input.changedCount,
  };
}

export function buildEmptyDatabaseControlSourceRowJson(input: { reviewDigest: string; sourceFactsDigest: string }) {
  return {
    schemaVersion: 1,
    kind: 'scope-backfill-control',
    mode: 'empty_database',
    reviewDigest: input.reviewDigest,
    sourceFactsDigest: input.sourceFactsDigest,
    counts: { source: 0, resolved: 0, extracted: 0, quarantined: 0, alreadyScoped: 0 },
  };
}

/** Deep structural equality over JSON-plain values, used to decide "byte-identical rerun" vs
 * "conflicting pre-existing control row". */
export function deepJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepJsonEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => k === bKeys[i] && deepJsonEqual((a as any)[k], (b as any)[k]));
}

export type ControlRowOutcome = 'insert' | 'identical_noop' | 'conflict';

/** Compares a candidate control-row payload (what this apply run would write) against an
 * existing row read back from the table, keyed on (sourceModel,sourceId). No existing row ->
 * insert; byte-identical existing row -> idempotent no-op; anything else (different mode,
 * digest, counts, or a hand-inserted/tampered row) -> conflict, and callers must never overwrite
 * it. */
export function decideControlRowOutcome(
  existing: { sourceRowJson: unknown; reasonCode: string; candidateScopeJson: unknown } | null,
  candidate: { sourceRowJson: unknown; reasonCode: string; candidateScopeJson: unknown },
): ControlRowOutcome {
  if (!existing) return 'insert';
  if (
    existing.reasonCode === candidate.reasonCode &&
    deepJsonEqual(existing.sourceRowJson, candidate.sourceRowJson) &&
    deepJsonEqual(existing.candidateScopeJson, candidate.candidateScopeJson)
  ) {
    return 'identical_noop';
  }
  return 'conflict';
}

export interface RowEnvelopeRoundTripCheck {
  ok: boolean;
  mismatches: string[];
}

/** Compares a just-built row envelope's column values against a fresh live read of the same
 * columns (both text-formatted the identical way). Any mismatch means either the row changed
 * concurrently between snapshot and verification, or the envelope did not round-trip losslessly
 * — either way extraction must abort with zero source deletion. */
export function verifyRoleChangeRequestRowEnvelopeRoundTrip(
  envelope: RoleChangeRequestRowEnvelope,
  liveValues: Record<string, string | null>,
): RowEnvelopeRoundTripCheck {
  const mismatches: string[] = [];
  for (const column of envelope.columns) {
    const live = liveValues[column.name];
    const liveNormalized = live === undefined ? null : live;
    if (column.value !== liveNormalized) {
      mismatches.push(column.name);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export type ProjectApplyOutcome = 'assigned' | 'already_consistent' | 'conflict' | 'stale_manifest';

export interface ProjectApplyDecisionInput {
  currentCompanyId: string | null;
  reviewedCompanyId: string;
  liveSourceRowHash: string;
  reviewedSourceRowHash: string;
  liveSourceFactsDigest: string;
  reviewedSourceFactsDigest: string;
}

/** CAS decision for one reviewed Project row at apply time: any drift in the re-hashed row or
 * candidate facts since dry-run is `stale_manifest` (reject, zero writes for this row); a
 * concurrently-set company_id equal to the reviewed value is `already_consistent` (idempotent
 * success, no overwrite); a concurrently-set DIFFERENT company_id is `conflict` (never
 * overwritten); otherwise the row is `assigned`. */
export function decideProjectApplyOutcome(input: ProjectApplyDecisionInput): ProjectApplyOutcome {
  if (
    input.liveSourceRowHash !== input.reviewedSourceRowHash ||
    input.liveSourceFactsDigest !== input.reviewedSourceFactsDigest
  ) {
    return 'stale_manifest';
  }
  if (input.currentCompanyId === null) return 'assigned';
  if (input.currentCompanyId === input.reviewedCompanyId) return 'already_consistent';
  return 'conflict';
}

/** Refuses any DATABASE_URL whose host is not an explicit loopback address — the package
 * adapter must never touch a caller-supplied remote database. */
export function assertLoopbackDatabaseUrl(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(`assertLoopbackDatabaseUrl: not a valid URL: ${databaseUrl}`);
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error(`assertLoopbackDatabaseUrl: refusing non-loopback host "${url.hostname}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DB-touching fact fetchers (byte-exact raw SQL; feed the pure classifiers above)
// ─────────────────────────────────────────────────────────────────────────

export async function fetchRoleChangeRequestColumnTypes(client: DigestClient): Promise<Record<string, string>> {
  const rows = await client.$queryRawUnsafe<{ name: string; pg_type: string }[]>(
    `SELECT a.attname AS name, t.typname AS pg_type
     FROM pg_attribute a
     JOIN pg_type t ON t.oid = a.atttypid
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'role_change_requests' AND n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.name] = row.pg_type;
  return out;
}

export interface RoleChangeRequestLiveRow {
  id: string;
  user_id: string;
  from_role: string;
  to_role: string;
  status: string;
  requested_by: string;
  approved_by: string | null;
  company_id: string | null;
  created_at: string;
}

/** Locks the row FOR UPDATE and returns every physical column as lossless text (timestamps
 * formatted UTC with six fractional digits via SQL `to_char`, never JS Date formatting). */
export async function fetchRoleChangeRequestLiveRow(
  client: DigestClient,
  id: string,
): Promise<RoleChangeRequestLiveRow | null> {
  const rows = await client.$queryRawUnsafe<RoleChangeRequestLiveRow[]>(
    `SELECT
       r.id::text AS id,
       r.user_id::text AS user_id,
       r.from_role::text AS from_role,
       r.to_role::text AS to_role,
       r.status::text AS status,
       r.requested_by::text AS requested_by,
       r.approved_by::text AS approved_by,
       r.company_id::text AS company_id,
       to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM role_change_requests r
     WHERE r.id = $1
     FOR UPDATE`,
    id,
  );
  return rows[0] ?? null;
}

export async function fetchRequesterKeySets(client: DigestClient, requestedByRaw: string): Promise<RequesterKeySets> {
  const [idRows, emailRows] = await Promise.all([
    client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM users WHERE convert_to(id,'UTF8') = convert_to($1,'UTF8')`,
      requestedByRaw,
    ),
    client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM users WHERE convert_to(email,'UTF8') = convert_to($1,'UTF8')`,
      requestedByRaw,
    ),
  ]);
  return { idUserIds: idRows.map((r) => r.id), emailUserIds: emailRows.map((r) => r.id) };
}

export async function fetchUserExists(client: DigestClient, userId: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1) AS exists`,
    userId,
  );
  return rows[0]?.exists === true;
}

export interface UserCompanyMembershipFacts {
  companyIds: string[];
  missingParentFacts: boolean;
}

/** UserCompanyRole.companyId for `userId`, filtered to companies whose Company row (and that
 * Company's Tenant) exist; `missingParentFacts` is true when any raw membership referenced a
 * Company or Tenant that does not exist. */
export async function fetchUserCompanyMembership(client: DigestClient, userId: string): Promise<UserCompanyMembershipFacts> {
  const rows = await client.$queryRawUnsafe<{ company_id: string; company_missing: boolean; tenant_missing: boolean }[]>(
    `SELECT ucr.company_id AS company_id,
            (c.id IS NULL) AS company_missing,
            (c.id IS NOT NULL AND t.id IS NULL) AS tenant_missing
     FROM user_company_roles ucr
     LEFT JOIN companies c ON c.id = ucr.company_id
     LEFT JOIN tenants t ON t.id = c.tenant_id
     WHERE ucr.user_id = $1`,
    userId,
  );
  const missingParentFacts = rows.some((r) => r.company_missing || r.tenant_missing);
  const companyIds = sortStableIds(rows.filter((r) => !r.company_missing && !r.tenant_missing).map((r) => r.company_id));
  return { companyIds, missingParentFacts };
}

/** Fetches every fact `classifyRoleChangeCompanyScope` needs for one RoleChangeRequest row. */
export async function fetchRoleChangeScopeFacts(
  client: DigestClient,
  row: Pick<RoleChangeRequestLiveRow, 'user_id' | 'requested_by'>,
): Promise<RoleChangeScopeFacts> {
  const requestedByMatch = await fetchRequesterKeySets(client, row.requested_by);
  const { selectedUserId } = matchRequester(requestedByMatch);
  const targetUserExists = await fetchUserExists(client, row.user_id);

  const [requester, target] = await Promise.all([
    selectedUserId ? fetchUserCompanyMembership(client, selectedUserId) : Promise.resolve({ companyIds: [] as string[], missingParentFacts: false }),
    fetchUserCompanyMembership(client, row.user_id),
  ]);

  return {
    requestedByMatch,
    targetUserExists,
    requesterCompanyIds: requester.companyIds,
    targetCompanyIds: target.companyIds,
    missingParentFacts: requester.missingParentFacts || target.missingParentFacts,
  };
}

export interface ProjectMemberRawRow {
  project_member_id: string;
  user_id: string;
  user_company_role_id: string | null;
  company_id: string | null;
  tenant_id: string | null;
  company_missing: boolean;
  tenant_missing: boolean;
}

/** Fetches every fact `classifyProjectCompanyScope` needs for one Project, plus the canonical
 * bytewise-sorted source-fact tuples used for `sourceFactsDigest`. */
export async function fetchProjectScopeFacts(
  client: DigestClient,
  projectId: string,
): Promise<{ facts: ProjectScopeFacts; tuples: ProjectMemberCompanyTuple[] }> {
  const rows = await client.$queryRawUnsafe<ProjectMemberRawRow[]>(
    `SELECT
       pm.id AS project_member_id,
       pm.user_id AS user_id,
       ucr.id AS user_company_role_id,
       ucr.company_id AS company_id,
       c.tenant_id AS tenant_id,
       (ucr.id IS NOT NULL AND c.id IS NULL) AS company_missing,
       (ucr.id IS NOT NULL AND c.id IS NOT NULL AND t.id IS NULL) AS tenant_missing
     FROM project_members pm
     LEFT JOIN user_company_roles ucr ON ucr.user_id = pm.user_id
     LEFT JOIN companies c ON c.id = ucr.company_id
     LEFT JOIN tenants t ON t.id = c.tenant_id
     WHERE pm.project_id = $1
     ORDER BY pm.id, ucr.id`,
    projectId,
  );

  const hasMembers = rows.length > 0;
  const byMember = new Map<string, ProjectMemberRawRow[]>();
  for (const row of rows) {
    const list = byMember.get(row.project_member_id) ?? [];
    list.push(row);
    byMember.set(row.project_member_id, list);
  }
  const membersWithZeroUcr = [...byMember.values()].filter((list) => list.every((r) => r.user_company_role_id === null)).length;
  const missingParentFacts = rows.some((r) => r.company_missing || r.tenant_missing);

  const validRows = rows.filter((r) => r.user_company_role_id !== null && !r.company_missing && !r.tenant_missing);
  const tuples: ProjectMemberCompanyTuple[] = validRows
    .map((r) => ({
      projectMemberId: r.project_member_id,
      userId: r.user_id,
      userCompanyRoleId: r.user_company_role_id as string,
      companyId: r.company_id as string,
      tenantId: r.tenant_id as string,
    }))
    .sort((a, b) => {
      const ka = `${a.projectMemberId}|${a.userCompanyRoleId}`;
      const kb = `${b.projectMemberId}|${b.userCompanyRoleId}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const candidateCompanyIds = sortStableIds(tuples.map((t) => t.companyId));

  return {
    facts: { hasMembers, membersWithZeroUcr, candidateCompanyIds, missingParentFacts },
    tuples,
  };
}

export interface ProjectLiveRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_COLUMNS = Object.freeze([
  'company_id',
  'created_at',
  'description',
  'id',
  'name',
  'slug',
  'updated_at',
] as const);

export interface ProjectColumn {
  name: string;
  pgType: string;
  value: string | null;
}

export interface ProjectRowEnvelope {
  schemaVersion: 1;
  sourceModel: 'Project';
  columns: ProjectColumn[];
}

export async function fetchProjectColumnTypes(client: DigestClient): Promise<Record<string, string>> {
  const rows = await client.$queryRawUnsafe<{ name: string; pg_type: string }[]>(
    `SELECT a.attname AS name, t.typname AS pg_type
     FROM pg_attribute a
     JOIN pg_type t ON t.oid = a.atttypid
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'projects' AND n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.name] = row.pg_type;
  return out;
}

/** Locks the row FOR UPDATE and returns every physical column as lossless text, the same
 * envelope discipline as `fetchRoleChangeRequestLiveRow` — used at apply time to re-hash and
 * detect drift, never to extract/delete (Project rows are never extracted). */
export async function fetchProjectLiveRow(client: DigestClient, id: string): Promise<ProjectLiveRow | null> {
  const rows = await client.$queryRawUnsafe<ProjectLiveRow[]>(
    `SELECT
       p.id::text AS id,
       p.slug::text AS slug,
       p.name::text AS name,
       p.description::text AS description,
       p.company_id::text AS company_id,
       to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
       to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM projects p
     WHERE p.id = $1
     FOR UPDATE`,
    id,
  );
  return rows[0] ?? null;
}

export function buildProjectRowEnvelope(
  columnTypes: Record<string, string>,
  values: Record<string, string | null>,
): ProjectRowEnvelope {
  const columns: ProjectColumn[] = PROJECT_COLUMNS.map((name) => {
    const pgType = columnTypes[name];
    if (!pgType) throw new Error(`buildProjectRowEnvelope: missing pg_catalog type for column "${name}"`);
    return { name, pgType, value: values[name] ?? null };
  });
  return { schemaVersion: 1, sourceModel: 'Project', columns };
}
