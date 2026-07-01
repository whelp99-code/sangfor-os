import { describe, it, expect, vi } from "vitest";
import { recordCommercialApprovalDecision } from "./ai-decision-commercial";

/**
 * Fake prisma exposing only domainDecisionLog.create — the surface
 * recordDecision (and thus recordCommercialApprovalDecision) needs.
 */
function fakeCreatePrisma() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    client: {
      domainDecisionLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "dec_1", ...data };
        }),
      },
    },
  };
}

describe("recordCommercialApprovalDecision", () => {
  it("records a commercial_approval decision with quote caseRef (T2, fail-closed)", async () => {
    const fake = fakeCreatePrisma();

    await recordCommercialApprovalDecision(
      {
        projectId: "proj_1",
        quoteId: "quote_42",
        opportunityId: "opp_9",
        reason: "low_margin",
      },
      { prisma: fake.client as never },
    );

    expect(fake.created).toHaveLength(1);
    const row = fake.created[0]!;
    expect(row.actor).toBe("commercial_approval");
    expect(row.actionType).toBe("commercial_approval");
    expect(row.caseRef).toBe("quote:quote_42");
    expect(row.domain).toBe("sales");
    expect(row.projectId).toBe("proj_1");
    // commercial_approval is unregistered → fail-closed T2 snapshot.
    expect(row.riskTier).toBe("T2");
    // Predicted confidence is unavailable at this point → null/undefined.
    expect(row.predictedConfidence ?? null).toBeNull();
  });

  it("never throws when the underlying persist fails (best-effort)", async () => {
    const client = {
      domainDecisionLog: {
        create: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    };

    await expect(
      recordCommercialApprovalDecision(
        { projectId: "proj_1", quoteId: "quote_42", opportunityId: "opp_9", reason: "x" },
        { prisma: client as never },
      ),
    ).resolves.toBeUndefined();
  });
});
