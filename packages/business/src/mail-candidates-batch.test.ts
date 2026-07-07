import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@sangfor/db";

import { batchProcessMailCandidates } from "./mail-candidates-batch";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@sangfor/db", () => ({
  prisma: {
    mailDerivedCandidate: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    metadata: {
      aiRevalidation: {
        decision: "approve_candidate",
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("batchProcessMailCandidates — approve double gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves candidate with confidence >= minConfidence AND aiRevalidation.decision === 'approve_candidate'", async () => {
    (prisma.mailDerivedCandidate.findMany as any).mockResolvedValue([
      makeCandidate(),
    ]);
    (prisma.mailDerivedCandidate.updateMany as any).mockResolvedValue({
      count: 1,
    });

    const result = await batchProcessMailCandidates({
      action: "approve",
      minConfidence: 85,
    });

    expect(result.count).toBe(1);
    expect(prisma.mailDerivedCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["candidate-1"] } },
      data: { status: "approved" },
    });
  });

  it("does NOT approve candidate with high confidence but non-approve_candidate decision", async () => {
    (prisma.mailDerivedCandidate.findMany as any).mockResolvedValue([
      makeCandidate({
        id: "candidate-2",
        metadata: {
          aiRevalidation: {
            decision: "needs_human_review",
          },
        },
      }),
    ]);

    const result = await batchProcessMailCandidates({
      action: "approve",
      minConfidence: 85,
    });

    expect(result.count).toBe(0);
    expect(prisma.mailDerivedCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("does NOT approve candidate with no aiRevalidation metadata", async () => {
    (prisma.mailDerivedCandidate.findMany as any).mockResolvedValue([
      makeCandidate({
        id: "candidate-3",
        metadata: {},
      }),
    ]);

    const result = await batchProcessMailCandidates({
      action: "approve",
      minConfidence: 85,
    });

    expect(result.count).toBe(0);
    expect(prisma.mailDerivedCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("does NOT approve candidate with null metadata", async () => {
    (prisma.mailDerivedCandidate.findMany as any).mockResolvedValue([
      makeCandidate({
        id: "candidate-4",
        metadata: null,
      }),
    ]);

    const result = await batchProcessMailCandidates({
      action: "approve",
      minConfidence: 85,
    });

    expect(result.count).toBe(0);
    expect(prisma.mailDerivedCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("only approves matching subset when some have approve_candidate and some don't", async () => {
    (prisma.mailDerivedCandidate.findMany as any).mockResolvedValue([
      makeCandidate({ id: "approved-1" }),
      makeCandidate({
        id: "rejected-1",
        metadata: {
          aiRevalidation: { decision: "needs_human_review" },
        },
      }),
      makeCandidate({ id: "approved-2" }),
      makeCandidate({
        id: "rejected-2",
        metadata: {
          aiRevalidation: { decision: "reject" },
        },
      }),
    ]);
    (prisma.mailDerivedCandidate.updateMany as any).mockResolvedValue({
      count: 2,
    });

    const result = await batchProcessMailCandidates({
      action: "approve",
      minConfidence: 85,
    });

    expect(result.count).toBe(2);
    expect(prisma.mailDerivedCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["approved-1", "approved-2"] } },
      data: { status: "approved" },
    });
  });

  it("filters by minConfidence before checking aiRevalidation", async () => {
    (prisma.mailDerivedCandidate.findMany as any).mockResolvedValue([]);

    const result = await batchProcessMailCandidates({
      action: "approve",
      minConfidence: 90,
    });

    expect(result.count).toBe(0);
    expect(prisma.mailDerivedCandidate.findMany).toHaveBeenCalledWith({
      where: {
        status: "proposed",
        confidence: { gte: 90 },
      },
      select: { id: true, metadata: true },
    });
  });
});
