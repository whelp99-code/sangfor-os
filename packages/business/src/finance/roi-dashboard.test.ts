import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withRlsTransaction: vi.fn() }));
vi.mock("@sangfor/db", () => ({ withRlsTransaction: mocks.withRlsTransaction }));

import { getRoiDashboard } from "./roi-dashboard";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("U072: roi-dashboard unit tests", () => {
  const tx = { metricDefinition: { findMany: vi.fn() } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withRlsTransaction.mockImplementation(async (_scope: unknown, callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  });

  it("returns no fabricated metrics when definitions are absent", async () => {
    tx.metricDefinition.findMany.mockResolvedValue([]);
    const result = await getRoiDashboard({ authContext: CTX });
    expect(result).toMatchObject({ companyId: "c1", asOf: null, metrics: [], overallHealth: "UNKNOWN" });
  });

  it("uses the latest fresh persisted snapshot as measured ROI evidence", async () => {
    tx.metricDefinition.findMany.mockResolvedValue([{
      metricKey: "ai_cost_reduction",
      displayName: "AI 비용 절감액",
      unit: "USD",
      revision: 1,
      snapshots: [{
        state: "MEASURED",
        value: 42.5,
        sourceCount: 3,
        asOf: new Date("2026-07-26T00:00:00.000Z"),
        freshUntil: new Date("2999-07-27T00:00:00.000Z"),
      }],
    }]);
    const result = await getRoiDashboard({ authContext: CTX });
    expect(result.metrics[0]).toMatchObject({ state: "MEASURED", value: 42.5, sourceCount: 3, asOf: "2026-07-26T00:00:00.000Z" });
    expect(result.overallHealth).toBe("MEASURED");
  });

  it("does not expose stale snapshot values as current ROI", async () => {
    tx.metricDefinition.findMany.mockResolvedValue([{
      metricKey: "revenue_impact", displayName: "GTM 기여 매출액", unit: "USD", revision: 1,
      snapshots: [{ state: "MEASURED", value: 125000, sourceCount: 4, asOf: new Date("2020-01-01T00:00:00.000Z"), freshUntil: new Date("2020-01-02T00:00:00.000Z") }],
    }]);
    const result = await getRoiDashboard({ authContext: CTX });
    expect(result.metrics[0]).toMatchObject({ state: "SOURCE_UNAVAILABLE", value: null });
  });
});
