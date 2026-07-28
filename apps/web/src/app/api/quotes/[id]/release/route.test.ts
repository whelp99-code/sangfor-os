import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  releaseGovernedQuote: vi.fn(async () => ({ evaluationId: "eval1", eligible: true, blockers: [] })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: ["ai_quality.review"], product: "portal",
  })),
  CommercialReleaseError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/quotes/[id]/release", () => {
  beforeEach(() => vi.clearAllMocks());

  it("releases quote and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/quotes/q1/release", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedQuoteRevision: 1, artifactId: "art1", expectedArtifactVersionId: "av1",
        expectedArtifactContentHash: "h1", expectedArtifactRevision: 1, assessmentId: "asmt1",
        expectedAssessmentResultHash: "rh1",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "q1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.evaluationId).toBe("eval1");
  });
});
