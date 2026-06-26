import { prisma } from "@sangfor/db";

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

export interface CommercialApprovalInput {
  quoteId: string;
  opportunityId: string;
  companyId: string;
  reason: string;
}

export async function submitCommercialApproval(input: CommercialApprovalInput) {
  const existing = await prisma.approvalRequest.findFirst({
    where: { reason: { contains: `commercial:${input.quoteId}` }, status: "pending" },
  });
  if (existing) return { approval: existing, created: false as const };

  const approval = await prisma.approvalRequest.create({
    data: {
      status: "pending",
      reason: `commercial:${input.quoteId}:${input.reason}`,
    },
  });

  await prisma.notificationEvent.create({
    data: {
      companyId: input.companyId,
      channel: "internal",
      eventType: "approval.required",
      payloadJson: { quoteId: input.quoteId, opportunityId: input.opportunityId, reason: input.reason },
    },
  });

  await logStateTransition({
    entityType: "approval_request",
    entityId: approval.id,
    fromStatus: null,
    toStatus: "pending",
    actorType: "engine",
    metadata: { reason: input.reason, quoteId: input.quoteId },
  });

  return { approval, created: true as const };
}
