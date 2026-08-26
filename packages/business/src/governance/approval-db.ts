import { createHash } from "node:crypto";

import { Prisma, prisma } from "@sangfor/db";

import { logStateTransition } from "./audit";

const RISK_LEVELS_REQUIRING_APPROVAL = new Set(["medium", "high"]);

export async function ensureApprovalForRun(commandRunId: string) {
  const run = await prisma.commandRun.findUnique({
    where: { id: commandRunId },
    include: { risk: true },
  });
  if (!run?.risk || !RISK_LEVELS_REQUIRING_APPROVAL.has(run.risk.riskLevel)) {
    return { required: false as const };
  }

  const pending = await prisma.approvalRequest.findFirst({
    where: { commandRunId, status: "pending" },
  });
  if (pending) {
    throw new Error("approval_required");
  }

  const rejected = await prisma.approvalRequest.findFirst({
    where: { commandRunId, status: "rejected" },
  });
  if (rejected) {
    throw new Error("approval_rejected");
  }

  return { required: true as const };
}

export async function createApprovalIfNeeded(commandRunId: string, riskLevel: string) {
  if (!RISK_LEVELS_REQUIRING_APPROVAL.has(riskLevel)) return null;

  const existing = await prisma.approvalRequest.findFirst({
    where: { commandRunId, status: { in: ["pending", "approved"] } },
  });
  if (existing) return existing;

  const approval = await prisma.approvalRequest.create({
    data: {
      commandRunId,
      status: "pending",
      reason: `${riskLevel} risk command requires operator approval`,
    },
  });

  await prisma.notificationEvent.create({
    data: {
      companyId: "system",
      channel: "internal",
      eventType: "approval.required",
      payloadJson: { commandRunId, message: `Approval required for ${riskLevel} risk run` },
    },
  });

  await logStateTransition({
    entityType: "approval_request",
    entityId: approval.id,
    fromStatus: null,
    toStatus: "pending",
    actorType: "engine",
    metadata: { riskLevel },
  });

  return approval;
}

export async function approveRequest(approvalId: string, actorId?: string) {
  const approval = await prisma.approvalRequest.update({
    where: { id: approvalId },
    data: { status: "approved" },
  });

  await logStateTransition({
    entityType: "approval_request",
    entityId: approvalId,
    fromStatus: "pending",
    toStatus: "approved",
    actorType: "user",
    actorId,
  });

  if (approval.commandRunId) {
    await prisma.notificationEvent.create({
      data: {
        companyId: "system",
        channel: "internal",
        eventType: "approval.approved",
        payloadJson: { commandRunId: approval.commandRunId, message: "Command run approved — workflow may proceed" },
      },
    });
  }

  return approval;
}

// ─────────────────────────────────────────────────────────────────────────
// U022/APR-01b: canonical, exact-version writer. Everything above this line is the pre-U022
// reason-string/status-only legacy writer (untouched — `ensureApprovalForRun`/
// `createApprovalIfNeeded` still insert `legacyUnbound=true` rows with zero canonical authority,
// per the U018 dispatch's grandfather clause). U048 removed `submitCommercialApproval` and its
// reason-string commercial path; commercial approval now uses the canonical exact-version kernel.
// This is the first and only writer allowed to insert a full-shape `legacyUnbound=false` row —
// it never upgrades an existing legacy row in place.
// `packages/business/src/governance/approval-kernel.ts` is the sole
// caller: it resolves/validates every field server-side before calling this, and always OMITS
// `validationSnapshotHash` on insert so U018's `approval_request_validation_snapshot_guard`
// trigger computes/fills it — this module never reimplements that PostgreSQL-authoritative digest.
// ─────────────────────────────────────────────────────────────────────────

export interface CreateCanonicalApprovalRequestInput {
  scope: { tenantId: string; companyId: string; projectId: string };
  action: string;
  artifactVersionId: string;
  artifactHashSnapshot: string;
  policyVersion: string;
  requiredQuorum: number;
  requestedByAssignmentId: string;
  requestedSessionId: string;
  ownerAssignmentId: string;
  expiresAt: Date | null;
  validationSnapshot: Prisma.InputJsonValue;
}

/** Deterministic `policyKey::policyVersion` digest — U018 requires `policyHash` non-null on every
 * canonical row but the U022 request contract carries no caller-supplied hash for it (only
 * `policyVersion`), so the server derives one. Not a "shadow validation hash": `policyHash` is a
 * first-class U018 column distinct from `validationSnapshotHash`, and this never touches that
 * DB-generated field. */
function derivePolicyHash(policyKey: string, policyVersion: string): string {
  return createHash("sha256").update(`${policyKey}::${policyVersion}`).digest("hex");
}

export async function createCanonicalApprovalRequest(
  tx: Prisma.TransactionClient,
  input: CreateCanonicalApprovalRequestInput,
) {
  return tx.approvalRequest.create({
    data: {
      status: "pending",
      tenantId: input.scope.tenantId,
      companyId: input.scope.companyId,
      projectId: input.scope.projectId,
      artifactVersionId: input.artifactVersionId,
      action: input.action,
      artifactHashSnapshot: input.artifactHashSnapshot,
      requestedByAssignmentId: input.requestedByAssignmentId,
      requestedSessionId: input.requestedSessionId,
      ownerAssignmentId: input.ownerAssignmentId,
      ownershipRevision: 0,
      policyKey: input.action,
      policyVersion: input.policyVersion,
      policyHash: derivePolicyHash(input.action, input.policyVersion),
      validationSnapshot: input.validationSnapshot,
      // validationSnapshotHash intentionally omitted: the U018 BEFORE INSERT trigger
      // (approval_request_validation_snapshot_guard) computes and fills it from
      // validationSnapshot; the caller reads the returned row for the authoritative hash.
      requiredQuorum: input.requiredQuorum,
      revision: 0,
      expiresAt: input.expiresAt,
      legacyUnbound: false,
    },
  });
}
