import { prisma } from "@sangfor/db";

import { recordDealRegistrationDecision } from "./ai-decision-deal-registration";

export async function getDealRegistration(opportunityId: string) {
  return prisma.dealRegistration.findUnique({
    where: { opportunityId },
    include: { distributor: true },
  });
}

export type DealRegistrationInput = {
  distributorId?: string | null;
  registrationNumber?: string | null;
  regStatus?: "NOT_SUBMITTED" | "SUBMITTED" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONTESTED";
  protectionExpiresAt?: string | null;
  sprStatus?: string | null;
  partnerTierMargin?: number | null;
  conflictNote?: string | null;
};

export async function upsertDealRegistration(
  opportunityId: string,
  input: DealRegistrationInput,
) {
  if (
    input.partnerTierMargin != null &&
    (input.partnerTierMargin < 0 || input.partnerTierMargin > 100)
  ) {
    throw new Error("partnerTierMargin must be between 0 and 100");
  }

  const data: {
    distributorId?: string | null;
    registrationNumber?: string | null;
    regStatus?: "NOT_SUBMITTED" | "SUBMITTED" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONTESTED";
    protectionExpiresAt?: Date | null;
    sprStatus?: string | null;
    partnerTierMargin?: number | null;
    conflictNote?: string | null;
  } = {};

  if (input.distributorId !== undefined) data.distributorId = input.distributorId;
  if (input.registrationNumber !== undefined) data.registrationNumber = input.registrationNumber;
  if (input.regStatus !== undefined) data.regStatus = input.regStatus;
  if (input.protectionExpiresAt !== undefined) {
    data.protectionExpiresAt = input.protectionExpiresAt
      ? new Date(input.protectionExpiresAt)
      : null;
  }
  if (input.sprStatus !== undefined) data.sprStatus = input.sprStatus;
  if (input.partnerTierMargin !== undefined) data.partnerTierMargin = input.partnerTierMargin;
  if (input.conflictNote !== undefined) data.conflictNote = input.conflictNote;

  const registration = await prisma.dealRegistration.upsert({
    where: { opportunityId },
    create: { opportunityId, ...data },
    update: { ...data },
    include: { distributor: true },
  });

  // S1: unified decision instrumentation for registration approve/reject
  // (best-effort, outside any transaction, never throws). Only APPROVED/REJECTED
  // are treated as human resolution decisions; the helper no-ops otherwise.
  if (input.regStatus === "APPROVED" || input.regStatus === "REJECTED") {
    try {
      const opp = await prisma.opportunity.findUnique({
        where: { id: opportunityId },
        select: { projectId: true },
      });
      if (opp) {
        await recordDealRegistrationDecision({
          projectId: opp.projectId,
          opportunityId,
          regStatus: input.regStatus,
          registrationNumber: registration.registrationNumber,
        });
      }
    } catch (error) {
      // best-effort: never let instrumentation break the write path.
      console.error("[upsertDealRegistration] recordDecision failed (swallowed):", error);
    }
  }

  return registration;
}
