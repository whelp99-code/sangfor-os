import { describe, it, expect, vi } from "vitest";
import { recordDealRegistrationDecision } from "./ai-decision-deal-registration";

/**
 * Fake prisma exposing only domainDecisionLog.create — the surface
 * recordDecision (and thus recordDealRegistrationDecision) needs.
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

describe("recordDealRegistrationDecision", () => {
  it("records an APPROVED registration as outcome=approved (T2, fail-closed)", async () => {
    const fake = fakeCreatePrisma();

    await recordDealRegistrationDecision(
      {
        projectId: "proj_1",
        opportunityId: "opp_9",
        regStatus: "APPROVED",
      },
      { prisma: fake.client as never },
    );

    expect(fake.created).toHaveLength(1);
    const row = fake.created[0]!;
    expect(row.actor).toBe("deal_registration");
    expect(row.actionType).toBe("deal_registration");
    expect(row.caseRef).toBe("opp:opp_9");
    expect(row.domain).toBe("sales");
    expect(row.projectId).toBe("proj_1");
    expect(row.outcome).toBe("approved");
    // deal_registration is intentionally unregistered → fail-closed T2.
    expect(row.riskTier).toBe("T2");
  });

  it("records a REJECTED registration as outcome=rejected", async () => {
    const fake = fakeCreatePrisma();

    await recordDealRegistrationDecision(
      { projectId: "proj_1", opportunityId: "opp_9", regStatus: "REJECTED" },
      { prisma: fake.client as never },
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]!.outcome).toBe("rejected");
  });

  it("does NOT record for non-resolution statuses (only APPROVED/REJECTED)", async () => {
    const fake = fakeCreatePrisma();

    for (const regStatus of ["NOT_SUBMITTED", "SUBMITTED", "EXPIRED", "CONTESTED"] as const) {
      await recordDealRegistrationDecision(
        { projectId: "proj_1", opportunityId: "opp_9", regStatus },
        { prisma: fake.client as never },
      );
    }

    expect(fake.created).toHaveLength(0);
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
      recordDealRegistrationDecision(
        { projectId: "proj_1", opportunityId: "opp_9", regStatus: "APPROVED" },
        { prisma: client as never },
      ),
    ).resolves.toBeUndefined();
  });
});
