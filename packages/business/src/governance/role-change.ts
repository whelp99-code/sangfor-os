import { createHash } from "node:crypto";

import { Prisma, prisma } from "@sangfor/db";
import {
  PRIVILEGED_MFA_MAX_AGE_SECONDS,
  isBusinessRoleCode,
  isHighRiskRoleChange,
  resolveActiveCompanyRole,
  resolveCapabilities,
  type PersistedCompanyRoleAssignment,
} from "@sangfor/auth";

import { appendAuditEvent } from "./audit-db";
import { submitApprovalRequest, decideApprovalWithClient, type ApprovalKernelCaller } from "./approval-kernel";
import { createArtifactVersion } from "./artifact-service";
import { evaluateArtifactRelease } from "./artifact-release";

type TxClient = Prisma.TransactionClient;

export type RoleChangeErrorCode =
  | "ROLE_CHANGE_INVALID_REQUEST"
  | "ROLE_CHANGE_FORBIDDEN"
  | "ROLE_CHANGE_NOT_FOUND"
  | "ROLE_CHANGE_POLICY_INVALID"
  | "ROLE_CHANGE_IDEMPOTENCY_CONFLICT"
  | "ROLE_CHANGE_OPEN_REQUEST_EXISTS"
  | "ROLE_CHANGE_ALREADY_APPLIED"
  | "ROLE_CHANGE_TERMINAL"
  | "APPROVAL_REVISION_CONFLICT"
  | "ROLE_CHANGE_MEMBERSHIP_REVISION_CONFLICT"
  | "ROLE_CHANGE_DUPLICATE_APPROVER";

const STATUS: Record<RoleChangeErrorCode, number> = {
  ROLE_CHANGE_INVALID_REQUEST: 400,
  ROLE_CHANGE_FORBIDDEN: 403,
  ROLE_CHANGE_NOT_FOUND: 404,
  ROLE_CHANGE_POLICY_INVALID: 422,
  ROLE_CHANGE_IDEMPOTENCY_CONFLICT: 409,
  ROLE_CHANGE_OPEN_REQUEST_EXISTS: 409,
  ROLE_CHANGE_ALREADY_APPLIED: 409,
  ROLE_CHANGE_TERMINAL: 409,
  APPROVAL_REVISION_CONFLICT: 409,
  ROLE_CHANGE_MEMBERSHIP_REVISION_CONFLICT: 409,
  ROLE_CHANGE_DUPLICATE_APPROVER: 409,
};

export class RoleChangeError extends Error {
  readonly httpStatus: number;
  constructor(readonly code: RoleChangeErrorCode, message = code) {
    super(message);
    this.name = "RoleChangeError";
    this.httpStatus = STATUS[code];
  }
}

export interface RoleChangeRequestInput {
  readonly targetMembershipId: string;
  readonly toRole: string;
  readonly reason: string;
  readonly expectedMembershipRevision: number;
}

interface HashInput extends RoleChangeRequestInput {
  readonly companyId: string;
  readonly requestedByAssignmentId: string;
}

export function validateRoleChangeRequestInput(value: unknown): RoleChangeRequestInput {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !["targetMembershipId", "toRole", "reason", "expectedMembershipRevision"].includes(key))) {
    throw new RoleChangeError("ROLE_CHANGE_INVALID_REQUEST");
  }
  const { targetMembershipId, toRole, reason, expectedMembershipRevision } = value;
  if (typeof targetMembershipId !== "string" || targetMembershipId.length === 0 || typeof toRole !== "string" || typeof reason !== "string" || reason.trim().length === 0 || !Number.isInteger(expectedMembershipRevision) || typeof expectedMembershipRevision !== "number" || expectedMembershipRevision < 0) {
    throw new RoleChangeError("ROLE_CHANGE_INVALID_REQUEST");
  }
  if (!isBusinessRoleCode(toRole)) throw new RoleChangeError("ROLE_CHANGE_POLICY_INVALID");
  return { targetMembershipId, toRole, reason, expectedMembershipRevision };
}

