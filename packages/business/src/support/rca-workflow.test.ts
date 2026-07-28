import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  completeCurrentAiQualityAssessment: vi.fn(),
  createApprovalRequest: vi.fn(),
  prisma: {
    supportCase: { findUniqueOrThrow: vi.fn() },
    aiQualityAssessment: { findUnique: vi.fn() },
    aiQualityReview: { findMany: vi.fn() },
  },
}));

vi.mock("@sangfor/db", () => ({
  prisma: mocks.prisma,
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

vi.mock("../governance/ai-quality-service", () => ({
  completeCurrentAiQualityAssessment: mocks.completeCurrentAiQualityAssessment,
}));

vi.mock("../governance/approval-kernel", () => ({
  createApprovalRequest: mocks.createApprovalRequest,
}));

import { setCurrentRcaArtifactVersion, assessCurrentRca, requestRcaInternalApproval, closeSupportCase } from "./rca-workflow";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "support_engineer", permissions: [], product: "portal",
};

describe("U057: rca-workflow unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("set_current updates rcaArtifactVersionId with CAS", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        supportCase: {
          findUniqueOrThrow: vi.fn(async () => ({ id: "sc1", revision: 0, rcaArtifactVersionId: null })),
          update: vi.fn(async () => ({ id: "sc1", rcaArtifactVersionId: "av1", revision: 1 })),
        },
      };
      return cb(tx);
    });

    const res: any = await setCurrentRcaArtifactVersion({
      authContext: CTX,
      supportCaseId: "sc1",
      artifactVersionId: "av1",
      artifactContentHash: "a".repeat(64),
      expectedRevision: 0,
      idempotencyKey: "k1",
      now: new Date(),
    });

    expect(res.rcaArtifactVersionId).toBe("av1");
    expect(res.revision).toBe(1);
  });

  it("assess_current delegates to U054 completeCurrentAiQualityAssessment", async () => {
    mocks.prisma.supportCase.findUniqueOrThrow.mockResolvedValue({
      id: "sc1", revision: 0, rcaArtifactVersionId: "av1",
    });
    mocks.completeCurrentAiQualityAssessment.mockResolvedValue({ id: "asm1", status: "completed" });

    const res: any = await assessCurrentRca({
      authContext: CTX,
      supportCaseId: "sc1",
      artifactVersionId: "av1",
      artifactContentHash: "a".repeat(64),
      expectedRevision: 0,
      expectedArtifactRevision: 1,
      idempotencyKey: "k2",
    });

    expect(res.id).toBe("asm1");
    expect(mocks.completeCurrentAiQualityAssessment).toHaveBeenCalledOnce();
  });

  it("close transitions resolved→closed atomically", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        supportCase: {
          findUniqueOrThrow: vi.fn(async () => ({ id: "sc1", status: "resolved", revision: 2 })),
          update: vi.fn(async () => ({ id: "sc1", status: "closed", revision: 3, closedAt: new Date() })),
        },
      };
      return cb(tx);
    });

    const res: any = await closeSupportCase({
      authContext: CTX,
      supportCaseId: "sc1",
      expectedRevision: 2,
      idempotencyKey: "k-close",
      now: new Date(),
    });

    expect(res.status).toBe("closed");
    expect(res.revision).toBe(3);
  });
});
