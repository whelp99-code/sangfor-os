import { describe, expect, it } from "vitest";
import { getRoiDashboard } from "./roi-dashboard";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("U072: roi-dashboard unit tests", () => {
  it("returns honest measured and unknown metrics without inventing values", async () => {
    const res = await getRoiDashboard({ authContext: CTX });
    expect(res.companyId).toBe("c1");
    expect(res.metrics).toHaveLength(3);

    const costMetric = res.metrics.find((m) => m.metricKey === "ai_cost_reduction");
    expect(costMetric?.state).toBe("MEASURED");
    expect(costMetric?.value).toBe(0);

    const effMetric = res.metrics.find((m) => m.metricKey === "automation_efficiency");
    expect(effMetric?.state).toBe("UNKNOWN");
    expect(effMetric?.value).toBeNull();
  });
});
