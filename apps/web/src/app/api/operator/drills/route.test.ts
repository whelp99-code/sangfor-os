import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ runSyntheticRemediationDrill: vi.fn() }));

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  isDrillScenario: vi.fn((value: unknown) => value === "stuck-approval"),
  runSyntheticRemediationDrill: mocks.runSyntheticRemediationDrill,
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
}));

describe("POST /api/operator/drills", () => {
  beforeEach(() => {
    mocks.runSyntheticRemediationDrill.mockResolvedValue({ status: "SUCCESS", phases: [] });
  });

  it("executes synthetic remediation drill", async () => {
    const req = new NextRequest("http://localhost/api/operator/drills", {
      method: "POST",
      body: JSON.stringify({ scenario: "stuck-approval", idempotencyKey: "key-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns unavailable when drill evidence is incomplete", async () => {
    mocks.runSyntheticRemediationDrill.mockResolvedValue({ status: "FAILED", phases: [] });
    const req = new NextRequest("http://localhost/api/operator/drills", {
      method: "POST",
      body: JSON.stringify({ scenario: "stuck-approval", idempotencyKey: "key-2" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });
});
