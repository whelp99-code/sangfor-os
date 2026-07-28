import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  previewOwnershipTransfer: vi.fn(async () => ({
    previewSchemaVersion: "ownership-transfer/v1",
    transferRequired: true,
    itemCount: 1,
    tuples: [{ entityType: "Artifact", entityId: "art1", ownerAssignmentId: "src1", ownershipRevision: 0 }],
    previewHash: "a".repeat(64),
    membershipRevision: 0,
    expectedMembershipRevision: 0,
    approvalRequestRevision: 0,
    successorEligibility: "required",
    immutableHistoryExclusions: [],
  })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  OwnershipTransferError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/security/ownership-transfers/preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with preview for valid body", async () => {
    const req = new NextRequest("http://localhost/api/security/ownership-transfers/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleChangeRequestId: "rcr1", successorAssignmentId: "succ1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transferRequired).toBe(true);
    expect(json.previewSchemaVersion).toBe("ownership-transfer/v1");
  });

  it("returns 400 if Idempotency-Key header is sent", async () => {
    const req = new NextRequest("http://localhost/api/security/ownership-transfers/preview", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ roleChangeRequestId: "rcr1", successorAssignmentId: "succ1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
