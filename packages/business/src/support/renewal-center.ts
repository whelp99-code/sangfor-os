import { prisma } from "@sangfor/db";
import { z } from "zod";

import { recordDecision } from "../governance/ai-decision";

export const RENEWAL_STATUSES = [
  "pending",
  "notified",
  "quote_requested",
  "vendor_quote",
  "delivered",
  "po",
  "renewed",
  "lost",
] as const;

export const updateRenewalSchema = z.object({
  status: z.enum(RENEWAL_STATUSES).optional(),
  notes: z.preprocess((value) => value === "" ? null : value, z.string().nullable().optional()),
});

export async function getRenewalDetail(id: string) {
  return prisma.renewalOpportunity.findUnique({
    where: { id },
    include: { customer: { select: { projectId: true, name: true } } },
  });
}

export async function updateRenewal(id: string, input: z.infer<typeof updateRenewalSchema>) {
  const parsed = updateRenewalSchema.parse(input);
  const existing = await getRenewalDetail(id);
  if (!existing) throw new Error("renewal_not_found");
  const renewal = await prisma.renewalOpportunity.update({
    where: { id },
    data: {
      ...parsed,
      ...(parsed.status === "renewed" ? { renewedAt: new Date() } : {}),
    },
  });
  await recordDecision({
    projectId: existing.customer.projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_edit",
    caseRef: `renewal:${id}`,
    outcome: "corrected",
    humanEdit: parsed,
  });
  return renewal;
}
