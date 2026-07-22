// ─────────────────────────────────────────────────────────────────────────
// U022/APR-01b — exact-version approval decision kernel.
//
// Runtime CONSUMER of U018's `ApprovalRequest`/`ApprovalDecision`/`ApprovalCurrentValidity`
// schema (packages/db/prisma/schema.prisma). No Prisma model or migration is added here — every
// piece of state this module reasons about already exists as a U018 column, and every CAS/graph
// rule below enforces the exact vocabularies U018 fixed:
//
//   ApprovalRequest.status:        pending | ready_for_human_approval | approved | rejected |
//                                  cancelled | expired
//   ApprovalCurrentValidity.state: pending | valid | invalid | stale | expired | revoked
//
// Every accepted mutation is a single compare-and-swap on `ApprovalRequest.revision` (never a
// blind UPDATE), and every accepted decision is one immutable `ApprovalDecision` row — the DB
// itself denies UPDATE/DELETE on that table (U018 migration 20260715180000), so this module never
// attempts either. The kernel always accepts/reuses the caller's own `Prisma.TransactionClient`
// (see `decideApprovalWithClient`) so a governed domain mutation and its approval decision commit
// or roll back together; the `prisma`-opening wrappers (`decideApproval`, `submitApprovalRequest`,
// …) exist only for standalone callers (route handlers, tests) with no outer transaction of their
// own.
// ─────────────────────────────────────────────────────────────────────────

import { Prisma, prisma } from "@sangfor/db";
import {
  PRIVILEGED_MFA_MAX_AGE_SECONDS,
  resolveActiveCompanyRole,
  type BusinessRole,
  type PersistedCompanyRoleAssignment,
} from "@sangfor/auth";

import { appendAuditEvent } from "./audit-db";
import type { AuditChainScope } from "./audit-chain";
import { createCanonicalApprovalRequest } from "./approval-db";

type TxClient = Prisma.TransactionClient;

export type ApprovalRequestRecord = Prisma.ApprovalRequestGetPayload<Record<string, never>>;
export type ApprovalDecisionRecord = Prisma.ApprovalDecisionGetPayload<Record<string, never>>;
export type ApprovalCurrentValidityRecord = Prisma.ApprovalCurrentValidityGetPayload<Record<string, never>>;

export type ApprovalDecisionValue = "approve" | "reject";

/** Every value `ApprovalRequest.status` may terminally hold; none of these ever accepts another
 * state/decision mutation, even a CAS carrying the latest revision (U018 graph, U022 contract §3). */
const TERMINAL_REQUEST_STATUSES = new Set(["approved", "rejected", "cancelled", "expired"]);
const OPEN_REQUEST_STATUSES = new Set(["pending", "ready_for_human_approval"]);
const DECISION_VALUES = new Set<ApprovalDecisionValue>(["approve", "reject"]);

const DEFAULT_APPROVAL_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APPROVED_VALIDITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Errors — one class, one stable `code`/`httpStatus` pair per failure mode, so every adapter
// (web route handlers) maps kernel outcomes to the exact 400/401/403/404/409/422 envelope the
// U022 contract requires without re-deriving the mapping per call site.
// ─────────────────────────────────────────────────────────────────────────

export type ApprovalKernelErrorCode =
  | "VALIDATION_ERROR"
  | "UNKNOWN_DECISION"
  | "NOT_FOUND"
  | "FOREIGN_SCOPE"
  | "INACTIVE_ROLE"
  | "SELF_APPROVAL"
  | "MFA_REQUIRED"
  | "MFA_STALE"
  | "NOT_READY"
  | "TERMINAL_STATE"
  | "STALE_REVISION"
  | "DUPLICATE_APPROVER"
  | "EXPIRED"
  | "HASH_MISMATCH"
  | "ILLEGAL_TRANSITION";

const HTTP_STATUS_BY_CODE: Record<ApprovalKernelErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNKNOWN_DECISION: 422,
  NOT_FOUND: 404,
  FOREIGN_SCOPE: 403,
  INACTIVE_ROLE: 403,
  SELF_APPROVAL: 403,
  MFA_REQUIRED: 403,
  MFA_STALE: 403,
  NOT_READY: 409,
  TERMINAL_STATE: 409,
  STALE_REVISION: 409,
  DUPLICATE_APPROVER: 409,
  EXPIRED: 409,
  HASH_MISMATCH: 422,
  ILLEGAL_TRANSITION: 409,
};

