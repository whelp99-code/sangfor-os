import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  getApprovalDetail: vi.fn(async () => ({
    approvalId: "apr1", status: "ready_for_human_approval", revision: 0,
    decisionControlsEnabled: true, decisions: [], versionDiff: { kind: "generic", hasDiff: false },
  })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  ApprovalDetailError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("GET /api/approvals/[approvalId]", () => {
  it("returns approval detail", async () => {
    const req = new NextRequest("http://localhost/api/approvals/apr1");
    const res = await GET(req, { params: Promise.resolve({ approvalId: "apr1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approvalId).toBe("apr1");
    expect(json.decisionControlsEnabled).toBe(true);
  });
});
