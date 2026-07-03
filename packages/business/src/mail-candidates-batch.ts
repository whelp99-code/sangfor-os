import { prisma } from "@sangfor/db";

export interface BatchFilter {
  action: "approve" | "reject";
  minConfidence?: number;
}

export interface BatchResult {
  action: "approve" | "reject";
  count: number;
}

/**
 * Batch-approve or batch-reject proposed mail candidates.
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function batchProcessMailCandidates(
  filters: BatchFilter,
): Promise<BatchResult> {
  const { action, minConfidence = 85 } = filters;

  if (action === "approve") {
    // 신뢰도 85% 이상 후보 승인
    const result = await prisma.mailDerivedCandidate.updateMany({
      where: {
        status: "proposed",
        confidence: { gte: minConfidence },
      },
      data: { status: "approved" },
    });

    return { action: "approve", count: result.count };
  }

  // 중복/잘못된 후보 거부
  const result = await prisma.mailDerivedCandidate.updateMany({
    where: {
      status: "proposed",
      OR: [
        { sourceSender: { contains: "nexias.com" }, candidateType: "customer" },
        { sourceSender: { contains: "berlo.com" }, candidateType: "customer" },
      ],
    },
    data: {
      status: "rejected",
      metadata: { rejectionReason: "incorrect_classification" },
    },
  });

  return { action: "reject", count: result.count };
}