export class ApprovalKernelError extends Error {
  readonly code: ApprovalKernelErrorCode;
  readonly httpStatus: number;

  constructor(code: ApprovalKernelErrorCode, message: string) {
    super(message);
    this.name = "ApprovalKernelError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Caller/actor context — every identity/scope/MFA fact comes from here, never from request JSON
// (U022 contract §2, §9). The web adapter builds this from the U013/U014 DB-backed session
// resolver (`evaluatePersistedSessionFromRequest`/`evaluatePersistedSessionFromClaims`); nothing
// in this module ever parses a JWT or reads an HTTP header itself (framework-agnostic by design,
// same rule `@sangfor/auth`'s principal-policy/capability-policy modules already follow).
// ─────────────────────────────────────────────────────────────────────────

export interface ApprovalKernelScope {
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
}

export interface ApprovalKernelCaller {
  readonly userId: string;
  /** The caller's session identifier (JWT `jti`) — persisted verbatim as
   * `ApprovalRequest.requestedSessionId` / `ApprovalDecision.actorSessionId`. */
  readonly sessionId: string;
  readonly scope: ApprovalKernelScope;
  /** `null` when the caller has never completed MFA in this session. Approval decisions are
   * always a privileged capability (`isPrivilegedCapability` treats "approve" as a privileged
   * marker — see @sangfor/auth/principal-policy.ts) so this is required and freshness-checked on
   * every decision, not merely gated once at login. */
  readonly mfaVerifiedAt: Date | null;
}

interface ResolvedActor {
  readonly assignmentId: string;
  readonly role: BusinessRole;
}

/** Resolves the caller's single active `UserCompanyRole` for the request's own company scope,
 * fresh, inside the caller's transaction — never trusts a role claim carried on a session/token.
 * Zero or multiple simultaneously active rows both fail closed (same rule as
 * `@sangfor/auth/principal-policy.ts#resolveActiveCompanyRole`, reused verbatim here). */
async function resolveActor(tx: TxClient, caller: ApprovalKernelCaller, now: Date): Promise<ResolvedActor> {
  const rows = await tx.userCompanyRole.findMany({
    where: { userId: caller.userId, companyId: caller.scope.companyId },
    select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
  });
  const resolution = resolveActiveCompanyRole(rows as PersistedCompanyRoleAssignment[], now);
  if (!resolution.ok) {
    throw new ApprovalKernelError("INACTIVE_ROLE", `caller has no single active company role in scope (${resolution.reason})`);
  }
  return { assignmentId: resolution.assignment.id, role: resolution.role };
}

function requireFreshMfa(caller: ApprovalKernelCaller, now: Date): void {
  if (!caller.mfaVerifiedAt) {
    throw new ApprovalKernelError("MFA_REQUIRED", "fresh MFA verification is required to decide an approval request");
  }
  const ageSeconds = (now.getTime() - caller.mfaVerifiedAt.getTime()) / 1000;
  if (ageSeconds < 0 || ageSeconds > PRIVILEGED_MFA_MAX_AGE_SECONDS) {
    throw new ApprovalKernelError("MFA_STALE", "MFA verification has expired; re-verify before deciding");
  }
}

function auditScope(scope: ApprovalKernelScope): AuditChainScope {
  return { tenantId: scope.tenantId, companyId: scope.companyId, projectId: scope.projectId, level: "PROJECT" };
}

type CanonicalApprovalRequestRecord = ApprovalRequestRecord & {
  tenantId: string;
  companyId: string;
  projectId: string;
  artifactVersionId: string;
  artifactHashSnapshot: string;
  policyHash: string;
  requiredQuorum: number;
  requestedByAssignmentId: string;
  ownerAssignmentId: string;
};

/** Every canonical (`legacyUnbound=false`) row is guaranteed by the U018 DB guard trigger to carry
 * every field below non-null. This is a runtime re-assertion (never trust Prisma optionality
 * alone for an authority decision) that also narrows the type so the rest of the kernel never
 * needs a non-null assertion operator. */
function assertCanonical(request: ApprovalRequestRecord): asserts request is CanonicalApprovalRequestRecord {
  if (
    request.legacyUnbound ||
    request.tenantId === null ||
    request.companyId === null ||
    request.projectId === null ||
    request.artifactVersionId === null ||
    request.artifactHashSnapshot === null ||
    request.policyHash === null ||
    request.requiredQuorum === null ||
    request.requestedByAssignmentId === null ||
    request.ownerAssignmentId === null
  ) {
    throw new ApprovalKernelError("ILLEGAL_TRANSITION", "approval request is not a complete canonical (legacyUnbound=false) row");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Creation — contract §1. `{action, artifactVersionId, artifactHash, policyVersion,
// validationSnapshotHash?, requiredQuorum}` is the entire caller-facing shape; scope/actor come
// from `ApprovalKernelCaller`. Creation persists `pending@0`; `readyApprovalRequest` performs the
// server-side validation CAS to `ready_for_human_approval@1` plus the paired
// `ApprovalCurrentValidity.pending@1` row. `submitApprovalRequest` runs both, plus audit/outbox,
// in one transaction — the web adapter's single POST call.
// ─────────────────────────────────────────────────────────────────────────

export interface CreateApprovalRequestInput {
  readonly action: string;
  readonly artifactVersionId: string;
  readonly artifactHash: string;
  readonly policyVersion: string;
  /** Optional caller-side integrity check only — never written verbatim. The kernel always
   * derives its own `validationSnapshot` from the other fields and lets U018's DB trigger compute
   * the authoritative hash; if the caller supplies one, it must match that computed value. */
  readonly validationSnapshotHash?: string;
  readonly requiredQuorum: number;
}

export interface ApprovalRequestWithValidity {
  readonly request: ApprovalRequestRecord;
  readonly validity: ApprovalCurrentValidityRecord;
}

async function createApprovalRequest(
  tx: TxClient,
  input: CreateApprovalRequestInput,
  caller: ApprovalKernelCaller,
  now: Date,
): Promise<ApprovalRequestRecord> {
  if (typeof input.action !== "string" || input.action.trim().length === 0) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "action is required");
  }
  if (typeof input.artifactVersionId !== "string" || input.artifactVersionId.length === 0) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "artifactVersionId is required");
  }
  if (typeof input.artifactHash !== "string" || input.artifactHash.length === 0) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "artifactHash is required");
  }
  if (typeof input.policyVersion !== "string" || input.policyVersion.trim().length === 0) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "policyVersion is required");
  }
  if (!Number.isInteger(input.requiredQuorum) || input.requiredQuorum < 1) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "requiredQuorum must be a positive integer");
  }

  const actor = await resolveActor(tx, caller, now);

  const version = await tx.artifactVersion.findUnique({
    where: { id: input.artifactVersionId },
    include: { artifact: { select: { tenantId: true, companyId: true, projectId: true } } },
  });
  // Opaque foreign/nonexistent artifactVersionId: never distinguish "does not exist" from
  // "exists in a scope you cannot see" (U022 contract §8 — opaque foreign resource id is 404).
  if (
    !version ||
    version.artifact.tenantId !== caller.scope.tenantId ||
    version.artifact.companyId !== caller.scope.companyId ||
    version.artifact.projectId !== caller.scope.projectId
  ) {
    throw new ApprovalKernelError("NOT_FOUND", "artifact version not found");
  }
  if (version.contentHash !== input.artifactHash) {
    throw new ApprovalKernelError("HASH_MISMATCH", "artifactHash does not match the current ArtifactVersion content hash");
  }

  // Plain-object round trip (not a direct `ApprovalKernelScope`/interface reference): `Prisma.
  // InputJsonObject` requires a string index signature that a `readonly`-field interface doesn't
  // structurally satisfy, same reason `audit-db.ts`'s `toPrismaJson` does the same round trip.
  const validationSnapshot: Prisma.InputJsonValue = JSON.parse(
    JSON.stringify({
      action: input.action,
      artifactVersionId: input.artifactVersionId,
      artifactHash: input.artifactHash,
      policyVersion: input.policyVersion,
      requiredQuorum: input.requiredQuorum,
      scope: { tenantId: caller.scope.tenantId, companyId: caller.scope.companyId, projectId: caller.scope.projectId },
    }),
  );

  const created = await createCanonicalApprovalRequest(tx, {
    scope: caller.scope,
    action: input.action,
    artifactVersionId: input.artifactVersionId,
    artifactHashSnapshot: input.artifactHash,
    policyVersion: input.policyVersion,
    requiredQuorum: input.requiredQuorum,
    requestedByAssignmentId: actor.assignmentId,
    requestedSessionId: caller.sessionId,
    ownerAssignmentId: actor.assignmentId,
    expiresAt: new Date(now.getTime() + DEFAULT_APPROVAL_REQUEST_TTL_MS),
    validationSnapshot,
  });

  // First prerequisite assertion (dispatch-mandated): block against U018 if it somehow failed to
  // fill validationSnapshotHash on a canonical insert. This module never computes that hash
  // itself — a null value here means U018's trigger regressed, not something U022 may paper over.
  if (!created.validationSnapshotHash) {
    throw new ApprovalKernelError(
      "VALIDATION_ERROR",
      "U018 validationSnapshotHash is absent on a canonical insert — blocking against a U018 regression",
    );
  }
  if (input.validationSnapshotHash && input.validationSnapshotHash !== created.validationSnapshotHash) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "caller-supplied validationSnapshotHash does not match the server-computed value");
  }

  return created;
}

