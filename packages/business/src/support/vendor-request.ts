import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { evaluateCommercialApproval } from "../governance/commercial-approval";

export class VendorRequestError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "VendorRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

function normalizeString(val: string | undefined, maxLen: number, name: string): string {
  if (!val) return "";
  const trimmed = val.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (trimmed.length < 1 || trimmed.length > maxLen) {
    throw new VendorRequestError("INVALID_STRING", `${name} length must be between 1 and ${maxLen}`, 400);
  }
  return trimmed;
}

export type VendorRequestStatus =
  | "draft"
  | "ready_for_manual_submission"
  | "manually_submitted"
  | "waiting_vendor"
  | "approved"
  | "rejected"
  | "cancelled"
  | "completed";

export type CreateVendorRequestCommand = {
  authContext: AuthContext;
  opportunityId?: string;
  quoteId?: string;
  requestType: "special_discount" | "demo_license";
  details?: Record<string, unknown>;
  idempotencyKey: string;
};

export type CreateVendorRequestResult = {
  requestId: string;
  discountRequestId?: string | null;
  demoLicenseId?: string | null;
  status: VendorRequestStatus;
  revision: number;
  ownershipRevision: number;
  idempotent: boolean;
};

export async function createVendorRequest(
  cmd: CreateVendorRequestCommand,
): Promise<CreateVendorRequestResult> {
  if (!cmd.idempotencyKey || typeof cmd.idempotencyKey !== "string") {
    throw new VendorRequestError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const assignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!assignment) {
      throw new VendorRequestError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    const existingReq = await tx.vendorRequest.findFirst({
      where: { idempotencyKey: cmd.idempotencyKey },
    });
    if (existingReq) {
      return {
        requestId: existingReq.id,
        discountRequestId: existingReq.discountRequestId ? (existingReq.discountRequestId as string) : undefined,
        status: existingReq.status as VendorRequestStatus,
        revision: existingReq.revision,
        ownershipRevision: existingReq.ownershipRevision,
        idempotent: true,
      };
    }

    let discountRequestId: string | undefined;
    let demoLicenseId: string | undefined;

    let oppId = cmd.opportunityId;
    if (cmd.quoteId) {
      const quote = await tx.quote.findUniqueOrThrow({ where: { id: cmd.quoteId } });
      oppId = quote.opportunityId;

      const commDecision = evaluateCommercialApproval({
        revenue: Number(quote.totalRevenue ?? 0),
        cost: Number(quote.totalCost ?? 0),
        discountPercent: 0,
        action: "quote.internal_release",
      });
      if (commDecision.blocked) {
        throw new VendorRequestError("COMMERCIAL_APPROVAL_REQUIRED", "Quote commercial approval blocked", 409);
      }
    }

    if (!oppId) {
      throw new VendorRequestError("OPPORTUNITY_REQUIRED", "opportunityId or quoteId is required", 400);
    }

    const opportunity = await tx.opportunity.findUniqueOrThrow({
      where: { id: oppId },
      select: { customerId: true },
    });
    if (!opportunity.customerId) {
      throw new VendorRequestError("CUSTOMER_REQUIRED", "Opportunity must have a canonical customer", 409);
    }

    if (cmd.requestType === "special_discount") {
      if (!cmd.quoteId) {
        throw new VendorRequestError("QUOTE_REQUIRED", "quoteId is required for special_discount request", 400);
      }
      const disc = await tx.discountRequest.create({
        data: {
          quoteId: cmd.quoteId,
          requestedDiscount: 0,
          reason: "Special discount requested",
          requestedByAssignmentId: assignment.id,
          vendorRequired: true,
          idempotencyKey: cmd.idempotencyKey,
        },
      });
      discountRequestId = disc.id;
    }

    const vreq = await tx.vendorRequest.create({
      data: {
        opportunityId: oppId,
        customerId: opportunity.customerId,
        quoteId: cmd.quoteId ?? null,
        discountRequestId: discountRequestId ?? null,
        requestType: cmd.requestType,
        vendorName: "Sangfor Vendor",
        detailsJson: (cmd.details as any) ?? {},
        createdBy: assignment.id,
        requestedByAssignmentId: assignment.id,
        ownerAssignmentId: assignment.id,
        status: "ready_for_manual_submission",
        revision: 0,
        ownershipRevision: 0,
        idempotencyKey: cmd.idempotencyKey,
      },
    });

    if (cmd.requestType === "demo_license") {
      const demo = await tx.demoLicense.create({
        data: {
          vendorRequestId: vreq.id,
          productSkuId: "sku-demo-default",
          customerId: "cust-demo-default",
          status: "pending",
        },
      });
      demoLicenseId = demo.id;
    }

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "vendor-request-event/v1",
      tag: "initial_creation",
      requestId: vreq.id,
      idempotencyKey: cmd.idempotencyKey,
    }));

    await tx.vendorRequestEvent.create({
      data: {
        requestId: vreq.id,
        actorAssignmentId: assignment.id,
        eventType: "vendor_request_created",
        payload: { inputHash, requestType: cmd.requestType, fromStatus: null, toStatus: "ready_for_manual_submission", fromRevision: null, toRevision: 0 },
      },
    });

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: "vendor_request.created",
      actorId: ctx.userId,
      resourceType: "vendor_request",
      resourceId: vreq.id,
      details: { status: "ready_for_manual_submission", requestType: cmd.requestType },
      idempotencyKey: cmd.idempotencyKey,
    });

    return {
      requestId: vreq.id,
      discountRequestId,
      demoLicenseId,
      status: "ready_for_manual_submission",
      revision: 0,
      ownershipRevision: 0,
      idempotent: false,
    };
  });
}

