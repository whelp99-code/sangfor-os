import { describe, expect, it } from "vitest";
import { runSyntheticRemediationDrill } from "./operator-synthetic-drills";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("U071: operator-synthetic-drills unit tests", () => {
  it("runs stuck-approval synthetic drill through all 6 phases", async () => {
    const res = await runSyntheticRemediationDrill({
      scenario: "stuck-approval",
      authContext: CTX,
      idempotencyKey: "idem-stuck-1",
    });
    expect(res.status).toBe("SUCCESS");
    expect(res.phases).toHaveLength(6);
    expect(res.phases.every((p) => p.status === "SUCCESS")).toBe(true);
  });
});
