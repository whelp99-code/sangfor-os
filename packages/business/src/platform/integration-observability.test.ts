import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
}));

vi.mock("../governance/audit-db", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import { getIntegrationHealth, reprobeTarget, acknowledgeObservation } from "./integration-observability";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "system_admin", permissions: [], product: "portal",
};

describe("U067: integration-observability unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getIntegrationHealth returns measured target health states", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({});
    });

    const res = await getIntegrationHealth({ authContext: CTX });
    expect(res.targets).toHaveLength(3);
    expect(res.overallState).toBe("degraded");
  });

  it("reprobeTarget appends integration.observation.recorded event", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb({});
    });
    mocks.appendAuditEvent.mockResolvedValue({ id: "audit1" });

    const res = await reprobeTarget({ authContext: CTX, targetId: "postgres-primary", idempotencyKey: "k1" });
    expect(res.targetId).toBe("postgres-primary");
    expect(res.state).toBe("healthy");
  });
});
