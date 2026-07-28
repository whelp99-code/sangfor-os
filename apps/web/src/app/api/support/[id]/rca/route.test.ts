import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  setCurrentRcaArtifactVersion: vi.fn(async () => ({ id: "sc1", rcaArtifactVersionId: "av1", revision: 1 })),
  assessCurrentRca: vi.fn(async () => ({ id: "asm1", status: "completed" })),
  requestRcaInternalApproval: vi.fn(async () => ({ id: "apr1" })),
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

describe("POST /api/support/[id]/rca", () => {
  beforeEach(() => vi.clearAllMocks());

  it("handles set_current action", async () => {
    const req = new NextRequest("http://localhost/api/support/sc1/rca", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_current",
        artifactVersionId: "av1",
        artifactContentHash: "a".repeat(64),
        expectedRevision: 0,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "sc1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rcaArtifactVersionId).toBe("av1");
  });
});
