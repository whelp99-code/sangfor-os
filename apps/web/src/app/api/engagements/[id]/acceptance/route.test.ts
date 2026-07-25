import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  acceptDeliveryProjection: vi.fn(async () => ({
    acceptanceId: "acc1", engagementId: "eng1", quoteId: "q1", artifactVersionId: "av1", acceptedAt: new Date(),
    createdAssetsCount: 1, createdLicensesCount: 1, createdSubscriptionsCount: 0, idempotent: false,
  })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: [], product: "portal",
  })),
  DeliveryAcceptanceError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/engagements/[id]/acceptance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts delivery projection and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/engagements/eng1/acceptance", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId: "q1", artifactVersionId: "av1" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "eng1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.acceptanceId).toBe("acc1");
  });
});
