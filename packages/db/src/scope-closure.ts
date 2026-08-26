/**
 * U012 — validate U011 scope-backfill closure and prove the additive constraints that make an
 * unscoped/cross-hierarchy root un-reintroducible.
 *
 * Same pure/DB-touching split as `scope-backfill.ts`:
 *   - Pure functions here take already-fetched facts and return a verdict; exhaustively
 *     unit-tested in `scope-closure.test.ts` with no Postgres required.
 *   - Thin DB-touching functions fetch facts via raw SQL (never a Prisma relation that could
 *     silently coerce/normalize) and delegate to the pure functions; exercised by
 *     `scope-closure.integration.test.ts` and `scripts/run-db-contract.ts`.
 *
 * The migration `20260715120000_scope_closure_constraints/migration.sql` re-implements the
 * control-row verification in raw SQL (a migration cannot call into this module) — `verifyControlRow`
 * below is the same contract expressed in TypeScript for `scripts/validate-scope-closure.ts` and
 * the test suites, not a delegate the migration calls at runtime.
 */
import type { PrismaClient } from '@prisma/client';

import {
  CONTROL_ROW_KEY,
  REASON_CODES,
  manifestFactsProjection,
  type DigestClient,
  type ProjectManifestFacts,
} from './scope-backfill';
import {
  buildScopeInventoryReport,
  deriveStructuralMismatches,
  expectedCategoryCounts,
  expectedCurrentModelCount,
  validateChildViaFkEntries,
  type DmmfRelationField,
  type ScopeInventoryEntry,
  type ScopeInventoryError,
  type ScopeInventoryReport,
} from './scope-inventory';

export type { DigestClient };

const HEX64_RE = /^[0-9a-f]{64}$/;

export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64_RE.test(value);
}

type ClosureBlockerCode =
  | 'INVENTORY_MISMATCH'
  | 'CONTROL_ROW_MISSING'
  | 'CONTROL_ROW_MALFORMED'
  | 'CONTROL_ROW_HAND_INSERTED'
  | 'CONTROL_ROW_DIGEST_NOT_HEX64'
  | 'CONTROL_ROW_HASH_MISMATCH'
  | 'CONTROL_ROW_FIELDS_DISAGREE'
  | 'CONTROL_ROW_CONSERVATION_VIOLATED'
  | 'CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY'
  | 'CONTROL_ROW_REVIEW_DIGEST_TAMPERED'
  | 'PROJECT_UNMAPPED'
  | 'PROJECT_CANDIDATE_FACTS_MALFORMED'
  | 'PROJECT_UNREVIEWED_OVERRIDE'
  | 'PROJECT_SOURCE_FACTS_TAMPERED'
  | 'COMPANY_TENANT_ORPHAN'
  | 'CHILD_FK_NULL'
  | 'QUARANTINE_STALE'
  | 'ROLE_CHANGE_REQUEST_LIVE_NULL_COMPANY'
  | 'ROLE_CHANGE_REQUEST_UNREPRESENTED_SOURCE'
  | 'ROLE_CHANGE_REQUEST_EXTRACTION_MISMATCH';

interface ClosureBlocker {
  code: ClosureBlockerCode;
  message: string;
  sourceId?: string;
}

