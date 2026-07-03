import { prisma } from "@sangfor/db";

export interface CleanupStats {
  duplicatesRemoved: number;
  nexiasFixed: number;
}

/**
 * Clean up proposed mail candidates:
 * 1. Reject duplicate customer candidates from the same sender (keep highest confidence).
 * 2. Reclassify nexias.com customer candidates as partner candidates.
 *
 * NOTE: the nexias.com special-case is preserved as-is from the original route
 * (structural extraction only, behavior unchanged — see Phase 3 plan §11-D).
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function cleanupMailCandidates(): Promise<CleanupStats> {
  // 1. 같은 발신자의 고객 후보 중복 제거
  const customers = await prisma.mailDerivedCandidate.findMany({
    where: { candidateType: "customer", status: "proposed" },
    orderBy: { confidence: "desc" },
  });

  const seenSenders = new Set<string>();
  let duplicatesRemoved = 0;

  for (const customer of customers) {
    const sender = customer.sourceSender?.toLowerCase() || "";
    if (seenSenders.has(sender)) {
      await prisma.mailDerivedCandidate.update({
        where: { id: customer.id },
        data: {
          status: "rejected",
          metadata: { ...(customer.metadata as any), rejectionReason: "duplicate" },
        },
      });
      duplicatesRemoved++;
    } else {
      seenSenders.add(sender);
    }
  }

  // 2. nexias.com 고객 후보를 파트너로 변경
  const nexiasCustomers = await prisma.mailDerivedCandidate.findMany({
    where: {
      candidateType: "customer",
      sourceSender: { contains: "nexias.com" },
      status: "proposed",
    },
  });

  let nexiasFixed = 0;
  for (const candidate of nexiasCustomers) {
    await prisma.mailDerivedCandidate.update({
      where: { id: candidate.id },
      data: {
        candidateType: "partner",
        title: candidate.title.replace("Customer:", "Partner:"),
        metadata: { ...(candidate.metadata as any), fixedReason: "nexias_is_partner" },
      },
    });
    nexiasFixed++;
  }

  return { duplicatesRemoved, nexiasFixed };
}
