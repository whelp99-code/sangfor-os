import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  executeRetentionRun: vi.fn(async () => ({ status: "completed", purgedCount: 0, wouldPurgeCount: 0 })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  RetentionServiceError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/security/retention/runs/[runId]/execute", () => {
  it("executes dry run and returns 200", async () => {
    const req = new NextRequest("http://localhost/api/security/retention/runs/run1/execute", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: "apr1", previewHash: "a".repeat(64) }),
    });
    const res = await POST(req, { params: Promise.resolve({ runId: "run1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(json.purgedCount).toBe(0);
  });
});