export type ReassignVendorRequestOwnerCommand = {
  authContext: AuthContext;
  requestId: string;
  ownerAssignmentId: string;
  expectedOwnershipRevision: number;
  idempotencyKey: string;
};

export async function reassignVendorRequestOwner(
  cmd: ReassignVendorRequestOwnerCommand,
): Promise<{ requestId: string; ownerAssignmentId: string; ownershipRevision: number; idempotent: boolean }> {
  if (!cmd.requestId || !cmd.ownerAssignmentId || !cmd.idempotencyKey) {
    throw new VendorRequestError("INVALID_COMMAND", "requestId, ownerAssignmentId, and idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const vreq = await tx.vendorRequest.findUniqueOrThrow({ where: { id: cmd.requestId } });

    if (["approved", "rejected", "cancelled", "completed"].includes(vreq.status)) {
      throw new VendorRequestError("TERMINAL_STATUS", "Cannot reassign owner of terminal vendor request", 409);
    }

    if (vreq.ownershipRevision !== cmd.expectedOwnershipRevision) {
      throw new VendorRequestError("STALE_REVISION", "Ownership revision mismatch", 409);
    }

    const targetAssignment = await tx.userCompanyRole.findFirst({
      where: { id: cmd.ownerAssignmentId, companyId: ctx.companyId, status: "active" },
    });
    if (!targetAssignment) {
      throw new VendorRequestError("TARGET_ASSIGNMENT_INVALID", "Target owner assignment is not active in company", 400);
    }

    const actorAssignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });

    const nextOwnershipRev = vreq.ownershipRevision + 1;

    await tx.vendorRequest.update({
      where: { id: vreq.id },
      data: {
        ownerAssignmentId: cmd.ownerAssignmentId,
        ownershipRevision: nextOwnershipRev,
      },
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "vendor-request-event/v1",
      tag: "owner_reassigned",
      requestId: vreq.id,
      ownerAssignmentId: cmd.ownerAssignmentId,
      expectedOwnershipRevision: cmd.expectedOwnershipRevision,
      idempotencyKey: cmd.idempotencyKey,
    }));

    await tx.vendorRequestEvent.create({
      data: {
        requestId: vreq.id,
        actorAssignmentId: actorAssignment?.id ?? cmd.ownerAssignmentId,
        eventType: "owner_reassigned",
        payload: { inputHash, previousOwner: vreq.ownerAssignmentId, newOwner: cmd.ownerAssignmentId, ownershipRevision: nextOwnershipRev },
      },
    });

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: "vendor_request.owner_reassigned",
      actorId: ctx.userId,
      resourceType: "vendor_request",
      resourceId: vreq.id,
      details: { newOwner: cmd.ownerAssignmentId, ownershipRevision: nextOwnershipRev },
      idempotencyKey: cmd.idempotencyKey,
    });

    return {
      requestId: vreq.id,
      ownerAssignmentId: cmd.ownerAssignmentId,
      ownershipRevision: nextOwnershipRev,
      idempotent: false,
    };
  });
}