/** Contract §1's second half: only a complete server-side validation may CAS `pending@0 ->
 * ready_for_human_approval@1` and create the matching `ApprovalCurrentValidity.pending@1`
 * projection. Exposed separately from `createApprovalRequest` so both halves of the two-step
 * graph are independently testable/callable; `submitApprovalRequest` below runs them back to
 * back for the ordinary HTTP creation flow. */
async function readyApprovalRequest(
  tx: TxClient,
  args: { approvalId: string; expectedRevision: number },
): Promise<ApprovalRequestWithValidity> {
  const resultingRevision = args.expectedRevision + 1;
  const cas = await tx.approvalRequest.updateMany({
    where: { id: args.approvalId, revision: args.expectedRevision, status: "pending", legacyUnbound: false },
    data: { status: "ready_for_human_approval", revision: resultingRevision },
  });
  if (cas.count !== 1) {
    throw new ApprovalKernelError("STALE_REVISION", "unable to CAS pending request to ready_for_human_approval");
  }
  const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: args.approvalId } });
  assertCanonical(request);

  const validity = await tx.approvalCurrentValidity.create({
    data: {
      approvalRequestId: request.id,
      requestRevision: resultingRevision,
      artifactVersionId: request.artifactVersionId,
      artifactHashSnapshot: request.artifactHashSnapshot,
      policyHashSnapshot: request.policyHash,
      requiredQuorum: request.requiredQuorum,
      satisfiedQuorum: 0,
      lastDecisionSequence: 0,
      state: "pending",
    },
  });

  return { request, validity };
}

