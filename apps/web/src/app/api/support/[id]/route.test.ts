import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    supportCase: {
      findUnique: vi.fn(async () => ({ id: "sc1", status: "open" })),
    },
  },
}));

vi.mock("@sangfor/business", () => ({
  transitionSupportCaseStatus: vi.fn(async () => ({ id: "sc1", status: "in_progress" })),
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

describe("GET & PATCH /api/support/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gets support case detail", async () => {
    const req = new NextRequest("http://localhost/api/support/sc1");
    const res = await GET(req, { params: Promise.resolve({ id: "sc1" }) });
    expect(res.status).toBe(200);
  });

  it("patches support case status via respond", async () => {
    const req = new NextRequest("http://localhost/api/support/sc1", {
      method: "PATCH",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "respond", expectedRevision: 0 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "sc1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("in_progress");
  });
});
