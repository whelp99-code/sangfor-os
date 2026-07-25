import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
}));

import { getBusinessRoleDashboard } from "./business-role-dashboard";
import type { AuthContext } from "@sangfor/auth";

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
});