/** The ordinary single-call creation flow: create `pending@0`, immediately run the server-side
 * validation CAS to `ready_for_human_approval@1` plus its projection, and audit/outbox both in
 * ONE transaction. Accepts/reuses a caller-supplied transaction client so a domain caller that
 * already holds one never splits authority across two commits. */
export async function submitApprovalRequest(
  input: CreateApprovalRequestInput,
  caller: ApprovalKernelCaller,
  tx?: TxClient,
): Promise<ApprovalRequestWithValidity> {
  const run = async (client: TxClient): Promise<ApprovalRequestWithValidity> => {
    const now = new Date();
    const created = await createApprovalRequest(client, input, caller, now);
    const ready = await readyApprovalRequest(client, { approvalId: created.id, expectedRevision: 0 });

    await appendAuditEvent(client, {
      scope: auditScope(caller.scope),
      eventType: "approval.request.ready_for_human_approval",
      actorId: caller.userId,
      resourceType: "approval_request",
      resourceId: created.id,
      details: { action: input.action, artifactVersionId: input.artifactVersionId, requiredQuorum: input.requiredQuorum },
    });
    await client.outboxEvent.create({
      data: {
        eventType: "approval.request.ready_for_human_approval",
        aggregateType: "approval_request",
        aggregateId: created.id,
        payload: { status: ready.request.status, revision: ready.request.revision },
        status: "pending",
      },
    });

    return ready;
  };

  if (tx) return run(tx);
  return prisma.$transaction((client) => run(client));
}

