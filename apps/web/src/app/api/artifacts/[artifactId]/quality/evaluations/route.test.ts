import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  completeCurrentAiReleaseEvaluation: vi.fn(async () => ({ evaluationId: "eval1", idempotent: false })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "ceo", permissions: [], product: "portal",
  })),
  AiReleaseEvaluationError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/artifacts/[artifactId]/quality/evaluations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unsupported action quote.internal_release", async () => {
    const req = new NextRequest("http://localhost/api/artifacts/art1/quality/evaluations", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentId: "asmt1", artifactVersionId: "av1", artifactContentHash: "h1",
        expectedAssessmentResultHash: "rh1", expectedArtifactRevision: 1, action: "quote.internal_release",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ artifactId: "art1" }) });
    expect(res.status).toBe(400);
  });

  it("completes evaluation for ai.customer_send and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/artifacts/art1/quality/evaluations", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        assessmentId: "asmt1", artifactVersionId: "av1", artifactContentHash: "h1",
        expectedAssessmentResultHash: "rh1", expectedArtifactRevision: 1, action: "ai.customer_send",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ artifactId: "art1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.evaluationId).toBe("eval1");
  });
});