export function canonicalRoleChangeRequestInputHash(input: HashInput): string {
  const bytes = JSON.stringify({
    companyId: input.companyId,
    expectedMembershipRevision: input.expectedMembershipRevision,
    reason: input.reason,
    requestedByAssignmentId: input.requestedByAssignmentId,
    targetMembershipId: input.targetMembershipId,
    toRole: input.toRole,
    version: "role-change-request-idempotency/v1",
  });
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFreshMfa(caller: ApprovalKernelCaller, now: Date): void {
  const age = caller.mfaVerifiedAt ? (now.getTime() - caller.mfaVerifiedAt.getTime()) / 1000 : Infinity;
  if (!caller.mfaVerifiedAt || age < 0 || age > PRIVILEGED_MFA_MAX_AGE_SECONDS) throw new RoleChangeError("ROLE_CHANGE_FORBIDDEN");
}

async function resolveManagedActor(tx: TxClient, caller: ApprovalKernelCaller, now: Date) {
  requireFreshMfa(caller, now);
  const rows = await tx.userCompanyRole.findMany({
    where: { userId: caller.userId, companyId: caller.scope.companyId },
    select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
  });
  const actor = resolveActiveCompanyRole(rows as PersistedCompanyRoleAssignment[], now);
  if (!actor.ok || !resolveCapabilities(actor.role).includes("role.manage")) throw new RoleChangeError("ROLE_CHANGE_FORBIDDEN");
  return actor.assignment;
}

function assertIdempotencyKey(value: string): void {
  if (!/^[!-~]{16,128}$/.test(value)) throw new RoleChangeError("ROLE_CHANGE_INVALID_REQUEST");
}

export interface CreateRoleChangeInput extends RoleChangeRequestInput {
  readonly idempotencyKey: string;
}

export interface CreatedRoleChange {
  readonly request: Prisma.RoleChangeRequestGetPayload<Record<string, never>>;
  readonly idempotent: boolean;
}

async function createWithClient(tx: TxClient, raw: CreateRoleChangeInput, caller: ApprovalKernelCaller): Promise<CreatedRoleChange> {
  const now = new Date();
  const input = validateRoleChangeRequestInput({
    targetMembershipId: raw.targetMembershipId,
    toRole: raw.toRole,
    reason: raw.reason,
    expectedMembershipRevision: raw.expectedMembershipRevision,
  });
  assertIdempotencyKey(raw.idempotencyKey);
  const requester = await resolveManagedActor(tx, caller, now);
  const requestInputHash = canonicalRoleChangeRequestInputHash({ ...input, companyId: caller.scope.companyId, requestedByAssignmentId: requester.id });

  const replay = await tx.roleChangeRequest.findFirst({
    where: { companyId: caller.scope.companyId, requestedByAssignmentId: requester.id, requestIdempotencyKey: raw.idempotencyKey, legacyUnbound: false },
  });
  if (replay) {
    if (replay.requestInputHash === requestInputHash) return { request: replay, idempotent: true };
    throw new RoleChangeError("ROLE_CHANGE_IDEMPOTENCY_CONFLICT");
  }

  const target = await tx.userCompanyRole.findFirst({
    where: { id: input.targetMembershipId, companyId: caller.scope.companyId },
    select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true, revision: true },
  });
  if (!target) throw new RoleChangeError("ROLE_CHANGE_NOT_FOUND");
  if (target.revision !== input.expectedMembershipRevision) throw new RoleChangeError("ROLE_CHANGE_MEMBERSHIP_REVISION_CONFLICT");
  if (!isHighRiskRoleChange(target.role, input.toRole)) throw new RoleChangeError("ROLE_CHANGE_POLICY_INVALID");
  // A requester may not self-grant the highest business authority. Other requests remain subject
  // to the same independent two-person approval rule.
  if (target.userId === caller.userId && input.toRole === "ceo") throw new RoleChangeError("ROLE_CHANGE_POLICY_INVALID");

  const open = await tx.roleChangeRequest.findFirst({
    where: { companyId: caller.scope.companyId, targetMembershipId: target.id, legacyUnbound: false, status: "pending_approval" },
  });
  if (open) throw new RoleChangeError("ROLE_CHANGE_OPEN_REQUEST_EXISTS");

  const artifact = await tx.artifact.create({
    data: {
      tenantId: caller.scope.tenantId,
      companyId: caller.scope.companyId,
      projectId: caller.scope.projectId,
      artifactType: "ROLE_CHANGE_REQUEST",
      classification: "restricted",
      origin: "human",
      title: `Role change ${target.id}`,
      createdByAssignmentId: requester.id,
      ownerAssignmentId: requester.id,
    },
  });
  const requestedAt = now.toISOString();
  const snapshot = {
    contract: "role-change-request/v1",
    targetMembershipId: target.id,
    targetUserId: target.userId,
    tenantId: caller.scope.tenantId,
    companyId: caller.scope.companyId,
    fromRole: target.role,
    toRole: input.toRole,
    expectedMembershipRevision: input.expectedMembershipRevision,
    requestedByUserId: caller.userId,
    requestedAt,
    reason: input.reason,
    policyVersion: "role-change/v1",
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const version = await createArtifactVersion({ artifactId: artifact.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify(snapshot), contentType: "application/json" }, caller, tx);
  const approval = await submitApprovalRequest({ action: "role.change", artifactVersionId: version.versionId, artifactHash: version.contentHash, policyVersion: "role-change/v1", requiredQuorum: 2 }, caller, tx);
  const created = await tx.roleChangeRequest.create({
    data: {
      userId: target.userId,
      fromRole: target.role,
      toRole: input.toRole,
      status: "pending_approval",
      requestedBy: caller.userId,
      companyId: caller.scope.companyId,
      legacyUnbound: false,
      legacyStatus: null,
      tenantId: caller.scope.tenantId,
      targetMembershipId: target.id,
      requestedByAssignmentId: requester.id,
      expectedMembershipRevision: input.expectedMembershipRevision,
      artifactVersionId: version.versionId,
      approvalRequestId: approval.request.id,
      snapshotHash: version.contentHash,
      policyVersion: "role-change/v1",
      expiresAt: approval.request.expiresAt,
      revision: 0,
      requestIdempotencyKey: raw.idempotencyKey,
      requestInputHash,
    },
  });
  await appendAuditEvent(tx, { scope: { ...caller.scope, level: "PROJECT" }, eventType: "role_change.request.pending_approval", actorId: caller.userId, resourceType: "role_change_request", resourceId: created.id, details: { approvalId: approval.request.id, artifactVersionId: version.versionId } });
  await tx.outboxEvent.create({ data: { eventType: "role_change.request.pending_approval", aggregateType: "role_change_request", aggregateId: created.id, payload: { approvalId: approval.request.id }, status: "pending" } });
  return { request: created, idempotent: false };
}

export async function createRoleChangeRequest(input: CreateRoleChangeInput, caller: ApprovalKernelCaller, tx?: TxClient): Promise<CreatedRoleChange> {
  if (tx) return createWithClient(tx, input, caller);
  return prisma.$transaction((client) => createWithClient(client, input, caller));
}

export interface DecideRoleChangeInput {
  readonly roleChangeRequestId: string;
  readonly approvalId: string;
  readonly decision: "approve" | "reject";
  readonly expectedRevision: number;
  readonly reason?: string;
}

async function decideWithClient(tx: TxClient, input: DecideRoleChangeInput, caller: ApprovalKernelCaller) {
  const now = new Date();
  const actor = await resolveManagedActor(tx, caller, now);
  const request = await tx.roleChangeRequest.findFirst({ where: { id: input.roleChangeRequestId, companyId: caller.scope.companyId, legacyUnbound: false } });
  if (!request || request.approvalRequestId !== input.approvalId) throw new RoleChangeError("ROLE_CHANGE_NOT_FOUND");
  if (request.status === "applied") throw new RoleChangeError("ROLE_CHANGE_ALREADY_APPLIED");
  if (request.status !== "pending_approval") throw new RoleChangeError("ROLE_CHANGE_TERMINAL");
  if (request.expiresAt && request.expiresAt <= now) throw new RoleChangeError("ROLE_CHANGE_TERMINAL");
  if (actor.id === request.requestedByAssignmentId || actor.id === request.targetMembershipId) throw new RoleChangeError("ROLE_CHANGE_POLICY_INVALID");

  let decision;
  try {
    decision = await decideApprovalWithClient(tx, { approvalId: input.approvalId, decision: input.decision, expectedRevision: input.expectedRevision, reason: input.reason }, caller);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "STALE_REVISION") throw new RoleChangeError("APPROVAL_REVISION_CONFLICT");
    if (code === "DUPLICATE_APPROVER") throw new RoleChangeError("ROLE_CHANGE_DUPLICATE_APPROVER");
    throw error;
  }
  if (decision.outcome === "recorded_nonterminal") return { request, outcome: decision.outcome, approval: decision.request };

  const terminal = input.decision === "reject" ? "rejected" : "applied";
  let appliedMembershipRevision: number | null = null;
  if (terminal === "applied") {
    if (!request.artifactVersionId || !request.snapshotHash || !request.expectedMembershipRevision && request.expectedMembershipRevision !== 0) throw new RoleChangeError("ROLE_CHANGE_TERMINAL");
    const release = await evaluateArtifactRelease({ action: "role.change", artifactVersionId: request.artifactVersionId, approvalId: input.approvalId }, caller, tx);
    if (!release.releasable) throw new RoleChangeError("ROLE_CHANGE_TERMINAL");
    const membership = await tx.userCompanyRole.updateMany({ where: { id: request.targetMembershipId!, companyId: caller.scope.companyId, revision: request.expectedMembershipRevision, status: "active" }, data: { role: request.toRole, revision: request.expectedMembershipRevision + 1 } });
    if (membership.count !== 1) throw new RoleChangeError("ROLE_CHANGE_MEMBERSHIP_REVISION_CONFLICT");
    appliedMembershipRevision = request.expectedMembershipRevision + 1;
  }
  const roleCas = await tx.roleChangeRequest.updateMany({
    where: { id: request.id, legacyUnbound: false, status: "pending_approval", revision: 0 },
    data: terminal === "applied"
      ? { status: "applied", revision: 1, terminalAt: now, appliedAt: now, appliedByAssignmentId: actor.id, appliedMembershipRevision, appliedApprovalRevision: decision.request.revision, appliedDecisionSequence: decision.decision.sequence, updatedAt: now }
      : { status: "rejected", revision: 1, terminalAt: now, terminalReasonCode: "APPROVAL_REJECTED", updatedAt: now },
  });
  if (roleCas.count !== 1) throw new RoleChangeError("ROLE_CHANGE_TERMINAL");
  await appendAuditEvent(tx, { scope: { ...caller.scope, level: "PROJECT" }, eventType: `role_change.request.${terminal}`, actorId: caller.userId, resourceType: "role_change_request", resourceId: request.id, details: { approvalId: input.approvalId } });
  await tx.outboxEvent.create({ data: { eventType: `role_change.request.${terminal}`, aggregateType: "role_change_request", aggregateId: request.id, payload: { approvalId: input.approvalId }, status: "pending" } });
  return { request: await tx.roleChangeRequest.findUniqueOrThrow({ where: { id: request.id } }), outcome: decision.outcome, approval: decision.request };
}

export async function decideRoleChange(input: DecideRoleChangeInput, caller: ApprovalKernelCaller, tx?: TxClient) {
  if (tx) return decideWithClient(tx, input, caller);
  return prisma.$transaction((client) => decideWithClient(client, input, caller));
}
