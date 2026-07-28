import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  createOwnershipTransfer: vi.fn(async () => ({ ownershipTransferId: "ot1", status: "requested", revision: 0, previewHash: "a".repeat(64), itemCount: 1 })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  OwnershipTransferError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/security/ownership-transfers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates transfer and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/security/ownership-transfers", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ roleChangeRequestId: "rcr1", successorAssignmentId: "succ1", previewHash: "a".repeat(64) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("requested");
  });

  it("returns 400 without Idempotency-Key", async () => {
    const req = new NextRequest("http://localhost/api/security/ownership-transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleChangeRequestId: "rcr1", successorAssignmentId: "succ1", previewHash: "a".repeat(64) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
