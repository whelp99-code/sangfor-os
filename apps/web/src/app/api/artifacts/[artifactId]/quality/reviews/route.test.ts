import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  submitAiQualityReview: vi.fn(async () => ({ reviewId: "rev1", idempotent: false })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "presales_engineer", permissions: ["ai_quality.review"], product: "portal",
  })),
  AiQualityReviewError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/artifacts/[artifactId]/quality/reviews", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits quality review and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/artifacts/art1/quality/reviews", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentId: "asmt1", artifactVersionId: "av1", artifactContentHash: "h1",
        assessmentResultHash: "rh1", expectedArtifactRevision: 1, decision: "approved",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ artifactId: "art1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.reviewId).toBe("rev1");
  });
});
