import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBusinessRoleDashboard: vi.fn(async (input) => ({
    role: input.authContext.businessRole,
    landing: "/dashboard",
    metrics: {},
    asOf: new Date().toISOString(),
  })),
}));

vi.mock("./business-role-dashboard", () => ({
  getBusinessRoleDashboard: mocks.getBusinessRoleDashboard,
}));

import { getRoleDashboardData } from "./role-dashboard-data";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("role-dashboard-data compatibility test", () => {
  it("delegates getRoleDashboardData directly to getBusinessRoleDashboard", async () => {
    await getRoleDashboardData({ authContext: CTX });
    expect(mocks.getBusinessRoleDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.getBusinessRoleDashboard).toHaveBeenCalledWith({ authContext: CTX });
  });
});
