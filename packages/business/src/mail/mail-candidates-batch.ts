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
 *
 * Approve double-gate: in addition to status="proposed" and confidence >= minConfidence,
 * the candidate must have metadata.aiRevalidation.decision === "approve_candidate".
 * This prevents junk candidates with high LLM confidence from slipping through.
 */
export async function batchProcessMailCandidates(
  filters: BatchFilter,
): Promise<BatchResult> {
  const { action, minConfidence = 85 } = filters;

  if (action === "approve") {
    const candidates = await prisma.mailDerivedCandidate.findMany({
      where: {
        status: "proposed",
        confidence: { gte: minConfidence },
      },
      select: { id: true, metadata: true },
    });

    const approvedIds = candidates
      .filter((c) => {
        const meta = c.metadata as Record<string, unknown> | null;
        const reval = (meta?.aiRevalidation ?? {}) as Record<string, unknown>;
        return reval.decision === "approve_candidate";
      })
      .map((c) => c.id);

    if (approvedIds.length === 0) {
      return { action: "approve", count: 0 };
    }

    const result = await prisma.mailDerivedCandidate.updateMany({
      where: { id: { in: approvedIds } },
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