// ─────────────────────────────────────────────────────────────────────────
// Decision — contract §2-§5. Canonical input is EXACTLY {approvalId, decision, expectedRevision,
// reason?}; every other fact (actor, scope, role, MFA, quorum) is server-resolved fresh inside the
// SAME transaction as the CAS, so a concurrently revoked role/session can never be used to decide.
// ─────────────────────────────────────────────────────────────────────────

export interface DecideApprovalInput {
  readonly approvalId: string;
  readonly decision: string;
  readonly expectedRevision: number;
  readonly reason?: string;
}

export type ApprovalDecisionOutcome = "recorded_nonterminal" | "approved" | "rejected";

export interface DecideApprovalResult {
  readonly outcome: ApprovalDecisionOutcome;
  readonly request: ApprovalRequestRecord;
  readonly decision: ApprovalDecisionRecord;
  readonly validity: ApprovalCurrentValidityRecord;
}

/** Lazily applies the `pending|ready_for_human_approval -> expired` transition when a request's
 * `expiresAt` has elapsed. Shared by the public `expireIfDue` maintenance entrypoint and by
 * `decideApprovalWithClient` (a decision against an overdue request must see it as terminal, not
 * silently decide against a stale row) — the same U018 graph rule either way, one implementation. */
async function applyExpiryIfDue(tx: TxClient, request: ApprovalRequestRecord, now: Date): Promise<ApprovalRequestRecord> {
  if (!request.expiresAt || request.expiresAt > now || !OPEN_REQUEST_STATUSES.has(request.status)) {
    return request;
  }
  const resultingRevision = request.revision + 1;
  const cas = await tx.approvalRequest.updateMany({
    where: { id: request.id, revision: request.revision, status: request.status },
    data: { status: "expired", revision: resultingRevision, resolvedAt: now },
  });
  if (cas.count === 1) {
    await tx.approvalCurrentValidity.updateMany({
      where: { approvalRequestId: request.id },
      data: { requestRevision: resultingRevision, state: "expired", invalidatedAt: now, reasonCode: "expired" },
    });
  }
  return tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
}

/** Runs `fn` against a caller-supplied transaction client when given, else opens one on the
 * shared `prisma` singleton — the same accept/reuse-or-open pattern every kernel entrypoint
 * follows (mirrors `@sangfor/business`'s `appendAuditEvent`/`appendAuditEventStandalone`). */
async function withTx<T>(tx: TxClient | undefined, fn: (client: TxClient) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  return prisma.$transaction(fn);
}

/** Server-only maintenance entrypoint — never reachable from request JSON. Idempotent: calling it
 * against an already-expired/terminal/not-yet-due request simply returns the current row. */
export async function expireIfDue(approvalId: string, tx?: TxClient): Promise<ApprovalRequestRecord> {
  return withTx(tx, async (client) => {
    const request = await client.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
    return applyExpiryIfDue(client, request, new Date());
  });
}

/** Server-only cancel — `pending|ready_for_human_approval -> cancelled`. Never appends an
 * `ApprovalDecision` (contract §3: cancel/expire are distinct from a decision). */
export async function cancelApprovalRequest(
  approvalId: string,
  expectedRevision: number,
  reasonCode?: string,
  tx?: TxClient,
): Promise<ApprovalRequestRecord> {
  return withTx(tx, async (client) => {
    const request = await client.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!request || request.legacyUnbound) throw new ApprovalKernelError("NOT_FOUND", "approval request not found");
    if (TERMINAL_REQUEST_STATUSES.has(request.status)) {
      throw new ApprovalKernelError("TERMINAL_STATE", `cannot cancel a terminal request (${request.status})`);
    }
    if (request.revision !== expectedRevision) {
      throw new ApprovalKernelError("STALE_REVISION", `expectedRevision ${expectedRevision} does not match current revision ${request.revision}`);
    }
    const resultingRevision = expectedRevision + 1;
    const cas = await client.approvalRequest.updateMany({
      where: { id: approvalId, revision: expectedRevision, status: request.status },
      data: { status: "cancelled", revision: resultingRevision, resolvedAt: new Date() },
    });
    if (cas.count !== 1) throw new ApprovalKernelError("STALE_REVISION", "concurrent transition changed this request; retry");
    await client.approvalCurrentValidity.updateMany({
      where: { approvalRequestId: approvalId },
      data: { requestRevision: resultingRevision, state: "invalid", invalidatedAt: new Date(), reasonCode: reasonCode ?? "cancelled" },
    });
    return client.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
  });
}

