import { describe, it, expect, vi } from "vitest";
import { recordDecision } from "./ai-decision";

/** Minimal fake matching the DomainDecisionLog.create surface recordDecision uses. */
function fakePrisma() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    client: {
      domainDecisionLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "ddl_test", ...data };
        }),
      },
    },
  };
}

describe("recordDecision", () => {
  it("appends a DomainDecisionLog row with actor/actionType/riskTier/policyVersion", async () => {
    const fake = fakePrisma();
    await recordDecision(
      {
        projectId: "p1",
        domain: "sales",
        actor: "sales",
        actionType: "stage_transition",
        caseRef: "opp:o1",
        outcome: "approved",
      },
      { prisma: fake.client as never },
    );

    expect(fake.client.domainDecisionLog.create).toHaveBeenCalledOnce();
    const data = fake.created[0];
    expect(data.projectId).toBe("p1");
    expect(data.actor).toBe("sales");
    expect(data.actionType).toBe("stage_transition");
    expect(data.riskTier).toBe("T0"); // registered → T0
    expect(data.policyVersion).toBeTruthy();
    expect(data.outcome).toBe("approved");
    expect(data.decisionType).toBeTruthy(); // legacy NOT NULL column filled
  });

  it("labels an UNREGISTERED actionType as T2 and warns (fail-closed)", async () => {
    const fake = fakePrisma();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordDecision(
      {
        projectId: "p1",
        domain: "cfo",
        actor: "cfo",
        actionType: "totally_unknown_action",
        caseRef: "x:1",
        outcome: "approved",
      },
      { prisma: fake.client as never },
    );
    expect(fake.created[0].riskTier).toBe("T2");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("carries predictedConfidence when provided", async () => {
    const fake = fakePrisma();
    await recordDecision(
      {
        projectId: "p1",
        domain: "sales",
        actor: "sales",
        actionType: "mail_revalidation",
        caseRef: "mail:1",
        outcome: "approved",
        predictedConfidence: 0.87,
      },
      { prisma: fake.client as never },
    );
    expect(fake.created[0].predictedConfidence).toBe(0.87);
    expect(fake.created[0].riskTier).toBe("T1");
  });

  it("NEVER throws even if the DB write fails (best-effort, outside txn)", async () => {
    const throwingClient = {
      domainDecisionLog: {
        create: vi.fn(async () => {
          throw new Error("db exploded");
        }),
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordDecision(
        {
          projectId: "p1",
          domain: "sales",
          actor: "sales",
          actionType: "stage_transition",
          caseRef: "opp:o1",
          outcome: "approved",
        },
        { prisma: throwingClient as never },
      ),
    ).resolves.toBeUndefined();
    err.mockRestore();
  });
});
