import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  recordVendorRequestOutcome: vi.fn(async () => ({ requestId: "vreq1", status: "approved", revision: 3 })),
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

describe("POST /api/vendor-requests/[id]/outcomes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records vendor outcome and returns 200", async () => {
    const req = new NextRequest("http://localhost/api/vendor-requests/vreq1/outcomes", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "approved", expectedRevision: 2 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "vreq1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("approved");
    expect(json.revision).toBe(3);
  });
});