/** Contract §6, first half: a new artifact version or changed policy/hash never rewrites
 * request/decision history — it atomically moves the projection `pending|valid -> stale`. Terminal
 * validity states (`invalid|stale|expired|revoked`) can never resurrect to `valid`; a new exact
 * request is required. */
export async function markValidityStale(approvalId: string, reasonCode: string, tx?: TxClient): Promise<ApprovalCurrentValidityRecord> {
  return withTx(tx, async (client) => {
    const validity = await client.approvalCurrentValidity.findUnique({ where: { approvalRequestId: approvalId } });
    if (!validity) throw new ApprovalKernelError("NOT_FOUND", "validity projection not found");
    if (validity.state !== "pending" && validity.state !== "valid") {
      throw new ApprovalKernelError("ILLEGAL_TRANSITION", `cannot mark ${validity.state} as stale — only pending|valid may transition`);
    }
    // CAS on `state` (not a plain `.update()`): two concurrent stale/revoke-style calls against
    // the same row must not both silently "succeed" last-write-wins.
    const cas = await client.approvalCurrentValidity.updateMany({
      where: { approvalRequestId: approvalId, state: validity.state },
      data: { state: "stale", invalidatedAt: new Date(), reasonCode },
    });
    if (cas.count !== 1) throw new ApprovalKernelError("ILLEGAL_TRANSITION", "concurrent transition changed this validity projection; retry");
    return client.approvalCurrentValidity.findUniqueOrThrow({ where: { approvalRequestId: approvalId } });
  });
}

/** Contract §6, second half: explicit governance revocation transitions only `valid -> revoked`. */
export async function revokeValidity(approvalId: string, reasonCode: string, tx?: TxClient): Promise<ApprovalCurrentValidityRecord> {
  return withTx(tx, async (client) => {
    const validity = await client.approvalCurrentValidity.findUnique({ where: { approvalRequestId: approvalId } });
    if (!validity) throw new ApprovalKernelError("NOT_FOUND", "validity projection not found");
    if (validity.state !== "valid") {
      throw new ApprovalKernelError("ILLEGAL_TRANSITION", `cannot revoke from ${validity.state} — only valid may transition`);
    }
    const cas = await client.approvalCurrentValidity.updateMany({
      where: { approvalRequestId: approvalId, state: "valid" },
      data: { state: "revoked", invalidatedAt: new Date(), reasonCode },
    });
    if (cas.count !== 1) throw new ApprovalKernelError("ILLEGAL_TRANSITION", "concurrent transition changed this validity projection; retry");
    return client.approvalCurrentValidity.findUniqueOrThrow({ where: { approvalRequestId: approvalId } });
  });
}

/** The canonical decision kernel. Accepts/reuses the caller's own transaction client — decision
 * append, request state/resulting-revision CAS, and the paired `ApprovalCurrentValidity` update
 * are ONE transaction with audit/outbox (contract §5); an audit or outbox failure rolls back the
 * whole thing (never a best-effort mark-approved). */