function blockersOk(blockers: ClosureBlocker[]): boolean {
  return blockers.length === 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Control row verification — mirrors the migration.sql DO block's checks
// ─────────────────────────────────────────────────────────────────────────

type ControlRowMode = 'reviewed_apply' | 'empty_database';

export interface RawControlRow {
  id: string;
  sourceModel: string;
  sourceId: string;
  reasonCode: string;
  sourceRowJson: unknown;
  sourceRowHash: string;
  candidateScopeJson: unknown;
  reviewDigest: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionJson: unknown;
}

const KNOWN_CONTROL_ROW_IDS = new Set([
  'scope-backfill-control-reviewed-apply',
  'scope-backfill-control-empty-database',
]);

export interface ControlRowVerificationInput {
  row: RawControlRow | null;
  /** `digest(sourceRowJson)` recomputed fresh from the live row by the caller (SQL side); `null`
   * when `row` is `null` (nothing to recompute) or the caller chooses not to re-hash. */
  recomputedSourceRowHash: string | null;
  /** `digest(manifestFactsProjection(candidateScopeJson))` recomputed fresh by the caller for
   * `reviewed_apply` rows (the same projection `computeManifestDigest` applies at apply time);
   * `null` for `empty_database` rows or when the caller chooses not to re-derive it. */
  recomputedReviewDigest: string | null;
  liveProjectsCount: number;
  liveRoleChangeRequestsCount: number;
}

interface ControlRowVerificationResult {
  ok: boolean;
  mode: ControlRowMode | null;
  blockers: ClosureBlocker[];
}

/**
 * Validates one U011 control row against the exact rules the migration itself enforces: the row
 * must exist at `CONTROL_ROW_KEY`, use a known apply id, carry a well-formed `sourceRowJson` in
 * one of the two known modes, have both digests as 64 lowercase hex, have its stored
 * `sourceRowHash`/`reviewDigest` agree with a fresh recompute, have `resolutionJson` agree with
 * `sourceRowJson` field-for-field, satisfy `before = liveAfter + extracted`, and — for
 * `empty_database` — have both source tables still physically empty. Missing, malformed, stale,
 * hand-inserted, or empty-mode-on-nonempty state is reported as one or more blockers rather than
 * thrown, so callers (the TS validator script and the integration/contract tests) can render the
 * full picture instead of stopping at the first problem.
 */
export function verifyControlRow(input: ControlRowVerificationInput): ControlRowVerificationResult {
  const { row } = input;
  if (!row) {
    return {
      ok: false,
      mode: null,
      blockers: [
        {
          code: 'CONTROL_ROW_MISSING',
          message: `no U011 control row found at (${CONTROL_ROW_KEY.sourceModel}, ${CONTROL_ROW_KEY.sourceId})`,
        },
      ],
    };
  }

  const blockers: ClosureBlocker[] = [];

  if (row.sourceModel !== CONTROL_ROW_KEY.sourceModel || row.sourceId !== CONTROL_ROW_KEY.sourceId) {
    blockers.push({
      code: 'CONTROL_ROW_HAND_INSERTED',
      message: `control row key (${row.sourceModel}, ${row.sourceId}) does not match the fixed U011 key`,
    });
  }
  if (!KNOWN_CONTROL_ROW_IDS.has(row.id)) {
    blockers.push({ code: 'CONTROL_ROW_HAND_INSERTED', message: `control row id "${row.id}" is not a known U011 apply id` });
  }

  const srj = row.sourceRowJson as
    | { schemaVersion?: unknown; kind?: unknown; mode?: unknown; reviewDigest?: unknown; sourceFactsDigest?: unknown; counts?: unknown }
    | null
    | undefined;
  const modeCandidate = srj && typeof srj === 'object' ? srj.mode : undefined;
  const wellFormedEnvelope =
    !!srj &&
    typeof srj === 'object' &&
    srj.schemaVersion === 1 &&
    srj.kind === 'scope-backfill-control' &&
    (modeCandidate === 'reviewed_apply' || modeCandidate === 'empty_database') &&
    typeof srj.reviewDigest === 'string' &&
    typeof srj.sourceFactsDigest === 'string' &&
    typeof srj.counts === 'object' &&
    srj.counts !== null;

  if (!wellFormedEnvelope) {
    blockers.push({ code: 'CONTROL_ROW_MALFORMED', message: 'sourceRowJson is missing required scope-backfill-control fields' });
    return { ok: false, mode: null, blockers };
  }

  const mode = modeCandidate as ControlRowMode;
  const expectedReasonCode = mode === 'reviewed_apply' ? REASON_CODES.REVIEWED_APPLY : REASON_CODES.EMPTY_DATABASE;
  if (row.reasonCode !== expectedReasonCode) {
    blockers.push({ code: 'CONTROL_ROW_FIELDS_DISAGREE', message: `reasonCode "${row.reasonCode}" does not match sourceRowJson.mode "${mode}"` });
  }

  const reviewDigest = srj!.reviewDigest as string;
  const sourceFactsDigest = srj!.sourceFactsDigest as string;
  if (!isHex64(reviewDigest)) blockers.push({ code: 'CONTROL_ROW_DIGEST_NOT_HEX64', message: 'sourceRowJson.reviewDigest is not 64 lowercase hex' });
  if (!isHex64(sourceFactsDigest)) blockers.push({ code: 'CONTROL_ROW_DIGEST_NOT_HEX64', message: 'sourceRowJson.sourceFactsDigest is not 64 lowercase hex' });
  if (!isHex64(row.sourceRowHash)) blockers.push({ code: 'CONTROL_ROW_DIGEST_NOT_HEX64', message: 'sourceRowHash column is not 64 lowercase hex' });

  if (input.recomputedSourceRowHash !== null && input.recomputedSourceRowHash !== row.sourceRowHash) {
    blockers.push({
      code: 'CONTROL_ROW_HASH_MISMATCH',
      message: `recomputed sourceRowHash ${input.recomputedSourceRowHash} does not equal stored ${row.sourceRowHash}`,
    });
  }

  if (row.reviewDigest !== reviewDigest) {
    blockers.push({ code: 'CONTROL_ROW_FIELDS_DISAGREE', message: 'top-level reviewDigest column disagrees with sourceRowJson.reviewDigest' });
  }
  if (
    input.recomputedReviewDigest !== null &&
    mode === 'reviewed_apply' &&
    input.recomputedReviewDigest !== reviewDigest
  ) {
    blockers.push({
      code: 'CONTROL_ROW_REVIEW_DIGEST_TAMPERED',
      message: `recomputed reviewDigest over candidateScopeJson (${input.recomputedReviewDigest}) does not equal sourceRowJson.reviewDigest (${reviewDigest})`,
    });
  }

  const resJson = row.resolutionJson as
    | { applyState?: unknown; reviewDigest?: unknown; sourceFactsDigest?: unknown; sourceRowHash?: unknown; conservation?: unknown }
    | null
    | undefined;
  const conservation = resJson && typeof resJson === 'object' ? (resJson.conservation as { before?: unknown; liveAfter?: unknown; extracted?: unknown } | undefined) : undefined;
  const resolutionWellFormed =
    !!resJson &&
    typeof resJson === 'object' &&
    resJson.applyState === 'completed' &&
    resJson.reviewDigest === reviewDigest &&
    resJson.sourceFactsDigest === sourceFactsDigest &&
    resJson.sourceRowHash === row.sourceRowHash &&
    !!conservation &&
    typeof conservation === 'object';

  if (!resolutionWellFormed) {
    blockers.push({ code: 'CONTROL_ROW_FIELDS_DISAGREE', message: 'resolutionJson is missing fields or disagrees with sourceRowJson/sourceRowHash' });
  } else {
    const before = conservation!.before;
    const liveAfter = conservation!.liveAfter;
    const extracted = conservation!.extracted;
    if (typeof before !== 'number' || typeof liveAfter !== 'number' || typeof extracted !== 'number' || before !== liveAfter + extracted) {
      blockers.push({
        code: 'CONTROL_ROW_CONSERVATION_VIOLATED',
        message: `resolutionJson.conservation before=${String(before)} liveAfter=${String(liveAfter)} extracted=${String(extracted)} (expected before === liveAfter + extracted)`,
      });
    }
  }

  if (mode === 'empty_database') {
    if (input.liveProjectsCount !== 0 || input.liveRoleChangeRequestsCount !== 0) {
      blockers.push({
        code: 'CONTROL_ROW_EMPTY_MODE_ON_NONEMPTY',
        message: `empty_database control row present but projects=${input.liveProjectsCount} role_change_requests=${input.liveRoleChangeRequestsCount} (both must be 0)`,
      });
    }
    if (!Array.isArray(row.candidateScopeJson) || (row.candidateScopeJson as unknown[]).length !== 0) {
      blockers.push({ code: 'CONTROL_ROW_MALFORMED', message: 'empty_database candidateScopeJson must be an empty array' });
    }
  }

  if (row.resolvedAt === null || row.resolvedBy === null || row.resolvedBy.trim().length === 0) {
    blockers.push({ code: 'CONTROL_ROW_MALFORMED', message: 'control row missing resolvedAt/resolvedBy provenance' });
  }

  return { ok: blockersOk(blockers), mode: blockers.some((b) => b.code === 'CONTROL_ROW_MALFORMED') ? null : mode, blockers };
}

// ─────────────────────────────────────────────────────────────────────────
// Project closure — every reviewed-null Project accounted for; every set
// company_id backed by the exact reviewed decision, never a silent override.
// ─────────────────────────────────────────────────────────────────────────

export interface ProjectClosureRow {
  id: string;
  companyId: string | null;
}

export interface ManifestEntryFacts {
  sourceId: string;
  classification: string;
  candidateCompanyIds: string[];
  decision: string | null;
  selectedCompanyId: string | null;
  reviewerKey: string | null;
}

export interface QuarantineRowFacts {
  sourceModel: string;
  sourceId: string;
  reasonCode: string;
  resolvedAt: string | null;
  candidateScopeJson: unknown;
}

function isWellFormedProjectCandidateScopeJson(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as { schemaVersion?: unknown; classification?: unknown; candidateCompanyIds?: unknown; sourceFacts?: unknown };
  return (
    v.schemaVersion === 'project-company-scope/v1' &&
    (v.classification === 'ambiguous' || v.classification === 'unmatched') &&
    Array.isArray(v.candidateCompanyIds) &&
    v.sourceFacts !== undefined
  );
}

/**
 * Verifies every live Project against the exact U011 reviewed-source-facts contract: a Project
 * still `company_id IS NULL` must have a manifest entry (it was actually reviewed, not silently
 * missed) backed by a well-formed quarantine row; a Project with `company_id` set that WAS in the
 * originally-null reviewed set must match an `assign` manifest entry with the same
 * `selectedCompanyId` and a non-empty `reviewerKey` (never an unreviewed override). A Project
 * absent from the manifest entirely (never null at review time) needs no entry.
 */
export function verifyProjectClosure(
  projects: ProjectClosureRow[],
  manifestEntries: ManifestEntryFacts[] | null,
  quarantineRows: QuarantineRowFacts[],
): ClosureBlocker[] {
  const blockers: ClosureBlocker[] = [];
  const manifestBySourceId = new Map((manifestEntries ?? []).map((e) => [e.sourceId, e]));
  const quarantineBySourceId = new Map(
    quarantineRows.filter((q) => q.sourceModel === 'Project').map((q) => [q.sourceId, q]),
  );

  for (const project of projects) {
    const entry = manifestBySourceId.get(project.id);

    if (project.companyId === null) {
      if (!entry) {
        blockers.push({ code: 'PROJECT_UNMAPPED', message: `Project ${project.id} has no company and no U011 manifest entry`, sourceId: project.id });
        continue;
      }
      if (entry.decision !== 'quarantine') {
        blockers.push({
          code: 'PROJECT_UNMAPPED',
          message: `Project ${project.id} is still unscoped but its manifest decision is "${String(entry.decision)}", not "quarantine"`,
          sourceId: project.id,
        });
        continue;
      }
      const quarantine = quarantineBySourceId.get(project.id);
      if (!quarantine || !isWellFormedProjectCandidateScopeJson(quarantine.candidateScopeJson)) {
        blockers.push({
          code: 'PROJECT_CANDIDATE_FACTS_MALFORMED',
          message: `Project ${project.id} quarantine row is missing or has malformed candidateScopeJson`,
          sourceId: project.id,
        });
      }
      continue;
    }

    if (!entry) continue; // never null at review time — resolved from creation, no manifest entry required.

    const consistent =
      entry.decision === 'assign' &&
      entry.selectedCompanyId === project.companyId &&
      typeof entry.reviewerKey === 'string' &&
      entry.reviewerKey.trim().length > 0;
    if (!consistent) {
      blockers.push({
        code: 'PROJECT_UNREVIEWED_OVERRIDE',
        message: `Project ${project.id} has company_id=${project.companyId} but its manifest entry (decision=${String(entry.decision)}, selectedCompanyId=${String(entry.selectedCompanyId)}) does not attest it`,
        sourceId: project.id,
      });
    }
  }

  return blockers;
}

interface ProjectFreshnessCheck {
  sourceId: string;
  liveSourceRowHash: string;
  liveSourceFactsDigest: string;
}

/**
 * Detects a tampered/drifted `candidateScopeJson` manifest entry: for an `assign` decision, the
 * entry's recorded `sourceRowHash`/`sourceFactsDigest` must equal a fresh live recompute (the
 * caller reruns the exact U011 hashing functions against the current row/facts). A mismatch means
 * either the manifest was hand-edited after apply, or the row changed through some path outside
 * the reviewed contract.
 */
export function verifyProjectSourceFactsFreshness(
  entries: ManifestEntryFacts[],
  entriesWithHashes: Array<ManifestEntryFacts & { sourceRowHash: string; sourceFactsDigest: string }>,
  fresh: ProjectFreshnessCheck[],
): ClosureBlocker[] {
  const blockers: ClosureBlocker[] = [];
  const freshById = new Map(fresh.map((f) => [f.sourceId, f]));
  for (const entry of entriesWithHashes) {
    if (entry.decision !== 'assign') continue;
    const live = freshById.get(entry.sourceId);
    if (!live) continue;
    if (live.liveSourceRowHash !== entry.sourceRowHash || live.liveSourceFactsDigest !== entry.sourceFactsDigest) {
      blockers.push({
        code: 'PROJECT_SOURCE_FACTS_TAMPERED',
        message: `Project ${entry.sourceId} manifest sourceRowHash/sourceFactsDigest does not match a fresh live recompute`,
        sourceId: entry.sourceId,
      });
    }
  }
  void entries;
  return blockers;
}

// ─────────────────────────────────────────────────────────────────────────
// RoleChangeRequest closure — zero live nulls, exact conservation, no stale
// quarantine (a quarantine row whose source is somehow still live).
// ─────────────────────────────────────────────────────────────────────────

export interface RoleChangeClosureInput {
  liveNullCompanyCount: number;
  liveTotalCount: number;
  quarantineExtractedCount: number;
  staleQuarantineLiveOverlapCount: number;
  conservation: { before: number; liveAfter: number; extracted: number } | null;
}

/**
 * Verifies the exact preconditions the migration checks before `SET NOT NULL role_change_requests
 * .company_id`: zero rows still `company_id IS NULL`, zero "stale" quarantine rows (a
 * `sourceModel='RoleChangeRequest'` quarantine record whose `source_id` is somehow still a live
 * row — extraction and quarantine must be mutually exclusive), and — when a control row's
 * conservation numbers are available — the live table's total row count and the quarantine
 * extraction count each reconcile exactly against `liveAfter`/`extracted`.
 */
export function verifyRoleChangeRequestClosure(input: RoleChangeClosureInput): ClosureBlocker[] {
  const blockers: ClosureBlocker[] = [];
  if (input.liveNullCompanyCount !== 0) {
    blockers.push({
      code: 'ROLE_CHANGE_REQUEST_LIVE_NULL_COMPANY',
      message: `${input.liveNullCompanyCount} live role_change_requests row(s) still have company_id IS NULL`,
    });
  }
  if (input.staleQuarantineLiveOverlapCount !== 0) {
    blockers.push({
      code: 'QUARANTINE_STALE',
      message: `${input.staleQuarantineLiveOverlapCount} scope_backfill_quarantine row(s) for RoleChangeRequest reference a source_id that is still a live role_change_requests row`,
    });
  }
  if (input.conservation) {
    if (input.liveTotalCount !== input.conservation.liveAfter) {
      blockers.push({
        code: 'ROLE_CHANGE_REQUEST_UNREPRESENTED_SOURCE',
        message: `live role_change_requests count ${input.liveTotalCount} does not equal control row conservation.liveAfter ${input.conservation.liveAfter}`,
      });
    }
    if (input.quarantineExtractedCount !== input.conservation.extracted) {
      blockers.push({
        code: 'ROLE_CHANGE_REQUEST_EXTRACTION_MISMATCH',
        message: `quarantined RoleChangeRequest count ${input.quarantineExtractedCount} does not equal control row conservation.extracted ${input.conservation.extracted}`,
      });
    }
  }
  return blockers;
}

// ─────────────────────────────────────────────────────────────────────────
// Company -> Tenant integrity
// ─────────────────────────────────────────────────────────────────────────

export interface CompanyTenantRow {
  companyId: string;
  tenantId: string;
  tenantExists: boolean;
}

export function verifyCompanyTenantIntegrity(rows: CompanyTenantRow[]): ClosureBlocker[] {
  return rows
    .filter((r) => !r.tenantExists)
    .map((r) => ({
      code: 'COMPANY_TENANT_ORPHAN' as const,
      message: `Company ${r.companyId} references tenant ${r.tenantId} which does not exist`,
      sourceId: r.companyId,
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// Combined closure report
// ─────────────────────────────────────────────────────────────────────────

export interface ClosureFacts {
  currentModelNames: string[];
  inventoryEntries: ScopeInventoryEntry[];
  dmmfRelations: DmmfRelationField[];
  controlRow: ControlRowVerificationInput;
  projects: ProjectClosureRow[];
  manifestEntries: ManifestEntryFacts[] | null;
  quarantineRows: QuarantineRowFacts[];
  companyTenantRows: CompanyTenantRow[];
  roleChangeRequest: RoleChangeClosureInput;
}

interface ClosureReport {
  ok: boolean;
  inventory: ScopeInventoryReport;
  childFkErrors: ScopeInventoryError[];
  structuralErrors: ScopeInventoryError[];
  controlRow: ControlRowVerificationResult;
  blockers: ClosureBlocker[];
}

function inventoryErrorToBlocker(e: ScopeInventoryError): ClosureBlocker {
  return { code: 'INVENTORY_MISMATCH', message: `[${e.code}] ${e.message}`, sourceId: e.model };
}

/**
 * Composes every closure check into one report: the U010 inventory cardinality/structural checks
 * (reused, not reimplemented — see `scope-inventory.ts`), the U011 control-row verification, and
 * the Project/RoleChangeRequest/Company-Tenant blockers above. `ok` is true only when every
 * sub-check is clean; `blockers` is the flattened union every caller (the validator script,
 * integration tests, `run-db-contract.ts`) reads.
 */
export function buildClosureReport(facts: ClosureFacts): ClosureReport {
  const inventory = buildScopeInventoryReport(facts.currentModelNames, facts.inventoryEntries);
  const childFkErrors = validateChildViaFkEntries(facts.inventoryEntries, facts.dmmfRelations);
  const structuralErrors = deriveStructuralMismatches(facts.inventoryEntries, facts.dmmfRelations);
  const controlRow = verifyControlRow(facts.controlRow);

  const blockers: ClosureBlocker[] = [
    ...inventory.errors.map(inventoryErrorToBlocker),
    ...childFkErrors.map(inventoryErrorToBlocker),
    ...structuralErrors.map(inventoryErrorToBlocker),
    ...controlRow.blockers,
    ...verifyProjectClosure(facts.projects, facts.manifestEntries, facts.quarantineRows),
    ...verifyCompanyTenantIntegrity(facts.companyTenantRows),
    ...verifyRoleChangeRequestClosure(facts.roleChangeRequest),
  ];

  return {
    ok: inventory.ok && childFkErrors.length === 0 && structuralErrors.length === 0 && blockersOk(blockers),
    inventory,
    childFkErrors,
    structuralErrors,
    controlRow,
    blockers,
  };
}


// ─────────────────────────────────────────────────────────────────────────
// DB-touching fact fetchers
// ─────────────────────────────────────────────────────────────────────────

async function sqlJsonDigestHex(client: DigestClient, value: unknown): Promise<string> {
  const text = JSON.stringify(value ?? null);
  const rows = await client.$queryRawUnsafe<{ hash: string }[]>(
    `SELECT encode(public.digest(pg_catalog.convert_to(($1::jsonb)::text,'UTF8'),'sha256'),'hex') AS hash`,
    text,
  );
  const hash = rows[0]?.hash;
  if (!isHex64(hash)) throw new Error(`sqlJsonDigestHex: unexpected digest result ${JSON.stringify(rows)}`);
  return hash;
}

export async function fetchControlRow(client: DigestClient): Promise<RawControlRow | null> {
  const rows = await client.$queryRawUnsafe<
    Array<{
      id: string;
      source_model: string;
      source_id: string;
      reason_code: string;
      source_row_json: unknown;
      source_row_hash: string;
      candidate_scope_json: unknown;
      review_digest: string | null;
      resolved_at: string | null;
      resolved_by: string | null;
      resolution_json: unknown;
    }>
  >(
    `SELECT id, source_model, source_id, reason_code, source_row_json, source_row_hash,
            candidate_scope_json, review_digest, resolved_at::text AS resolved_at, resolved_by, resolution_json
     FROM scope_backfill_quarantine
     WHERE source_model = $1 AND source_id = $2`,
    CONTROL_ROW_KEY.sourceModel,
    CONTROL_ROW_KEY.sourceId,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    sourceModel: row.source_model,
    sourceId: row.source_id,
    reasonCode: row.reason_code,
    sourceRowJson: row.source_row_json,
    sourceRowHash: row.source_row_hash,
    candidateScopeJson: row.candidate_scope_json,
    reviewDigest: row.review_digest,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionJson: row.resolution_json,
  };
}

export async function fetchLiveCounts(client: DigestClient): Promise<{ projects: number; roleChangeRequests: number }> {
  const rows = await client.$queryRawUnsafe<{ projects: string; rcr: string }[]>(
    `SELECT (SELECT count(*) FROM projects)::text AS projects, (SELECT count(*) FROM role_change_requests)::text AS rcr`,
  );
  return { projects: Number(rows[0]?.projects ?? '0'), roleChangeRequests: Number(rows[0]?.rcr ?? '0') };
}

/** Fetches the control row and recomputes both hashes fresh, ready to hand to `verifyControlRow`. */
export async function fetchControlRowVerificationInput(client: DigestClient): Promise<ControlRowVerificationInput> {
  const row = await fetchControlRow(client);
  const counts = await fetchLiveCounts(client);
  if (!row) {
    return {
      row: null,
      recomputedSourceRowHash: null,
      recomputedReviewDigest: null,
      liveProjectsCount: counts.projects,
      liveRoleChangeRequestsCount: counts.roleChangeRequests,
    };
  }
  const recomputedSourceRowHash = await sqlJsonDigestHex(client, row.sourceRowJson);
  let recomputedReviewDigest: string | null = null;
  const srj = row.sourceRowJson as { mode?: unknown } | null;
  if (srj && typeof srj === 'object' && srj.mode === 'reviewed_apply' && Array.isArray(row.candidateScopeJson)) {
    const projected = manifestFactsProjection(row.candidateScopeJson as ProjectManifestFacts[]);
    recomputedReviewDigest = await sqlJsonDigestHex(client, projected);
  }
  return {
    row,
    recomputedSourceRowHash,
    recomputedReviewDigest,
    liveProjectsCount: counts.projects,
    liveRoleChangeRequestsCount: counts.roleChangeRequests,
  };
}

export async function fetchProjectClosureRows(client: DigestClient): Promise<ProjectClosureRow[]> {
  const rows = await client.$queryRawUnsafe<{ id: string; company_id: string | null }[]>(
    `SELECT id, company_id FROM projects ORDER BY id`,
  );
  return rows.map((r) => ({ id: r.id, companyId: r.company_id }));
}

export async function fetchQuarantineRows(client: DigestClient): Promise<QuarantineRowFacts[]> {
  const rows = await client.$queryRawUnsafe<
    Array<{ source_model: string; source_id: string; reason_code: string; resolved_at: string | null; candidate_scope_json: unknown }>
  >(
    `SELECT source_model, source_id, reason_code, resolved_at::text AS resolved_at, candidate_scope_json
     FROM scope_backfill_quarantine
     WHERE NOT (source_model = $1 AND source_id = $2)`,
    CONTROL_ROW_KEY.sourceModel,
    CONTROL_ROW_KEY.sourceId,
  );
  return rows.map((r) => ({
    sourceModel: r.source_model,
    sourceId: r.source_id,
    reasonCode: r.reason_code,
    resolvedAt: r.resolved_at,
    candidateScopeJson: r.candidate_scope_json,
  }));
}

export async function fetchCompanyTenantRows(client: DigestClient): Promise<CompanyTenantRow[]> {
  const rows = await client.$queryRawUnsafe<{ company_id: string; tenant_id: string; tenant_exists: boolean }[]>(
    `SELECT c.id AS company_id, c.tenant_id AS tenant_id, (t.id IS NOT NULL) AS tenant_exists
     FROM companies c LEFT JOIN tenants t ON t.id = c.tenant_id`,
  );
  return rows.map((r) => ({ companyId: r.company_id, tenantId: r.tenant_id, tenantExists: r.tenant_exists }));
}

export async function fetchRoleChangeClosureInput(
  client: DigestClient,
  conservation: { before: number; liveAfter: number; extracted: number } | null,
): Promise<RoleChangeClosureInput> {
  const rows = await client.$queryRawUnsafe<{ live_null: string; live_total: string; extracted: string; stale_overlap: string }[]>(
    `SELECT
       (SELECT count(*) FROM role_change_requests WHERE company_id IS NULL)::text AS live_null,
       (SELECT count(*) FROM role_change_requests)::text AS live_total,
       (SELECT count(*) FROM scope_backfill_quarantine WHERE source_model = 'RoleChangeRequest')::text AS extracted,
       (SELECT count(*) FROM scope_backfill_quarantine q JOIN role_change_requests r ON r.id = q.source_id WHERE q.source_model = 'RoleChangeRequest')::text AS stale_overlap`,
  );
  const r = rows[0]!;
  return {
    liveNullCompanyCount: Number(r.live_null),
    liveTotalCount: Number(r.live_total),
    quarantineExtractedCount: Number(r.extracted),
    staleQuarantineLiveOverlapCount: Number(r.stale_overlap),
    conservation,
  };
}

function manifestEntriesFromCandidateScopeJson(candidateScopeJson: unknown): ManifestEntryFacts[] | null {
  if (!Array.isArray(candidateScopeJson)) return null;
  return (candidateScopeJson as Array<Record<string, unknown>>).map((e) => ({
    sourceId: String(e.sourceId),
    classification: String(e.classification),
    candidateCompanyIds: Array.isArray(e.candidateCompanyIds) ? (e.candidateCompanyIds as string[]) : [],
    decision: typeof e.decision === 'string' ? e.decision : null,
    selectedCompanyId: typeof e.selectedCompanyId === 'string' ? e.selectedCompanyId : null,
    reviewerKey: typeof e.reviewerKey === 'string' ? e.reviewerKey : null,
  }));
}

function buildDmmfRelations(prismaDmmf: PrismaClient extends never ? never : import('@prisma/client').Prisma.DMMF.Document): DmmfRelationField[] {
  const models = prismaDmmf.datamodel.models;
  const relations: DmmfRelationField[] = [];
  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.relationFromFields || field.relationFromFields.length === 0) continue;
      const scalarFkFields = [...field.relationFromFields];
      const mandatory =
        field.isRequired !== false &&
        scalarFkFields.every((fkName) => {
          const scalar = model.fields.find((f) => f.name === fkName);
          return scalar ? scalar.isRequired : false;
        });
      relations.push({
        model: model.name,
        relationField: field.name,
        targetModel: field.type,
        scalarFkFields,
        mandatory,
        onDelete: field.relationOnDelete ?? null,
      });
    }
  }
  return relations;
}

/**
 * Gathers every fact `buildClosureReport` needs from a live database + the live Prisma DMMF, in
 * one place, for `scripts/validate-scope-closure.ts` and the contract runner. `entries` defaults
 * to the real `MODEL_SCOPE_INVENTORY`.
 */
export async function fetchClosureFacts(
  client: DigestClient,
  currentModelNames: string[],
  inventoryEntries: ScopeInventoryEntry[],
  prismaDmmf: import('@prisma/client').Prisma.DMMF.Document,
): Promise<ClosureFacts> {
  const controlRowInput = await fetchControlRowVerificationInput(client);
  const resolutionJson = controlRowInput.row?.resolutionJson as { conservation?: { before: unknown; liveAfter: unknown; extracted: unknown } } | null | undefined;
  const conservation =
    resolutionJson && typeof resolutionJson === 'object' && resolutionJson.conservation
      ? {
          before: Number(resolutionJson.conservation.before),
          liveAfter: Number(resolutionJson.conservation.liveAfter),
          extracted: Number(resolutionJson.conservation.extracted),
        }
      : null;

  const [projects, quarantineRows, companyTenantRows, roleChangeRequest] = await Promise.all([
    fetchProjectClosureRows(client),
    fetchQuarantineRows(client),
    fetchCompanyTenantRows(client),
    fetchRoleChangeClosureInput(client, conservation),
  ]);

  const manifestEntries = controlRowInput.row ? manifestEntriesFromCandidateScopeJson(controlRowInput.row.candidateScopeJson) : null;

  return {
    currentModelNames,
    inventoryEntries,
    dmmfRelations: buildDmmfRelations(prismaDmmf),
    controlRow: controlRowInput,
    projects,
    manifestEntries,
    quarantineRows,
    companyTenantRows,
    roleChangeRequest,
  };
}
