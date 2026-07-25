import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {},
  Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) },
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("./audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

import { completeCurrentAiReleaseEvaluation, AiReleaseEvaluationError } from "./ai-release-evaluation-service";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("U054: ai-release-evaluation-service boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing artifactId", async () => {
    await expect(completeCurrentAiReleaseEvaluation({
      authContext: CTX, artifactId: "", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      action: "ai.internal_release", idempotencyKey: "k1",
    })).rejects.toThrow("artifactId required");
  });

  it("rejects missing action", async () => {
    await expect(completeCurrentAiReleaseEvaluation({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      action: "", idempotencyKey: "k1",
    })).rejects.toThrow("action required");
  });

  it("rejects forbidden caller fields", async () => {
    await expect(completeCurrentAiReleaseEvaluation({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      action: "ai.internal_release", idempotencyKey: "k1",
      policyKey: "forged.policy",
    } as any)).rejects.toThrow("Caller cannot supply");
  });

  it("rejects unknown wrapper kind in release selector", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        artifact: { findUniqueOrThrow: vi.fn(async () => ({ id: "art1", currentVersionId: "av1", currentRevision: 1, artifactType: "UNKNOWN_KIND" })) },
        aiQualityAssessment: { findFirst: vi.fn(async () => ({ id: "asmt1", resultHash: "rh1", policyKey: "proposal.human_review.v1", policyVersion: "1", qualityPassed: true, status: "completed" })) },
        aiQualityReview: { findMany: vi.fn(async () => []) },
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1", companyId: "c1", role: "ceo", status: "active" })) },
        aiReleaseEvaluation: { findFirst: vi.fn(async () => null), create: vi.fn() },
      };
      return cb(tx);
    });

    await expect(completeCurrentAiReleaseEvaluation({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      action: "ai.internal_release", idempotencyKey: "k1",
    })).rejects.toMatchObject({ code: "UNKNOWN_WRAPPER" });
  });

  it("rejects support_rca in release selector (closed to 3 wrappers)", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        artifact: { findUniqueOrThrow: vi.fn(async () => ({ id: "art1", currentVersionId: "av1", currentRevision: 1, artifactType: "SUPPORT_RCA" })) },
        aiQualityAssessment: { findFirst: vi.fn(async () => ({ id: "asmt1", resultHash: "rh1", policyKey: "support.rca.human_review.v1", policyVersion: "1", qualityPassed: true, status: "completed" })) },
        aiQualityReview: { findMany: vi.fn(async () => []) },
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1", companyId: "c1", role: "ceo", status: "active" })) },
        aiReleaseEvaluation: { findFirst: vi.fn(async () => null), create: vi.fn() },
      };
      return cb(tx);
    });

    await expect(completeCurrentAiReleaseEvaluation({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      action: "support.rca.internal_approval", idempotencyKey: "k1",
    })).rejects.toMatchObject({ code: "UNKNOWN_WRAPPER" });
  });
});
