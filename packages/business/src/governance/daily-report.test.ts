import { describe, expect, it, vi } from "vitest";

import { buildDailyBrief, type BuildDailyBriefDeps } from "./daily-report";

function buildFakePrisma() {
  return {
    mailMessage: {
      count: vi.fn().mockResolvedValue(0),
    },
    mailDerivedCandidate: {
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    renewalOpportunity: {
      count: vi.fn().mockResolvedValue(0),
    },
    supportCase: {
      count: vi.fn().mockResolvedValue(0),
    },
    approvalRequest: {
      count: vi.fn().mockResolvedValue(0),
    },
    domainDecisionLog: {
      count: vi.fn().mockResolvedValue(0),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

type FakePrisma = ReturnType<typeof buildFakePrisma>;

function makeDeps(overrides?: {
  prisma?: FakePrisma;
  llm?: ReturnType<typeof vi.fn>;
}): BuildDailyBriefDeps {
  return {
    prisma: overrides?.prisma as unknown as BuildDailyBriefDeps["prisma"],
    llm: overrides?.llm,
  };
}

describe("buildDailyBrief", () => {
  it("all-zero mocks -> zero counts and a non-empty fallback summary", async () => {
    const prisma = buildFakePrisma();

    const llm = vi.fn().mockRejectedValue(new Error("offline"));
    const brief = await buildDailyBrief("proj-1", makeDeps({ prisma, llm }));

    expect(brief.inflow).toEqual({ mails: 0, candidatesByType: {} });
    expect(brief.deadlines).toEqual({ renewalsD30: 0, slaAtRisk: 0, pendingApprovals: 0 });
    expect(brief.autopilot).toEqual({ autoApproved24h: 0, suggestedPending: 0 });
    expect(brief.stageChanges24h).toBe(0);
    expect(brief.summary.length).toBeGreaterThan(0);
    expect(brief.summary).toContain("0건");
    expect(typeof brief.generatedAt).toBe("string");
    expect(() => new Date(brief.generatedAt).toISOString()).not.toThrow();
  });

  it("counts flow through from prisma into the brief and llm summary is used", async () => {
    const prisma = buildFakePrisma();
    prisma.mailMessage.count.mockResolvedValue(12);
    prisma.mailDerivedCandidate.groupBy.mockResolvedValue([
      { candidateType: "customer", _count: 3 },
      { candidateType: "opportunity", _count: 2 },
    ]);
    prisma.renewalOpportunity.count.mockResolvedValue(4);
    prisma.supportCase.count.mockResolvedValue(2);
    prisma.approvalRequest.count.mockResolvedValue(7);
    prisma.domainDecisionLog.count
      .mockResolvedValueOnce(5) // autoApproved24h
      .mockResolvedValueOnce(9); // stageChanges24h
    prisma.mailDerivedCandidate.count.mockResolvedValue(6);

    const llm = vi.fn().mockResolvedValue("LLM이 작성한 3문장 요약입니다.");

    const brief = await buildDailyBrief("proj-1", makeDeps({ prisma, llm }));

    expect(brief.inflow).toEqual({
      mails: 12,
      candidatesByType: { customer: 3, opportunity: 2 },
    });
    expect(brief.deadlines).toEqual({ renewalsD30: 4, slaAtRisk: 2, pendingApprovals: 7 });
    expect(brief.autopilot).toEqual({ autoApproved24h: 5, suggestedPending: 6 });
    expect(brief.stageChanges24h).toBe(9);
    expect(brief.summary).toBe("LLM이 작성한 3문장 요약입니다.");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("llm deps throws -> deterministic fallback summary is used instead", async () => {
    const prisma = buildFakePrisma();
    prisma.mailMessage.count.mockResolvedValue(3);
    prisma.approvalRequest.count.mockResolvedValue(1);

    const llm = vi.fn().mockRejectedValue(new Error("9router down"));

    const brief = await buildDailyBrief("proj-1", makeDeps({ prisma, llm }));

    expect(llm).toHaveBeenCalledTimes(1);
    expect(brief.summary).not.toBe("");
    expect(brief.summary).toContain("메일 3건");
    expect(brief.summary).toContain("미결승인 1건");
  });
});
