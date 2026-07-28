import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  createArtifactVersion: vi.fn(),
  completeCurrentAiQualityAssessment: vi.fn(),
  requireCurrentAiReleaseEvaluation: vi.fn(),
  recordHumanDecision: vi.fn(),
  promoteDomainProposalToDocument: vi.fn(),
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

vi.mock("./project-decision", () => ({
  recordHumanDecision: mocks.recordHumanDecision,
}));

vi.mock("./proposal-promote", () => ({
  promoteDomainProposalToDocument: mocks.promoteDomainProposalToDocument,
}));

import {
  generateGovernedDomainProposal,
  recordGovernedHumanDecision,
  GovernedDomainProposalError,
} from "./governed-domain-proposal";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "solution_architect", permissions: ["ai_quality.review" as any], product: "portal",
};

describe("U055: governed-domain-proposal service unit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing engagementId or idempotencyKey", async () => {
    await expect(generateGovernedDomainProposal({
      authContext: CTX, engagementId: "", domain: "presales", idempotencyKey: "k1",
    })).rejects.toThrow("engagementId is required");

    await expect(generateGovernedDomainProposal({
      authContext: CTX, engagementId: "eng1", domain: "presales", idempotencyKey: "",
    })).rejects.toThrow("idempotencyKey is required");
  });

  it("delegates to U054 completeCurrentAiQualityAssessment for domain proposal", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        engagement: { findUniqueOrThrow: vi.fn(async () => ({ id: "eng1", title: "Test Engagement" })) },
        artifact: { create: vi.fn(async () => ({ id: "art_dom1" })) },
        aiQualityAssessment: { findUniqueOrThrow: vi.fn(async () => ({ id: "asmt_dom1", resultHash: "rhash1", qualityPassed: true })) },
      };
      return cb(tx);
    });

    mocks.createArtifactVersion.mockResolvedValue({
      versionId: "av_dom1", contentHash: "chash1", revision: 1,
    });

    mocks.completeCurrentAiQualityAssessment.mockResolvedValue({
      assessmentId: "asmt_dom1", idempotent: false,
    });

    mocks.requireCurrentAiReleaseEvaluation.mockImplementation(async (_tx: any, action: string) => {
      return { evaluationId: `eval-${action}`, eligible: true, blockers: [] };
    });

    const result = await generateGovernedDomainProposal({
      authContext: CTX,
      engagementId: "eng1",
      domain: "presales",
      idempotencyKey: "k-dom-1",
    });

    expect(result.artifactId).toBe("art_dom1");
    expect(result.versionId).toBe("av_dom1");
    expect(result.assessmentId).toBe("asmt_dom1");
    expect(result.qualityPassed).toBe(true);
    expect(mocks.completeCurrentAiQualityAssessment).toHaveBeenCalledTimes(1);
  });

  it("records governed human decision and promotes document when approved", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        artifact: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "art1", currentVersionId: "av1", currentRevision: 1, title: "Proposal Title",
          })),
        },
      };
      return cb(tx);
    });

    mocks.recordHumanDecision.mockResolvedValue({ decisionId: "dec1" });
    mocks.promoteDomainProposalToDocument.mockResolvedValue({ documentId: "doc1" });

    const result = await recordGovernedHumanDecision({
      authContext: CTX,
      engagementId: "eng1",
      artifactId: "art1",
      expectedArtifactVersionId: "av1",
      expectedArtifactRevision: 1,
      decision: "approved",
      idempotencyKey: "k-dec-1",
    });

    expect(result.decisionId).toBe("dec1");
    expect(result.promotedDocumentId).toBe("doc1");
    expect(mocks.recordHumanDecision).toHaveBeenCalledTimes(1);
    expect(mocks.promoteDomainProposalToDocument).toHaveBeenCalledTimes(1);
  });
});
