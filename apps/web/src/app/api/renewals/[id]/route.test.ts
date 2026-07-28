import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  getScopedRenewalDetail: vi.fn(async () => ({ id: "ren1", status: "pending" })),
  updateRenewalLifecycle: vi.fn(async () => ({ id: "ren1", status: "notified" })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: [], product: "portal",
  })),
  RenewalError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("GET & PATCH /api/renewals/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gets renewal detail", async () => {
    const req = new NextRequest("http://localhost/api/renewals/ren1", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "ren1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("ren1");
  });

  it("patches renewal lifecycle with CAS params", async () => {
    const req = new NextRequest("http://localhost/api/renewals/ren1", {
      method: "PATCH",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedStatus: "pending",
        expectedUpdatedAt: "2026-07-25T12:00:00Z",
        nextStatus: "notified",
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "ren1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("notified");
  });
});
