import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  createSupportCase: vi.fn(async () => ({ id: "sc1", status: "open" })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: [], product: "portal",
  })),
  SupportCaseError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/support", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates support case via POST", async () => {
    const req = new NextRequest("http://localhost/api/support", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: "ast1",
        subject: "Issue",
        severity: "critical",
        ownerAssignmentId: "ucr1",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("sc1");
  });
});