export type RecordVendorRequestEventCommand = {
  authContext: AuthContext;
  requestId: string;
  event: "record_manual_submission" | "mark_waiting_vendor" | "cancel";
  expectedRevision: number;
  externalReference?: string;
  evidenceArtifactVersionId?: string;
  reason?: string;
  idempotencyKey: string;
};

export async function recordVendorRequestEvent(
  cmd: RecordVendorRequestEventCommand,
): Promise<{ requestId: string; status: VendorRequestStatus; revision: number; idempotent: boolean }> {
  if (!cmd.requestId || !cmd.idempotencyKey) {
    throw new VendorRequestError("INVALID_COMMAND", "requestId and idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const vreq = await tx.vendorRequest.findUniqueOrThrow({ where: { id: cmd.requestId } });

    if (vreq.revision !== cmd.expectedRevision) {
      throw new VendorRequestError("STALE_REVISION", "Vendor request revision mismatch", 409);
    }

    const actorAssignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!actorAssignment) {
      throw new VendorRequestError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    let nextStatus: VendorRequestStatus;
    let eventType: string;
    let auditAction: string;
    const payload: Record<string, unknown> = {};

    if (cmd.event === "record_manual_submission") {
      if (vreq.status !== "ready_for_manual_submission") {
        throw new VendorRequestError("INVALID_SOURCE_STATUS", "Request must be in ready_for_manual_submission status", 409);
      }
      const ref = normalizeString(cmd.externalReference, 128, "externalReference");
      nextStatus = "manually_submitted";
      eventType = "manual_submission_recorded";
      auditAction = "vendor_request.manual_submission_recorded";
      payload.externalReference = ref;
      payload.evidenceArtifactVersionId = cmd.evidenceArtifactVersionId ?? null;
    } else if (cmd.event === "mark_waiting_vendor") {
      if (vreq.status !== "manually_submitted") {
        throw new VendorRequestError("INVALID_SOURCE_STATUS", "Request must be in manually_submitted status", 409);
      }
      nextStatus = "waiting_vendor";
      eventType = "vendor_waiting_acknowledged";
      auditAction = "vendor_request.waiting_vendor_marked";
      payload.evidenceArtifactVersionId = cmd.evidenceArtifactVersionId ?? null;
    } else if (cmd.event === "cancel") {
      if (!["draft", "ready_for_manual_submission", "manually_submitted", "waiting_vendor"].includes(vreq.status)) {
        throw new VendorRequestError("TERMINAL_STATUS", "Cannot cancel terminal request", 409);
      }
      const reason = normalizeString(cmd.reason, 500, "reason");
      nextStatus = "cancelled";
      eventType = "vendor_request_cancelled";
      auditAction = "vendor_request.cancelled";
      payload.reason = reason;
    } else {
      throw new VendorRequestError("INVALID_EVENT", "Unknown event tag", 400);
    }

    const nextRevision = vreq.revision + 1;

    await tx.vendorRequest.update({
      where: { id: vreq.id },
      data: {
        status: nextStatus,
        revision: nextRevision,
        externalReference: (payload.externalReference as string) ?? vreq.externalReference,
      },
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "vendor-request-event/v1",
      tag: cmd.event,
      requestId: vreq.id,
      fromStatus: vreq.status,
      toStatus: nextStatus,
      expectedRevision: cmd.expectedRevision,
      idempotencyKey: cmd.idempotencyKey,
    }));
    payload.inputHash = inputHash;

    await tx.vendorRequestEvent.create({
      data: {
        requestId: vreq.id,
        actorAssignmentId: actorAssignment.id,
        eventType,
        payload: payload as any,
      },
    });

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: auditAction,
      actorId: ctx.userId,
      resourceType: "vendor_request",
      resourceId: vreq.id,
      details: { fromStatus: vreq.status, toStatus: nextStatus, revision: nextRevision },
      idempotencyKey: cmd.idempotencyKey,
    });

    return {
      requestId: vreq.id,
      status: nextStatus,
      revision: nextRevision,
      idempotent: false,
    };
  });
}

