import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";

export class OwnershipTransferError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OwnershipTransferError";
    this.code = code;
    this.httpStatus = status;
  }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

// ─── Seven-model owner scanner ────────────────────────────────────────────────
// Each tuple: { entityType, entityId, ownerAssignmentId, ownershipRevision }
// Sorted by (entityType, entityId) via UTF-16 code-unit order
// No lifecycle/status/archive filter — ALL rows owned by source

export type OwnerTuple = {
  entityType: "Artifact" | "ApprovalRequest" | "Opportunity" | "WorkTask" | "VendorRequest" | "RenewalOpportunity" | "SupportCase";
  entityId: string;
  ownerAssignmentId: string;
  ownershipRevision: number;
};

export async function scanOwnerTuples(
  tx: any,
  sourceAssignmentId: string,
): Promise<OwnerTuple[]> {
  const [artifacts, approvalRequests, opportunities, workTasks, vendorRequests, renewalOpportunities, supportCases] =
    await Promise.all([
      tx.artifact.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
      tx.approvalRequest.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
      tx.opportunity.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
      tx.workTask.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
      tx.vendorRequest.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
      tx.renewalOpportunity.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
      tx.supportCase.findMany({ where: { ownerAssignmentId: sourceAssignmentId }, select: { id: true, ownerAssignmentId: true, ownershipRevision: true } }),
    ]);

  const tuples: OwnerTuple[] = [
    ...artifacts.map((r: any) => ({ entityType: "Artifact" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
    ...approvalRequests.map((r: any) => ({ entityType: "ApprovalRequest" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
    ...opportunities.map((r: any) => ({ entityType: "Opportunity" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
    ...workTasks.map((r: any) => ({ entityType: "WorkTask" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
    ...vendorRequests.map((r: any) => ({ entityType: "VendorRequest" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
    ...renewalOpportunities.map((r: any) => ({ entityType: "RenewalOpportunity" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
    ...supportCases.map((r: any) => ({ entityType: "SupportCase" as const, entityId: r.id, ownerAssignmentId: r.ownerAssignmentId, ownershipRevision: r.ownershipRevision ?? 0 })),
  ];

  // Sort by (entityType, entityId) via UTF-16 code-unit order (default JS string comparison)
  tuples.sort((a, b) => {
    if (a.entityType < b.entityType) return -1;
    if (a.entityType > b.entityType) return 1;
    if (a.entityId < b.entityId) return -1;
    if (a.entityId > b.entityId) return 1;
    return 0;
  });

  return tuples;
}

export function computePreviewHash(tuples: OwnerTuple[]): string {
  return sha256Hex(canonicalizeRfc8785(tuples));
}

// ─── Preview (read-only) ──────────────────────────────────────────────────────

export type PreviewOwnershipTransferInput = {
  authContext: AuthContext;
  roleChangeRequestId: string;
  successorAssignmentId: string;
};

export async function previewOwnershipTransfer(input: PreviewOwnershipTransferInput) {
  const { authContext, roleChangeRequestId, successorAssignmentId } = input;
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const rcr = await tx.roleChangeRequest.findUniqueOrThrow({
      where: { id: roleChangeRequestId },
      include: { approvalRequest: true },
    });

    const sourceAssignmentId: string = rcr.targetMembershipId!;
    const tuples = await scanOwnerTuples(tx, sourceAssignmentId);
    const previewHash = computePreviewHash(tuples);
    const itemCount = tuples.length;
    const transferRequired = itemCount > 0;

    return {
      previewSchemaVersion: "ownership-transfer/v1",
      transferRequired,
      itemCount,
      tuples,
      previewHash,
      sourceAssignmentId,
      membershipRevision: rcr.expectedMembershipRevision ?? 0,
      expectedMembershipRevision: rcr.expectedMembershipRevision ?? 0,
      approvalRequestRevision: (rcr.approvalRequest as any)?.revision ?? 0,
      successorEligibility: transferRequired ? "required" : "not_required",
      immutableHistoryExclusions: [],
    };
  });
}

// ─── Create transfer plan ──────────────────────────────────────────────────────

export type CreateOwnershipTransferInput = {
  authContext: AuthContext;
  roleChangeRequestId: string;
  successorAssignmentId: string;
  previewHash: string;
  idempotencyKey: string;
  now: Date;
};

export async function createOwnershipTransfer(input: CreateOwnershipTransferInput) {
  const { authContext, roleChangeRequestId, successorAssignmentId, previewHash, idempotencyKey, now } = input;
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const rcr = await tx.roleChangeRequest.findUniqueOrThrow({
      where: { id: roleChangeRequestId },
      include: { approvalRequest: true },
    });
    const sourceAssignmentId: string = rcr.targetMembershipId!;

    // Re-scan for fresh tuples
    const tuples = await scanOwnerTuples(tx, sourceAssignmentId);
    const freshHash = computePreviewHash(tuples);
    const itemCount = tuples.length;

    if (itemCount === 0) {
      throw new OwnershipTransferError(
        "OWNERSHIP_TRANSFER_NOT_REQUIRED",
        "No owned resources found — no transfer needed",
        409,
      );
    }

    if (freshHash !== previewHash) {
      throw new OwnershipTransferError(
        "OWNERSHIP_PREVIEW_STALE",
        "Preview hash does not match freshly scanned tuples",
        409,
      );
    }

    const inputHash = sha256Hex(canonicalizeRfc8785({
      companyId: scope.companyId,
      roleChangeRequestId,
      successorAssignmentId,
      requestedByAssignmentId: authContext.userId,
      idempotencyKey,
      previewSchemaVersion: "ownership-transfer/v1",
      tuples,
      itemCount,
      previewHash,
      scope: { tenantId: scope.tenantId, companyId: scope.companyId, projectId: scope.projectId },
    }));

    const auditLog = await appendAuditEvent(tx, {
      scope,
      eventType: "governance.ownership_transfer.requested",
      actorId: authContext.userId,
      resourceType: "ownership_transfer",
      resourceId: `ot-${idempotencyKey}`,
      details: { roleChangeRequestId, sourceAssignmentId, successorAssignmentId, previewHash, itemCount, inputHash },
      idempotencyKey,
    });

    const transfer = await tx.ownershipTransfer.create({
      data: {
        roleChangeRequestId,
        sourceAssignmentId,
        successorAssignmentId,
        requestedByAssignmentId: authContext.userId,
        previewSchemaVersion: "ownership-transfer/v1",
        previewHash,
        itemCount,
        status: "requested",
        revision: 0,
        previewIdempotencyKey: idempotencyKey,
        previewInputHash: inputHash,
        previewAuditLogId: auditLog.id,
        requestedAt: now,
        items: {
          create: tuples.map((t, idx) => ({
            ordinal: idx,
            entityType: t.entityType,
            entityId: t.entityId,
            ownerAssignmentId: t.ownerAssignmentId,
            ownershipRevision: t.ownershipRevision,
            afterOwnerAssignmentId: successorAssignmentId,
            afterOwnershipRevision: t.ownershipRevision + 1,
          })),
        },
      },
    });

    return { ownershipTransferId: transfer.id, status: "requested", revision: 0, previewHash, itemCount };
  });
}

// ─── Execute transfer (finalize role change) ──────────────────────────────────

export type ExecuteOwnershipTransferInput = {
  authContext: AuthContext;
  ownershipTransferId: string;
  expectedTransferRevision: number;
  expectedApprovalRevision: number;
  previewHash: string;
  reason?: string;
  idempotencyKey: string;
  now: Date;
};

export async function finalizeRoleChangeAfterOwnershipTransfer(
  input: ExecuteOwnershipTransferInput,
) {
  const { authContext, ownershipTransferId, expectedTransferRevision, expectedApprovalRevision, previewHash, idempotencyKey, now } = input;
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const transfer = await tx.ownershipTransfer.findUniqueOrThrow({
      where: { id: ownershipTransferId },
      include: { items: true, roleChangeRequest: { include: { approvalRequest: true } } },
    });

    if (transfer.status !== "requested" || transfer.revision !== expectedTransferRevision) {
      throw new OwnershipTransferError(
        "OWNERSHIP_TRANSFER_REVISION_CONFLICT",
        `Transfer must be requested@${expectedTransferRevision}, found ${transfer.status}@${transfer.revision}`,
        409,
      );
    }

    if (transfer.previewHash !== previewHash) {
      throw new OwnershipTransferError("OWNERSHIP_PREVIEW_STALE", "Preview hash mismatch", 409);
    }

    // Re-scan to validate no drift
    const freshTuples = await scanOwnerTuples(tx, transfer.sourceAssignmentId);
    const freshHash = computePreviewHash(freshTuples);
    if (freshHash !== previewHash) {
      throw new OwnershipTransferError("OWNERSHIP_PREVIEW_STALE", "Tuples drifted since plan creation", 409);
    }

    // CAS transfer: requested@n → approved@n+1 → completed@n+2
    const approved = await tx.ownershipTransfer.update({
      where: { id: ownershipTransferId, status: "requested", revision: expectedTransferRevision },
      data: { status: "approved", revision: expectedTransferRevision + 1, approvedByAssignmentId: authContext.userId, approvedAt: now },
    });
    if (!approved) throw new OwnershipTransferError("OWNERSHIP_TRANSFER_REVISION_CONFLICT", "CAS failed for approval", 409);

    // Execute each owner transfer with exact CAS per item
    for (const item of transfer.items) {
      const updated = await (tx as any)[lcFirst(item.entityType)].update({
        where: { id: item.entityId, ownerAssignmentId: item.ownerAssignmentId, ownershipRevision: item.ownershipRevision },
        data: { ownerAssignmentId: transfer.successorAssignmentId, ownershipRevision: item.ownershipRevision + 1 },
      });
      if (!updated) {
        throw new OwnershipTransferError("OWNERSHIP_ITEM_CONFLICT", `CAS failed for ${item.entityType}/${item.entityId}`, 409);
      }
    }

    // Complete the transfer
    const completionAudit = await appendAuditEvent(tx, {
      scope,
      eventType: "governance.ownership_transfer.completed",
      actorId: authContext.userId,
      resourceType: "ownership_transfer",
      resourceId: ownershipTransferId,
      details: { sourceAssignmentId: transfer.sourceAssignmentId, successorAssignmentId: transfer.successorAssignmentId, itemCount: transfer.itemCount, previewHash },
      idempotencyKey,
    });

    await tx.ownershipTransfer.update({
      where: { id: ownershipTransferId },
      data: {
        status: "completed",
        revision: expectedTransferRevision + 2,
        executeIdempotencyKey: idempotencyKey,
        completionAuditLogId: completionAudit.id,
        completedAt: now,
      },
    });

    return {
      roleChangeRequestId: transfer.roleChangeRequestId,
      ownershipTransferId,
      ownershipTransferRevision: expectedTransferRevision + 2,
      status: "completed",
      previewHash,
      itemCount: transfer.itemCount,
      sourceAssignmentId: transfer.sourceAssignmentId,
      successorAssignmentId: transfer.successorAssignmentId,
      completionAuditLogId: completionAudit.id,
      ownershipDisposition: "transferred",
    };
  });
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
