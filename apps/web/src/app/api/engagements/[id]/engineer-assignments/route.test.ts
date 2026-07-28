import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  assignEngineerToEngagement: vi.fn(async () => ({ id: "ea1", status: "active" })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: [], product: "portal",
  })),
  EngineerEligibilityError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/engagements/[id]/engineer-assignments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("assigns eligible engineer to engagement", async () => {
    const req = new NextRequest("http://localhost/api/engagements/eng1/engineer-assignments", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        requirementId: "req1",
        engineerMembershipId: "m1",
        expectedRequirementSnapshotHash: "hash1",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "eng1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("ea1");
  });
});
