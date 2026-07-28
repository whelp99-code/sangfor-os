import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  finalizeRoleChangeAfterOwnershipTransfer: vi.fn(async () => ({
    ownershipTransferId: "ot1", ownershipTransferRevision: 2, status: "completed",
    roleChangeRequestId: "rcr1", itemCount: 1, previewHash: "a".repeat(64),
    sourceAssignmentId: "src1", successorAssignmentId: "succ1",
    completionAuditLogId: "audit1", ownershipDisposition: "transferred",
  })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  OwnershipTransferError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/security/ownership-transfers/[id]/execute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("executes transfer and returns 200 with ownershipDisposition=transferred", async () => {
    const req = new NextRequest("http://localhost/api/security/ownership-transfers/ot1/execute", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedTransferRevision: 0, expectedApprovalRevision: 0, previewHash: "a".repeat(64) }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "ot1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(json["Idempotent-Replay"]).toBe(false);
  });

  it("returns 400 with non-integer expectedTransferRevision", async () => {
    const req = new NextRequest("http://localhost/api/security/ownership-transfers/ot1/execute", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedTransferRevision: "bad", expectedApprovalRevision: 0, previewHash: "a".repeat(64) }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "ot1" }) });
    expect(res.status).toBe(400);
  });
});
