import { describe, expect, it, vi, beforeEach } from "vitest";
import { PATCH } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  reassignVendorRequestOwner: vi.fn(async () => ({ requestId: "vreq1", ownerAssignmentId: "ucr2", ownershipRevision: 1 })),
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

describe("PATCH /api/vendor-requests/[id]/owner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reassigns owner and returns 200", async () => {
    const req = new NextRequest("http://localhost/api/vendor-requests/vreq1/owner", {
      method: "PATCH",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ ownerAssignmentId: "ucr2", expectedOwnershipRevision: 0 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "vreq1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ownershipRevision).toBe(1);
    expect(json.ownerAssignmentId).toBe("ucr2");
  });
});
