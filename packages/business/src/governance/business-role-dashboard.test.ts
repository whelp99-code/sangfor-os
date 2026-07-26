import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
}));

import {
  BUSINESS_ROLE_DASHBOARD_LANDINGS,
  getBusinessRoleDashboard,
} from "./business-role-dashboard";
import { BUSINESS_ROLE_CODES, type AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("U063: business-role-dashboard unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns MEASURED for activeOpportunities when role is ceo", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({ opportunity: { count: vi.fn(async () => 5) } });
    });

    const res = await getBusinessRoleDashboard({ authContext: CTX });
    expect(res.role).toBe("ceo");
    expect(res.metrics["activeOpportunities"]?.state).toBe("MEASURED");
    expect(res.metrics["activeOpportunities"]?.value).toBe(5);
  });

  it("returns SOURCE_UNAVAILABLE for systemTelemetry instead of fake zero", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({ opportunity: { count: vi.fn(async () => 0) } });
    });

    const res = await getBusinessRoleDashboard({ authContext: CTX });
    expect(res.metrics["systemTelemetry"]?.state).toBe("SOURCE_UNAVAILABLE");
    expect(res.metrics["systemTelemetry"]?.value).toBeNull();
  });

  it("returns the truthful landing for every BusinessRole", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({ opportunity: { count: vi.fn(async () => 1) } });
    });

    for (const role of BUSINESS_ROLE_CODES) {
      const authContext = { ...CTX, businessRole: role };
      const res = await getBusinessRoleDashboard({ authContext });
      expect(res.landing).toBe(BUSINESS_ROLE_DASHBOARD_LANDINGS[role]);
    }
  });

  it("does not fabricate role-inapplicable or unavailable metrics", async () => {
    const opportunityCount = vi.fn(async () => 0);
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({ opportunity: { count: opportunityCount } });
    });

    const res = await getBusinessRoleDashboard({
      authContext: { ...CTX, businessRole: "support_engineer" },
    });

    expect(opportunityCount).not.toHaveBeenCalled();
    expect(res.metrics["activeOpportunities"]).toMatchObject({ state: "UNKNOWN", value: null });
    expect(res.metrics["systemTelemetry"]).toMatchObject({ state: "SOURCE_UNAVAILABLE", value: null });
  });

  it("rejects unknown role input before opening an RLS transaction", async () => {
    await expect(getBusinessRoleDashboard({ authContext: CTX, requestedRole: "admin" }))
      .rejects.toMatchObject({ code: "INVALID_BUSINESS_ROLE", httpStatus: 400 });
    expect(mocks.withRlsTransaction).not.toHaveBeenCalled();
  });

  it("rejects cross-role requests without canonical explicit admin authority", async () => {
    await expect(getBusinessRoleDashboard({ authContext: CTX, requestedRole: "sales_manager" }))
      .rejects.toMatchObject({ code: "DASHBOARD_ROLE_FORBIDDEN", httpStatus: 403 });
    await expect(getBusinessRoleDashboard({
      authContext: { ...CTX, businessRole: "system_admin", permissions: [] },
      requestedRole: "ceo",
    })).rejects.toMatchObject({ code: "DASHBOARD_ROLE_FORBIDDEN", httpStatus: 403 });
    expect(mocks.withRlsTransaction).not.toHaveBeenCalled();
  });

  it("allows a cross-role request only for canonical explicit admin authority", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({ opportunity: { count: vi.fn(async () => 7) } });
    });

    const res = await getBusinessRoleDashboard({
      authContext: { ...CTX, businessRole: "system_admin", permissions: ["system.admin"] },
      requestedRole: "ceo",
    });

    expect(res.role).toBe("ceo");
    expect(res.landing).toBe("/dashboard");
    expect(res.metrics["activeOpportunities"]?.value).toBe(7);
  });
});