export async function decideApprovalWithClient(
  tx: TxClient,
  input: DecideApprovalInput,
  caller: ApprovalKernelCaller,
): Promise<DecideApprovalResult> {
  const now = new Date();

  if (!DECISION_VALUES.has(input.decision as ApprovalDecisionValue)) {
    throw new ApprovalKernelError("UNKNOWN_DECISION", `unknown decision "${input.decision}" — must be "approve" or "reject"`);
  }
  const decision = input.decision as ApprovalDecisionValue;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ApprovalKernelError("VALIDATION_ERROR", "expectedRevision must be a non-negative integer");
  }
  if (input.reason !== undefined && typeof input.reason !== "string") {
    throw new ApprovalKernelError("VALIDATION_ERROR", "reason must be a string when present");
  }

  requireFreshMfa(caller, now);
  const actor = await resolveActor(tx, caller, now);

  const fetched = await tx.approvalRequest.findUnique({ where: { id: input.approvalId } });
  // Opaque foreign/nonexistent/legacy approvalId: never distinguish "does not exist" from "exists
  // in another company" or "carries zero canonical authority" (contract §8 — opaque id is 404;
  // the canonical decision input carries no explicit scope selector at all, so every scope
  // mismatch here is necessarily opaque, never an "explicit foreign scope selector").
  if (
    !fetched ||
    fetched.legacyUnbound ||
    fetched.tenantId !== caller.scope.tenantId ||
    fetched.companyId !== caller.scope.companyId
  ) {
    throw new ApprovalKernelError("NOT_FOUND", "approval request not found");
  }

  assertCanonical(fetched);
  const request = fetched;

  if (TERMINAL_REQUEST_STATUSES.has(request.status)) {
    throw new ApprovalKernelError("TERMINAL_STATE", `approval request is already terminal (${request.status})`);
  }
  // Read-only precondition, deliberately NOT the mutating `applyExpiryIfDue` used by
  // `expireIfDue`/`cancelApprovalRequest`: this whole function throws on every rejection path,
  // which would abort (and silently discard) any write made earlier in the SAME transaction —
  // an overdue request must still report EXPIRED even though the actual `pending|
  // ready_for_human_approval -> expired` DB transition is `expireIfDue`'s own, separately
  // committed, job (contract §3: expiry is distinct from a decision).
  if (request.expiresAt && request.expiresAt <= now) {
    throw new ApprovalKernelError("EXPIRED", `approval request expired at ${request.expiresAt.toISOString()}`);
  }
  if (request.status !== "ready_for_human_approval") {
    throw new ApprovalKernelError("NOT_READY", `approval request is not ready for a human decision (status=${request.status})`);
  }
  if (request.revision !== input.expectedRevision) {
    throw new ApprovalKernelError(
      "STALE_REVISION",
      `expectedRevision ${input.expectedRevision} does not match current revision ${request.revision}`,
    );
  }
  if (request.requestedByAssignmentId === actor.assignmentId || request.ownerAssignmentId === actor.assignmentId) {
    throw new ApprovalKernelError("SELF_APPROVAL", "the requester/owner of an approval request may not decide it");
  }

  const duplicate = await tx.approvalDecision.findFirst({
    where: { approvalRequestId: request.id, actorAssignmentId: actor.assignmentId },
    select: { id: true },
  });
  if (duplicate) throw new ApprovalKernelError("DUPLICATE_APPROVER", "this approver has already decided this request");

  // Deliberately NOT re-checked against `validity.state !== "pending"` here: under PostgreSQL's
  // default READ COMMITTED isolation, this plain SELECT and the `request` read above are each
  // evaluated against the latest committed data as of THEIR OWN statement, not one consistent
  // transaction-wide snapshot. Under real concurrent decisions, a losing transaction can read a
  // still-`ready_for_human_approval`/matching-revision `request` and then, moments later, read an
  // ALREADY-committed non-pending `validity` from the winner — a race, not a genuine data
  // integrity violation. Since this kernel is the sole writer of these two rows and always moves
  // `request.revision`/`validity.requestRevision` in lockstep within one transaction, the
  // `expectedRevision` CAS below is the sole authoritative conflict detector: if it does not
  // match, this whole transaction throws STALE_REVISION and nothing here is ever written,
  // regardless of what this SELECT happened to observe. Only a genuinely missing row (a READY
  // request with no projection at all) is a real integrity fault.
  const validity = await tx.approvalCurrentValidity.findUnique({ where: { approvalRequestId: request.id } });
  if (!validity) {
    throw new ApprovalKernelError("ILLEGAL_TRANSITION", "approval request has no validity projection to decide against");
  }

  const resultingRevision = input.expectedRevision + 1;
  const newSequence = validity.lastDecisionSequence + 1;

  let targetStatus: string;
  let newSatisfiedQuorum = validity.satisfiedQuorum;
  let newValidityState: string;
  let outcome: ApprovalDecisionOutcome;

  if (decision === "reject") {
    // Reject never increments satisfiedQuorum (contract §4) and is immediately terminal.
    targetStatus = "rejected";
    newValidityState = "invalid";
    outcome = "rejected";
  } else {
    newSatisfiedQuorum = validity.satisfiedQuorum + 1;
    const final = newSatisfiedQuorum >= validity.requiredQuorum;
    targetStatus = final ? "approved" : "ready_for_human_approval";
    newValidityState = final ? "valid" : "pending";
    outcome = final ? "approved" : "recorded_nonterminal";
  }

  // The CAS below is the sole serialization point: two concurrent final-quorum decisions both
  // read the same pre-CAS state, but only one UPDATE can match `revision=expectedRevision` — the
  // other observes 0 rows affected (Postgres re-evaluates the WHERE clause against the
  // post-commit row) and this whole transaction aborts before any decision/validity write, so a
  // losing transaction never partially commits.
  const cas = await tx.approvalRequest.updateMany({
    where: { id: request.id, revision: input.expectedRevision, status: "ready_for_human_approval" },
    data: { status: targetStatus, revision: resultingRevision, resolvedAt: outcome === "recorded_nonterminal" ? null : now },
  });
  if (cas.count !== 1) {
    throw new ApprovalKernelError("STALE_REVISION", "concurrent transition changed this approval request; retry with the latest revision");
  }

  let createdDecision: ApprovalDecisionRecord;
  try {
    createdDecision = await tx.approvalDecision.create({
      data: {
        approvalRequestId: request.id,
        sequence: newSequence,
        requestRevision: resultingRevision,
        artifactVersionId: request.artifactVersionId,
        artifactHashSnapshot: request.artifactHashSnapshot,
        decision,
        actorAssignmentId: actor.assignmentId,
        actorSessionId: caller.sessionId,
        actorRoleSnapshot: actor.role,
        policyHashSnapshot: request.policyHash,
        reason: input.reason ?? null,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApprovalKernelError("DUPLICATE_APPROVER", "this approver has already decided this request");
    throw err;
  }

  const updatedValidity = await tx.approvalCurrentValidity.update({
    where: { approvalRequestId: request.id },
    data: {
      requestRevision: resultingRevision,
      satisfiedQuorum: newSatisfiedQuorum,
      lastDecisionSequence: newSequence,
      state: newValidityState,
      evaluatedAt: outcome === "approved" ? now : validity.evaluatedAt,
      validUntil: outcome === "approved" ? new Date(now.getTime() + APPROVED_VALIDITY_TTL_MS) : null,
      invalidatedAt: newValidityState === "invalid" ? now : null,
      reasonCode: decision === "reject" ? "rejected" : null,
    },
  });

  // Audit + outbox in the SAME transaction as the CAS/decision/validity writes above — a failure
  // here (e.g. appendAuditEvent throwing) rolls back the entire decision, never marks approved on
  // a best-effort audit (contract §5, §9).
  await appendAuditEvent(tx, {
    scope: auditScope(caller.scope),
    eventType: `approval.decision.${decision}`,
    actorId: caller.userId,
    resourceType: "approval_request",
    resourceId: request.id,
    details: { decision, outcome, resultingRevision, satisfiedQuorum: newSatisfiedQuorum, requiredQuorum: validity.requiredQuorum },
  });
  await tx.outboxEvent.create({
    data: {
      eventType: `approval.${outcome}`,
      aggregateType: "approval_request",
      aggregateId: request.id,
      payload: { decision, resultingRevision, outcome },
      status: "pending",
    },
  });

  const updatedRequest = await tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
  return { outcome, request: updatedRequest, decision: createdDecision, validity: updatedValidity };
}

/** Standalone convenience wrapper — opens its own transaction. Prefer
 * `decideApprovalWithClient(tx, …)` from inside a caller's existing transaction whenever one
 * exists, same pattern as `@sangfor/business`'s `appendAuditEvent`/`appendAuditEventStandalone`. */
export async function decideApproval(input: DecideApprovalInput, caller: ApprovalKernelCaller): Promise<DecideApprovalResult> {
  return prisma.$transaction((tx) => decideApprovalWithClient(tx, input, caller));
}
