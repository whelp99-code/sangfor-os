import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  closeSupportCase: vi.fn(async () => ({ id: "sc1", status: "closed", revision: 3 })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "support_engineer", permissions: [], product: "portal",
  })),
  SupportCaseError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST /api/support/[id]/close", () => {
  beforeEach(() => vi.clearAllMocks());

  it("closes support case from resolved status", async () => {
    const req = new NextRequest("http://localhost/api/support/sc1/close", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 2 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "sc1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("closed");
  });
});
