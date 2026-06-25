import { prisma } from "@ai-portal/db";

import { logStateTransition } from "./audit";

const RISK_LEVELS_REQUIRING_APPROVAL = new Set(["medium", "high"]);

/**
 * Purpose: Block workflow execution until risky command runs are approved.
 * Failure Points: Missing approval row allows bypass; stale pending after approve.
 * Observability: approval_requests, state_transition_logs, notification_events
 */
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
      commandRunId,
      eventType: "approval.required",
      message: `Approval required for ${riskLevel} risk run`,
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
        commandRunId: approval.commandRunId,
        eventType: "approval.approved",
        message: "Command run approved — workflow may proceed",
      },
    });
  }

  return approval;
}
