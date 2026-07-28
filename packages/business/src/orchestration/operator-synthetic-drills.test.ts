import { describe, expect, it, vi } from "vitest";
import { runSyntheticRemediationDrill } from "./operator-synthetic-drills";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "ceo", permissions: [], product: "portal",
};

describe("U071: operator-synthetic-drills unit tests", () => {
  it("fails closed when no drill evidence adapter is configured", async () => {
    const result = await runSyntheticRemediationDrill({ scenario: "stuck-approval", authContext: CTX, idempotencyKey: "idem-stuck-1" });
    expect(result).toMatchObject({ status: "FAILED", runId: null, startedAt: null, completedAt: null });
    expect(result.phases.every((phase) => phase.status === "PENDING" && phase.timestamp === null)).toBe(true);
  });

  it("reports success only when every phase returns injected evidence", async () => {
    let sequence = 0;
    const executePhase = vi.fn(async () => ({
      status: "SUCCESS" as const,
      timestamp: `2026-07-26T00:00:0${sequence++}.000Z`,
      evidenceId: `evidence-${sequence}`,
    }));
    const result = await runSyntheticRemediationDrill({
      scenario: "stuck-approval",
      authContext: CTX,
      idempotencyKey: "idem-stuck-2",
      runId: "drill-run-1",
      executePhase,
    });
    expect(result).toMatchObject({ status: "SUCCESS", runId: "drill-run-1", completedAt: "2026-07-26T00:00:05.000Z" });
    expect(result.phases).toHaveLength(6);
  });
});
