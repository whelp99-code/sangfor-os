import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    artifact: { findUniqueOrThrow: vi.fn() },
    artifactVersion: { findUnique: vi.fn() },
    aiQualityAssessment: { findFirst: vi.fn(), create: vi.fn() },
    aiQualityEvidence: { create: vi.fn() },
    aiPromptSnapshot: { create: vi.fn() },
    aiModelSnapshot: { create: vi.fn() },
    userCompanyRole: { findFirst: vi.fn() },
  },
  appendAuditEvent: vi.fn(),
  withRlsTransaction: vi.fn(),
  canonicalizeRfc8785: vi.fn((v: unknown) => JSON.stringify(v)),
}));

vi.mock("@sangfor/db", () => ({
  prisma: mocks.prisma,
  Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) },
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: mocks.canonicalizeRfc8785,
}));

vi.mock("./audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

describe("U054 RED: ai-quality-service boundary invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RED: no completeCurrentAiQualityAssessment export exists yet", async () => {
    const mod = await import("./ai-quality-service");
    expect(typeof mod.completeCurrentAiQualityAssessment).toBe("function");
  });

  it("RED: command rejects missing artifactId", async () => {
    const { completeCurrentAiQualityAssessment, AiQualityServiceError } = await import("./ai-quality-service");
    await expect(
      completeCurrentAiQualityAssessment({
        authContext: { userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1", businessRole: "ceo", permissions: [], product: "portal" },
        artifactId: "",
        expectedArtifactVersionId: "av1",
        expectedArtifactContentHash: "h1",
        expectedArtifactRevision: 1,
        idempotencyKey: "key1",
      }),
    ).rejects.toThrow();
  });

  it("RED: command rejects missing idempotencyKey", async () => {
    const { completeCurrentAiQualityAssessment } = await import("./ai-quality-service");
    await expect(
      completeCurrentAiQualityAssessment({
        authContext: { userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1", businessRole: "ceo", permissions: [], product: "portal" },
        artifactId: "art1",
        expectedArtifactVersionId: "av1",
        expectedArtifactContentHash: "h1",
        expectedArtifactRevision: 1,
        idempotencyKey: "",
      }),
    ).rejects.toThrow();
  });

  it("RED: caller cannot inject score, policy, status, or hash", async () => {
    const { completeCurrentAiQualityAssessment } = await import("./ai-quality-service");
    const forgedInput = {
      authContext: { userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1", businessRole: "ceo", permissions: [], product: "portal" },
      artifactId: "art1",
      expectedArtifactVersionId: "av1",
      expectedArtifactContentHash: "h1",
      expectedArtifactRevision: 1,
      idempotencyKey: "key1",
      score: 100,
      policyKey: "forged.policy",
      status: "approved",
      resultHash: "forged-hash",
      qualityPassed: true,
    };
    await expect(completeCurrentAiQualityAssessment(forgedInput as any)).rejects.toThrow();
  });

  it("RED: evaluator failure inserts zero rows", async () => {
    const { completeCurrentAiQualityAssessment } = await import("./ai-quality-service");
    mocks.withRlsTransaction.mockImplementation(async (_scope: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        artifact: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "art1",
            currentVersionId: "av1",
            currentRevision: 1,
            ownerAssignmentId: "ucr1",
            artifactType: "PROPOSAL",
          })),
        },
        artifactVersion: {
          findUnique: vi.fn(async () => ({
            id: "av1",
            contentHash: "h1",
            artifactId: "art1",
          })),
        },
        aiQualityAssessment: { findFirst: vi.fn(async () => null), create: vi.fn() },
        aiQualityEvidence: { create: vi.fn() },
        aiPromptSnapshot: { create: vi.fn() },
        aiModelSnapshot: { create: vi.fn() },
        userCompanyRole: {
          findFirst: vi.fn(async () => ({
            id: "ucr1",
            userId: "u1",
            companyId: "c1",
            role: "ceo",
            status: "active",
          })),
        },
      };
      return cb(tx);
    });

    await expect(
      completeCurrentAiQualityAssessment({
        authContext: { userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1", businessRole: "ceo", permissions: [], product: "portal" },
        artifactId: "art1",
        expectedArtifactVersionId: "av1",
        expectedArtifactContentHash: "h1",
        expectedArtifactRevision: 1,
        idempotencyKey: "key1",
      }),
    ).rejects.toThrow();

    expect(mocks.prisma.aiQualityAssessment.create).not.toHaveBeenCalled();
  });
});
