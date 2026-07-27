import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveBusinessRoleDashboardAuthContext: vi.fn(),
  runSyntheticRemediationDrill: vi.fn(),
}));

type DashboardIdentity = {
  userId: string;
  sessionId: null;
  tenantId: string;
  companyId: string;
  projectId: string;
  product: string;
};

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  isDrillScenario: vi.fn((value: unknown) => value === "stuck-approval"),
  runSyntheticRemediationDrill: mocks.runSyntheticRemediationDrill,
  resolveBusinessRoleDashboardAuthContext: mocks.resolveBusinessRoleDashboardAuthContext,
}));

describe("POST /api/operator/drills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveBusinessRoleDashboardAuthContext.mockImplementation(async (x: DashboardIdentity) => ({
      ...x,
      sessionId: "s1",
      businessRole: "system_admin",
      permissions: ["system.admin"],
    }));
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

  it("rejects a caller without system.admin", async () => {
    mocks.resolveBusinessRoleDashboardAuthContext.mockImplementationOnce(async (x: DashboardIdentity) => ({
      ...x,
      sessionId: "s1",
      businessRole: "account_manager",
      permissions: ["opportunity.read"],
    }));
    const req = new NextRequest("http://localhost/api/operator/drills", {
      method: "POST",
      body: JSON.stringify({ scenario: "stuck-approval", idempotencyKey: "key-3" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mocks.runSyntheticRemediationDrill).not.toHaveBeenCalled();
  });
});
