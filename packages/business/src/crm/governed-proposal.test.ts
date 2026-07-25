import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  createArtifactVersion: vi.fn(),
  completeCurrentAiQualityAssessment: vi.fn(),
  requireCurrentAiReleaseEvaluation: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/artifact-service", () => ({
  createArtifactVersion: mocks.createArtifactVersion,
}));

vi.mock("../governance/ai-quality-service", () => ({
  completeCurrentAiQualityAssessment: mocks.completeCurrentAiQualityAssessment,
}));

vi.mock("../governance/ai-release-evaluation-service", () => ({
  requireCurrentAiReleaseEvaluation: mocks.requireCurrentAiReleaseEvaluation,
}));

import { generateGovernedProposal, GovernedProposalError } from "./governed-proposal";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "presales_engineer", permissions: ["ai_quality.review" as any], product: "portal",
};

describe("U055: governed-proposal service unit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid title or idempotencyKey", async () => {
    await expect(generateGovernedProposal({
      authContext: CTX, title: "", idempotencyKey: "k1",
    })).rejects.toThrow("title is required");

    await expect(generateGovernedProposal({
      authContext: CTX, title: "Valid Title", idempotencyKey: "",
    })).rejects.toThrow("idempotencyKey is required");
  });

  it("rejects when caller has no active company assignment", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        userCompanyRole: { findFirst: vi.fn(async () => null) },
      };
      return cb(tx);
    });

    await expect(generateGovernedProposal({
      authContext: CTX, title: "Test Proposal", idempotencyKey: "k1",
    })).rejects.toThrow("No active same-company assignment");
  });

  it("delegates to U054 completeCurrentAiQualityAssessment and returns release status", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        artifact: { create: vi.fn(async () => ({ id: "art1" })) },
        aiQualityAssessment: { findUniqueOrThrow: vi.fn(async () => ({ id: "asmt1", resultHash: "rhash1", qualityPassed: true })) },
      };
      return cb(tx);
    });

    mocks.createArtifactVersion.mockResolvedValue({
      versionId: "av1", contentHash: "chash1", revision: 1,
    });

    mocks.completeCurrentAiQualityAssessment.mockResolvedValue({
      assessmentId: "asmt1", idempotent: false,
    });

    mocks.requireCurrentAiReleaseEvaluation.mockImplementation(async (_tx: any, action: string) => {
      return { evaluationId: `eval-${action}`, eligible: true, blockers: [] };
    });

    const result = await generateGovernedProposal({
      authContext: CTX,
      opportunityId: "opp1",
      title: "Valid Proposal Title",
      idempotencyKey: "k-prop-1",
    });

    expect(result.artifactId).toBe("art1");
    expect(result.versionId).toBe("av1");
    expect(result.assessmentId).toBe("asmt1");
    expect(result.qualityPassed).toBe(true);
    expect(result.internalReleaseAllowed).toBe(true);
    expect(result.customerSendAllowed).toBe(true);
    expect(mocks.completeCurrentAiQualityAssessment).toHaveBeenCalledTimes(1);
  });
});
