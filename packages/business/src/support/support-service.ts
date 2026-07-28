import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { calculateSlaDeadlines, getSlaPolicyMinutes, type SupportSeverity } from "./support-sla";

export class SupportCaseError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "SupportCaseError";
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

export type CreateSupportCaseInput = {
  authContext: AuthContext;
  assetId: string;
  subject: string;
  severity: SupportSeverity;
  ownerAssignmentId: string;
  idempotencyKey: string;
  openedAt: Date;
};

export async function createSupportCase(input: CreateSupportCaseInput) {
  const { authContext, assetId, subject, severity, ownerAssignmentId, idempotencyKey, openedAt } = input;
  const { prisma } = await import("@sangfor/db");

  const asset = await prisma.customerAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) {
    throw new SupportCaseError("SUPPORT_RESOURCE_NOT_FOUND", "Asset not found", 404);
  }

  const { responseMinutes, resolutionMinutes } = getSlaPolicyMinutes(severity);
  const { responseDueAt, resolutionDueAt } = calculateSlaDeadlines(openedAt, severity);

  return withRlsTransaction(rlsScope(authContext), async (tx) => {
    const existing = await tx.supportCase.findFirst({
      where: { assetId, subject, status: "open" },
    });

    if (existing) {
      return existing;
    }

    const caseRow = await tx.supportCase.create({
      data: {
        customerId: asset.customerId,
        assetId,
        subject,
        severity,
        status: "open",
        ownerAssignmentId,
        ownershipRevision: 0,
        revision: 0,
        createdAt: openedAt,
        updatedAt: openedAt,
      },
    });

    const snapshotHash = sha256Hex(canonicalizeRfc8785({
      supportCaseId: caseRow.id,
      severity,
      responseMinutes,
      resolutionMinutes,
      startedAt: openedAt.toISOString(),
      responseDueAt: responseDueAt.toISOString(),
      resolutionDueAt: resolutionDueAt.toISOString(),
    }));

    const policyVersion = await tx.supportSlaPolicyVersion.findFirst({
      where: { severity, retiredAt: null },
      orderBy: [{ effectiveAt: "desc" }, { version: "desc" }],
    });

    if (!policyVersion) {
      throw new SupportCaseError("SUPPORT_SLA_POLICY_NOT_CONFIGURED", `No active SLA policy for severity ${severity}`, 422);
    }

    const policyVersionId = policyVersion.id;

    await tx.supportCaseSlaSnapshot.create({
      data: {
        supportCaseId: caseRow.id,
        policyVersionId,
        severity,
        responseMinutes,
        resolutionMinutes,
        clockKind: "elapsed_24x7",
        startedAt: openedAt,
        responseDueAt,
        resolutionDueAt,
        snapshotHash,
        createdAt: openedAt,
      },
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "support-case-create/v1",
      companyId: authContext.companyId,
      assetId,
      subject,
      severity,
      idempotencyKey,
    }));

    await appendAuditEvent(tx, {
      scope: rlsScope(authContext),
      eventType: "support.case.created",
      actorId: authContext.userId,
      resourceType: "support_case",
      resourceId: caseRow.id,
      details: { inputHash, assetId, severity },
      idempotencyKey,
    });

    return caseRow;
  });
}

export type TransitionSupportCaseCommand = {
  authContext: AuthContext;
  supportCaseId: string;
  action: "respond" | "resolve";
  expectedRevision: number;
  idempotencyKey: string;
  now: Date;
};

export async function transitionSupportCaseStatus(cmd: TransitionSupportCaseCommand) {
  const { authContext, supportCaseId, action, expectedRevision, idempotencyKey, now } = cmd;

  return withRlsTransaction(rlsScope(authContext), async (tx) => {
    const sc = await tx.supportCase.findUniqueOrThrow({
      where: { id: supportCaseId },
    });

    if (sc.revision !== expectedRevision) {
      throw new SupportCaseError("SUPPORT_CASE_REVISION_CONFLICT", `Revision mismatch: expected ${expectedRevision}, found ${sc.revision}`, 409);
    }

    let nextStatus = sc.status;
    const updateData: any = {
      revision: sc.revision + 1,
      updatedAt: now,
    };

    if (action === "respond") {
      if (sc.status !== "open") {
        throw new SupportCaseError("INVALID_TRANSITION", `Cannot respond to case in status ${sc.status}`, 409);
      }
      nextStatus = "in_progress";
      updateData.status = nextStatus;
      updateData.respondedAt = sc.respondedAt ?? now;
    } else if (action === "resolve") {
      if (sc.status !== "in_progress") {
        throw new SupportCaseError("INVALID_TRANSITION", `Cannot resolve case in status ${sc.status}`, 409);
      }
      nextStatus = "resolved";
      updateData.status = nextStatus;
      updateData.resolvedAt = sc.resolvedAt ?? now;
    }

    const updatedCase = await tx.supportCase.update({
      where: { id: sc.id },
      data: updateData,
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "support-case-transition/v1",
      supportCaseId: sc.id,
      action,
      expectedRevision,
      idempotencyKey,
    }));

    await appendAuditEvent(tx, {
      scope: rlsScope(authContext),
      eventType: action === "respond" ? "support.case.responded" : "support.case.resolved",
      actorId: authContext.userId,
      resourceType: "support_case",
      resourceId: sc.id,
      details: { inputHash, fromStatus: sc.status, toStatus: nextStatus },
      idempotencyKey,
    });

    return updatedCase;
  });
}
