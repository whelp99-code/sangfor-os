import { prisma } from "@sangfor/db";

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

  return prisma.dealRegistration.upsert({
    where: { opportunityId },
    create: { opportunityId, ...data },
    update: { ...data },
    include: { distributor: true },
  });
}