export type RecordVendorRequestOutcomeCommand = {
  authContext: AuthContext;
  requestId: string;
  outcome: "approved" | "rejected" | "completed";
  expectedRevision: number;
  evidenceArtifactVersionId?: string;
  externalReference?: string;
  idempotencyKey: string;
};

export async function recordVendorRequestOutcome(
  cmd: RecordVendorRequestOutcomeCommand,
): Promise<{ requestId: string; status: VendorRequestStatus; revision: number; idempotent: boolean }> {
  if (!cmd.requestId || !cmd.idempotencyKey) {
    throw new VendorRequestError("INVALID_COMMAND", "requestId and idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const vreq = await tx.vendorRequest.findUniqueOrThrow({ where: { id: cmd.requestId } });

    if (vreq.status !== "waiting_vendor") {
      throw new VendorRequestError("INVALID_SOURCE_STATUS", "Outcome can only be recorded when status is waiting_vendor", 409);
    }
    if (vreq.revision !== cmd.expectedRevision) {
      throw new VendorRequestError("STALE_REVISION", "Vendor request revision mismatch", 409);
    }

    const actorAssignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!actorAssignment) {
      throw new VendorRequestError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    const nextStatus = cmd.outcome as VendorRequestStatus;
    const nextRevision = vreq.revision + 1;

    await tx.vendorRequest.update({
      where: { id: vreq.id },
      data: {
        status: nextStatus,
        revision: nextRevision,
      },
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "vendor-request-event/v1",
      tag: "outcome_recorded",
      requestId: vreq.id,
      outcome: cmd.outcome,
      expectedRevision: cmd.expectedRevision,
      idempotencyKey: cmd.idempotencyKey,
    }));

    await tx.vendorRequestEvent.create({
      data: {
        requestId: vreq.id,
        actorAssignmentId: actorAssignment.id,
        eventType: `vendor_request_${cmd.outcome}`,
        payload: { inputHash, outcome: cmd.outcome, evidenceArtifactVersionId: cmd.evidenceArtifactVersionId ?? null },
      },
    });

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: `vendor_request.${cmd.outcome}`,
      actorId: ctx.userId,
      resourceType: "vendor_request",
      resourceId: vreq.id,
      details: { outcome: cmd.outcome, revision: nextRevision },
      idempotencyKey: cmd.idempotencyKey,
    });

    return {
      requestId: vreq.id,
      status: nextStatus,
      revision: nextRevision,
      idempotent: false,
    };
  });
}

export async function requireCurrentQuoteVendorReadiness(
  tx: any,
  quoteId: string,
): Promise<{ eligible: boolean; blockers: string[] }> {
  const discounts = await tx.discountRequest.findMany({
    where: { quoteId, vendorRequired: true },
  });

  const blockers: string[] = [];

  for (const disc of discounts) {
    const vreq = await tx.vendorRequest.findFirst({
      where: { discountRequestId: disc.id, quoteId },
    });

    if (!vreq) {
      blockers.push(`Missing paired VendorRequest for discount ${disc.id}`);
      continue;
    }

    if (!["approved", "completed"].includes(vreq.status)) {
      blockers.push(`VendorRequest ${vreq.id} status is '${vreq.status}', required 'approved' or 'completed'`);
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
  };
}
