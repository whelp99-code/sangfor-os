import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class BusinessRoleDashboardError extends Error {
    constructor(
      readonly code: "INVALID_BUSINESS_ROLE" | "DASHBOARD_ROLE_FORBIDDEN",
      readonly httpStatus: 400 | 403,
    ) {
      super(code);
    }
  }

  return {
    BusinessRoleDashboardError,
    evaluatePersistedSessionFromRequest: vi.fn(),
    resolveBusinessRoleDashboardAuthContext: vi.fn(),
    getBusinessRoleDashboard: vi.fn(),
  };
});

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: mocks.evaluatePersistedSessionFromRequest,
}));

vi.mock("@sangfor/business", () => ({
  BusinessRoleDashboardError: mocks.BusinessRoleDashboardError,
  resolveBusinessRoleDashboardAuthContext: mocks.resolveBusinessRoleDashboardAuthContext,
  getBusinessRoleDashboard: mocks.getBusinessRoleDashboard,
}));

import { GET } from "./route";

const AUTH_CONTEXT = {
  userId: "u1",
  sessionId: null,
  tenantId: "t1",
  companyId: "c1",
  projectId: "p1",
  businessRole: "ceo",
  permissions: [],
  product: "portal",
};

describe("GET /api/dashboard/[role]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluatePersistedSessionFromRequest.mockResolvedValue({
      ok: true,
      userId: "u1",
      tenantId: "t1",
      companyId: "c1",
      projectId: "p1",
    });
    mocks.resolveBusinessRoleDashboardAuthContext.mockResolvedValue(AUTH_CONTEXT);
    mocks.getBusinessRoleDashboard.mockResolvedValue({
      role: "ceo",
      landing: "/dashboard",
      metrics: {},
      asOf: "2026-07-26T00:00:00.000Z",
    });
  });

  it("returns dashboard metrics for authorized role", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/ceo") as never,
      { params: Promise.resolve({ role: "ceo" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getBusinessRoleDashboard).toHaveBeenCalledWith({
      authContext: AUTH_CONTEXT,
      requestedRole: "ceo",
    });
  });

  it("rejects an unknown BusinessRole", async () => {
    const response = await GET(
      new Request("http://localhost/api/dashboard/admin") as never,
      { params: Promise.resolve({ role: "admin" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_BUSINESS_ROLE" });
    expect(mocks.resolveBusinessRoleDashboardAuthContext).not.toHaveBeenCalled();
    expect(mocks.getBusinessRoleDashboard).not.toHaveBeenCalled();
  });

  it("returns forbidden for a cross-role dashboard denial", async () => {
    mocks.getBusinessRoleDashboard.mockRejectedValue(
      new mocks.BusinessRoleDashboardError("DASHBOARD_ROLE_FORBIDDEN", 403),
    );

    const response = await GET(
      new Request("http://localhost/api/dashboard/sales_manager") as never,
      { params: Promise.resolve({ role: "sales_manager" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "DASHBOARD_ROLE_FORBIDDEN" });
  });
});
