import { describe, it, expect, vi } from "vitest";
import { recordCommercialApprovalResolution } from "./ai-decision-commercial-resolution";

function fakeCreatePrisma() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    client: {
      project: {
        findUnique: vi.fn(async () => ({ id: "proj_resolved" })),
      },
      domainDecisionLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "dec_1", ...data };
        }),
      },
    },
  };
}

describe("recordCommercialApprovalResolution", () => {
  it("records an approved resolution with quote caseRef (T2, fail-closed)", async () => {
    const fake = fakeCreatePrisma();

    await recordCommercialApprovalResolution(
      { quoteId: "quote_42", outcome: "approved", projectId: "proj_1" },
      { prisma: fake.client as never },
    );

    expect(fake.created).toHaveLength(1);
    const row = fake.created[0]!;
    expect(row.actor).toBe("commercial_approval");
    expect(row.actionType).toBe("commercial_approval_resolution");
    expect(row.caseRef).toBe("quote:quote_42");
    expect(row.domain).toBe("sales");
    expect(row.projectId).toBe("proj_1");
    expect(row.outcome).toBe("approved");
    // commercial_approval_resolution is intentionally unregistered → T2.
    expect(row.riskTier).toBe("T2");
  });

  it("records a rejected resolution as outcome=rejected", async () => {
    const fake = fakeCreatePrisma();

    await recordCommercialApprovalResolution(
      { quoteId: "quote_42", outcome: "rejected", projectId: "proj_1" },
      { prisma: fake.client as never },
    );

    expect(fake.created[0]!.outcome).toBe("rejected");
  });

  it("resolves projectId via demo-project when not provided", async () => {
    const fake = fakeCreatePrisma();

    await recordCommercialApprovalResolution(
      { quoteId: "quote_42", outcome: "approved" },
      { prisma: fake.client as never },
    );

    expect(fake.client.project.findUnique).toHaveBeenCalled();
    expect(fake.created[0]!.projectId).toBe("proj_resolved");
  });

  it("never throws when projectId cannot be resolved (best-effort, no record)", async () => {
    const client = {
      project: { findUnique: vi.fn(async () => null) },
      domainDecisionLog: { create: vi.fn() },
    };

    await expect(
      recordCommercialApprovalResolution(
        { quoteId: "quote_42", outcome: "approved" },
        { prisma: client as never },
      ),
    ).resolves.toBeUndefined();
    expect(client.domainDecisionLog.create).not.toHaveBeenCalled();
  });

  it("never throws when the underlying persist fails (best-effort)", async () => {
    const client = {
      project: { findUnique: vi.fn(async () => ({ id: "proj_x" })) },
      domainDecisionLog: {
        create: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    };

    await expect(
      recordCommercialApprovalResolution(
        { quoteId: "quote_42", outcome: "approved" },
        { prisma: client as never },
      ),
    ).resolves.toBeUndefined();
  });
});
