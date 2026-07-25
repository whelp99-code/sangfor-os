import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  previewRetentionRun: vi.fn(async () => ({ runId: "run1", previewHash: "a".repeat(64), itemCount: 0 })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1", businessRole: "security_officer", permissions: [], product: "portal" })),
  RetentionServiceError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/security/retention/preview", () => {
  it("creates retention preview run", async () => {
    const req = new NextRequest("http://localhost/api/security/retention/preview", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ retentionAssignmentId: "ra1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.runId).toBe("run1");
  });
});
