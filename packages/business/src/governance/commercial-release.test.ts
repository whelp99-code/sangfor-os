import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  completeCurrentAiReleaseEvaluation: vi.fn(),
  evaluateCommercialApproval: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("./ai-release-evaluation-service", () => ({
  completeCurrentAiReleaseEvaluation: mocks.completeCurrentAiReleaseEvaluation,
}));

vi.mock("./commercial-approval", () => ({
  evaluateCommercialApproval: mocks.evaluateCommercialApproval,
}));

import { releaseGovernedQuote, CommercialReleaseError } from "./commercial-release";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: ["ai_quality.review" as any], product: "portal",
};

describe("U055: commercial-release service unit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid command parameters", async () => {
    await expect(releaseGovernedQuote({
      authContext: CTX, quoteId: "", artifactId: "art1", assessmentId: "asmt1", idempotencyKey: "k1",
      expectedArtifactVersionId: "av1", expectedArtifactContentHash: "h1", expectedArtifactRevision: 1, expectedAssessmentResultHash: "rh1",
    })).rejects.toThrow("quoteId is required");
  });

  it("rejects when commercial approval prerequisite is blocked", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        quote: { findUniqueOrThrow: vi.fn(async () => ({ id: "q1", version: 1, totalRevenue: 1000, totalCost: 900 })) },
      };
      return cb(tx);
    });

    mocks.evaluateCommercialApproval.mockReturnValue({
      blocked: true,
      reasons: ["low_margin", "high_discount"],
    });

    await expect(releaseGovernedQuote({
      authContext: CTX,
      quoteId: "q1",
      expectedQuoteRevision: 1,
      artifactId: "art1",
      expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "hash1",
      expectedArtifactRevision: 1,
      assessmentId: "asmt1",
      expectedAssessmentResultHash: "rhash1",
      idempotencyKey: "k-rel-1",
    })).rejects.toMatchObject({ code: "COMMERCIAL_APPROVAL_REQUIRED", httpStatus: 409 });
  });

  it("evaluates commercial prerequisite and delegates release evaluation to U054", async () => {
    const now = new Date();
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        quote: { findUniqueOrThrow: vi.fn(async () => ({ id: "q1", version: 1, totalRevenue: 10000, totalCost: 5000 })) },
        aiReleaseEvaluation: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "eval1", evaluationKey: "ekey1", artifactVersionId: "av1", action: "quote.internal_release",
            policyKey: "quote.internal_release.human_review.v1", eligible: true, blockers: [], evaluatedAt: now,
          })),
        },
      };
      return cb(tx);
    });

    mocks.evaluateCommercialApproval.mockReturnValue({
      blocked: false,
      reasons: [],
    });

    mocks.completeCurrentAiReleaseEvaluation.mockResolvedValue({
      evaluationId: "eval1", idempotent: false,
    });

    const result = await releaseGovernedQuote({
      authContext: CTX,
      quoteId: "q1",
      expectedQuoteRevision: 1,
      artifactId: "art1",
      expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "hash1",
      expectedArtifactRevision: 1,
      assessmentId: "asmt1",
      expectedAssessmentResultHash: "rhash1",
      idempotencyKey: "k-rel-1",
    });

    expect(result.evaluationId).toBe("eval1");
    expect(result.eligible).toBe(true);
    expect(mocks.completeCurrentAiReleaseEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quote.internal_release",
        artifactId: "art1",
      }),
    );
  });
});
