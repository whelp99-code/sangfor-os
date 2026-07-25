import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  createVendorRequest: vi.fn(async () => ({ requestId: "vreq1", status: "ready_for_manual_submission", revision: 0 })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: [], product: "portal",
  })),
  VendorRequestError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/opportunities/[id]/vendor-requests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates vendor request for opportunity and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/opportunities/opp1/vendor-requests", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "special_discount" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "opp1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.requestId).toBe("vreq1");
  });
});
