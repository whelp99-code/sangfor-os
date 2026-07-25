import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  runSyntheticRemediationDrill: vi.fn(async () => ({ status: "SUCCESS", phases: [] })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
}));

describe("POST /api/operator/drills", () => {
  it("executes synthetic remediation drill", async () => {
    const req = new NextRequest("http://localhost/api/operator/drills", {
      method: "POST",
      body: JSON.stringify({ scenario: "stuck-approval", idempotencyKey: "key-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
