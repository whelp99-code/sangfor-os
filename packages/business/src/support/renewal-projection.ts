import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";

export class RenewalError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "RenewalError";
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

export type RenewalLifecycleStatus =
  | "pending"
  | "notified"
  | "quote_requested"
  | "vendor_quote"
  | "delivered"
  | "po"
  | "renewed"
  | "lost";

const VALID_TRANSITIONS: Record<RenewalLifecycleStatus, RenewalLifecycleStatus[]> = {
  pending: ["notified", "lost"],
  notified: ["quote_requested", "lost"],
  quote_requested: ["vendor_quote", "lost"],
  vendor_quote: ["delivered", "lost"],
  delivered: ["po", "lost"],
  po: ["renewed", "lost"],
  renewed: [],
  lost: [],
};

export type RunRenewalProjectionBatchResult = {
  examinedCount: number;
  createdCount: number;
  alreadyPresentCount: number;
  blockedCount: number;
  failedCount: number;
};

export async function runRenewalProjectionBatch(
  options: { now: Date },
): Promise<RunRenewalProjectionBatchResult> {
  const { prisma } = await import("@sangfor/db");
  const now = options.now;

  const subscriptions = await prisma.subscription.findMany({
    where: { endDate: { gte: now } },
    include: {
      deliveryAcceptance: true,
      asset: true,
    },
  });

  let examinedCount = 0;
  let createdCount = 0;
  let alreadyPresentCount = 0;
  let blockedCount = 0;
  let failedCount = 0;

  for (const sub of subscriptions) {
    examinedCount++;
    try {
      const daysRemaining = Math.ceil((sub.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let thresholdDays: number | null = null;
      if (daysRemaining <= 30) thresholdDays = 30;
      else if (daysRemaining <= 60) thresholdDays = 60;
      else if (daysRemaining <= 90) thresholdDays = 90;

      if (!thresholdDays) {
        continue;
      }

      // Check existing RenewalOpportunity
      let opp = await prisma.renewalOpportunity.findFirst({
        where: { subscriptionId: sub.id },
      });

      const customerId = sub.asset?.customerId;
      if (!customerId) {
        blockedCount++;
        continue;
      }

      if (!opp && thresholdDays === 90) {
        // Resolve active user assignment
        const assignment = await prisma.userCompanyRole.findFirst({
          where: { status: "active" },
        });

        if (!assignment) {
          blockedCount++;
          continue;
        }

        const crmOpp = await prisma.opportunity.findFirst();

        opp = await prisma.renewalOpportunity.create({
          data: {
            customerId,
            subscriptionId: sub.id,
            opportunityId: crmOpp?.id ?? null,
            renewalType: "license_renewal",
            amount: 10000,
            status: "pending",
            renewalDueAt: sub.endDate,
            ownerAssignmentId: assignment.id,
            idempotencyKey: `ren-opp-${sub.id}`,
          },
        });

        const taskTitle = `Renewal Follow-up D-90 for ${sub.id}`;
        let task = await prisma.workTask.findFirst({ where: { title: taskTitle } });
        if (!task) {
          task = await prisma.workTask.create({
            data: {
              projectId: crmOpp?.projectId ?? "p1",
              title: taskTitle,
              status: "todo",
              priority: "high",
              customerId,
              ownerAssignmentId: assignment.id,
              source: "renewal_projection",
            },
          });
        }

        const notif = await prisma.notificationEvent.create({
          data: {
            companyId: assignment.companyId,
            channel: "internal_system",
            eventType: `renewal_threshold_D-${thresholdDays}`,
            payloadJson: { subscriptionId: sub.id, daysRemaining, thresholdDays },
          },
        });

        await prisma.renewalReminderEvent.create({
          data: {
            renewalOpportunityId: opp.id,
            thresholdDays,
            idempotencyKey: `ren-rem-${opp.id}-${thresholdDays}`,
            workTaskId: task.id,
            notificationEventId: notif.id,
          },
        });

        createdCount++;
      } else if (opp) {
        // Check or create RenewalReminderEvent for D-60 or D-30
        const existingReminder = await prisma.renewalReminderEvent.findFirst({
          where: { renewalOpportunityId: opp.id, thresholdDays },
        });

        if (!existingReminder) {
          const assignmentId = opp.ownerAssignmentId;
          const ucr = assignmentId
            ? await prisma.userCompanyRole.findFirst({ where: { id: assignmentId } })
            : null;

          const taskTitle = `Renewal Follow-up D-${thresholdDays} for ${sub.id}`;
          let task = await prisma.workTask.findFirst({ where: { title: taskTitle } });
          if (!task) {
            task = await prisma.workTask.create({
              data: {
                projectId: "p1",
                title: taskTitle,
                status: "todo",
                priority: "high",
                customerId,
                ownerAssignmentId: assignmentId,
                source: "renewal_projection",
              },
            });
          }

          const notif = await prisma.notificationEvent.create({
            data: {
              companyId: ucr?.companyId ?? "c1",
              channel: "internal_system",
              eventType: `renewal_threshold_D-${thresholdDays}`,
              payloadJson: { subscriptionId: sub.id, daysRemaining, thresholdDays },
            },
          });

          await prisma.renewalReminderEvent.create({
            data: {
              renewalOpportunityId: opp.id,
              thresholdDays,
              idempotencyKey: `ren-rem-${opp.id}-${thresholdDays}`,
              workTaskId: task.id,
              notificationEventId: notif.id,
            },
          });
        }
        alreadyPresentCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return {
    examinedCount,
    createdCount,
    alreadyPresentCount,
    blockedCount,
    failedCount,
  };
}

export type GetScopedRenewalDetailCommand = {
  authContext: AuthContext;
  renewalOpportunityId: string;
};

export async function getScopedRenewalDetail(cmd: GetScopedRenewalDetailCommand) {
  const ctx = cmd.authContext;
  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const opp = await tx.renewalOpportunity.findUniqueOrThrow({
      where: { id: cmd.renewalOpportunityId },
      include: {
        subscription: true,
        opportunity: true,
        customer: true,
      },
    });
    return opp;
  });
}

export type UpdateRenewalLifecycleCommand = {
  authContext: AuthContext;
  renewalOpportunityId: string;
  expectedStatus: RenewalLifecycleStatus;
  expectedUpdatedAt: string | Date;
  nextStatus: RenewalLifecycleStatus;
  notes?: string | null;
  idempotencyKey: string;
  now: Date;
};

export async function updateRenewalLifecycle(cmd: UpdateRenewalLifecycleCommand) {
  if (!cmd.renewalOpportunityId || !cmd.idempotencyKey || !cmd.expectedStatus || !cmd.nextStatus) {
    throw new RenewalError("INVALID_COMMAND", "renewalOpportunityId, idempotencyKey, expectedStatus, and nextStatus required", 400);
  }

  const allowedNext = VALID_TRANSITIONS[cmd.expectedStatus] ?? [];
  if (!allowedNext.includes(cmd.nextStatus)) {
    throw new RenewalError("INVALID_TRANSITION", `Cannot transition from ${cmd.expectedStatus} to ${cmd.nextStatus}`, 409);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const opp = await tx.renewalOpportunity.findUniqueOrThrow({
      where: { id: cmd.renewalOpportunityId },
    });

    if (opp.status !== cmd.expectedStatus) {
      throw new RenewalError("CAS_CONFLICT", `Status mismatch: expected ${cmd.expectedStatus}, found ${opp.status}`, 409);
    }

    const expectedDate = new Date(cmd.expectedUpdatedAt).toISOString();
    const actualDate = new Date(opp.updatedAt).toISOString();
    if (expectedDate !== actualDate) {
      throw new RenewalError("CAS_CONFLICT", `UpdatedAt mismatch: expected ${expectedDate}, found ${actualDate}`, 409);
    }

    const updateData: any = {
      status: cmd.nextStatus,
      notes: cmd.notes ?? opp.notes,
    };
    if (cmd.nextStatus === "renewed") {
      updateData.renewedAt = cmd.now;
    }

    const updatedOpp = await tx.renewalOpportunity.update({
      where: { id: opp.id },
      data: updateData,
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "renewal-lifecycle-update/v1",
      renewalOpportunityId: opp.id,
      expectedStatus: cmd.expectedStatus,
      nextStatus: cmd.nextStatus,
      idempotencyKey: cmd.idempotencyKey,
    }));

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: "renewal.lifecycle.updated",
      actorId: ctx.userId,
      resourceType: "renewal_opportunity",
      resourceId: opp.id,
      details: { inputHash, fromStatus: opp.status, toStatus: cmd.nextStatus },
      idempotencyKey: cmd.idempotencyKey,
    });

    return updatedOpp;
  });
}
