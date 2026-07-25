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

import { submitAiQualityReview, AiQualityReviewError } from "./ai-quality-review-service";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "presales_engineer", permissions: [], product: "portal",
};

describe("U054: ai-quality-review-service boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing artifactId", async () => {
    await expect(submitAiQualityReview({
      authContext: CTX, artifactId: "", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "approved", idempotencyKey: "k1",
    })).rejects.toThrow("artifactId required");
  });

  it("rejects invalid decision", async () => {
    await expect(submitAiQualityReview({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "maybe" as any, idempotencyKey: "k1",
    })).rejects.toThrow("approved or rejected");
  });

  it("rejects forbidden caller fields", async () => {
    await expect(submitAiQualityReview({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "approved", idempotencyKey: "k1",
      reviewSlotKey: "forged.slot",
    } as any)).rejects.toThrow("Caller cannot supply");
  });

  it("rejects comment over 1000 chars", async () => {
    await expect(submitAiQualityReview({
      authContext: CTX, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "approved", comment: "x".repeat(1001), idempotencyKey: "k1",
    })).rejects.toThrow("0-1000 chars");
  });

  it("rejects assessor reviewing own assessment via alternate membership", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        artifact: { findUniqueOrThrow: vi.fn(async () => ({ id: "art1", currentVersionId: "av1", currentRevision: 1 })) },
        aiQualityAssessment: { findFirst: vi.fn(async () => ({ id: "asmt1", resultHash: "rh1", policyKey: "proposal.human_review.v1", policyVersion: "1", assessedByAssignmentId: "ucr_assessor", status: "completed" })) },
        userCompanyRole: {
          findFirst: vi.fn(async () => ({ id: "ucr_reviewer_alt", userId: "u1", companyId: "c1", role: "presales_engineer", status: "active" })),
          findUnique: vi.fn(async () => ({ userId: "u1" })),
        },
        aiQualityReview: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn() },
      };
      return cb(tx);
    });

    await expect(submitAiQualityReview({
      authContext: { ...CTX, permissions: ["ai_quality.review" as any] }, artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "approved", idempotencyKey: "k1",
    })).rejects.toMatchObject({ code: "ASSESSOR_CANNOT_REVIEW" });
  });

  it("rejects same user filling slot2 via alternate membership", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        artifact: { findUniqueOrThrow: vi.fn(async () => ({ id: "art1", currentVersionId: "av1", currentRevision: 1 })) },
        aiQualityAssessment: { findFirst: vi.fn(async () => ({ id: "asmt1", resultHash: "rh1", policyKey: "proposal.human_review.v1", policyVersion: "1", assessedByAssignmentId: "ucr_assessor", status: "completed" })) },
        userCompanyRole: {
          findFirst: vi.fn(async () => ({ id: "ucr_slot2_alt", userId: "u1", companyId: "c1", role: "account_manager", status: "active" })),
          findUnique: vi.fn(async () => ({ userId: "u_assessor" })),
          findMany: vi.fn(async () => [{ userId: "u1" }]),
        },
        aiQualityReview: {
          findMany: vi.fn(async () => [
            { reviewSlotKey: "proposal.presales", reviewerAssignmentId: "ucr_slot1", decision: "approved" },
          ]),
          findFirst: vi.fn(async () => null),
          create: vi.fn(),
        },
      };
      return cb(tx);
    });

    await expect(submitAiQualityReview({
      authContext: { ...CTX, userId: "u1", businessRole: "account_manager", permissions: ["ai_quality.review" as any] },
      artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "approved", idempotencyKey: "k2",
    })).rejects.toMatchObject({ code: "DUPLICATE_REVIEWER" });
  });

  it("rejects review when authContext lacks slot capability", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        artifact: { findUniqueOrThrow: vi.fn(async () => ({ id: "art1", currentVersionId: "av1", currentRevision: 1 })) },
        aiQualityAssessment: { findFirst: vi.fn(async () => ({ id: "asmt1", resultHash: "rh1", policyKey: "proposal.human_review.v1", policyVersion: "1", assessedByAssignmentId: "ucr_assessor", status: "completed" })) },
        userCompanyRole: {
          findFirst: vi.fn(async () => ({ id: "ucr_reviewer", userId: "u_reviewer", companyId: "c1", role: "presales_engineer", status: "active" })),
          findUnique: vi.fn(async () => ({ userId: "u_assessor" })),
        },
        aiQualityReview: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn() },
      };
      return cb(tx);
    });

    await expect(submitAiQualityReview({
      authContext: { ...CTX, userId: "u_reviewer", permissions: [] },
      artifactId: "art1", expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1", expectedArtifactRevision: 1,
      assessmentId: "asmt1", expectedAssessmentResultHash: "rh1",
      decision: "approved", idempotencyKey: "k3",
    })).rejects.toMatchObject({ code: "CAPABILITY_MISSING" });
  });
});

