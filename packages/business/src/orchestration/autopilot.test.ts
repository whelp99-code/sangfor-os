import { describe, expect, it, vi } from "vitest";

import { runAutopilotPass, type AutopilotDeps } from "./autopilot";

function buildFakePrisma() {
  return {
    mailDerivedCandidate: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    autonomyPolicy: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    domainDecisionLog: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

type FakePrisma = ReturnType<typeof buildFakePrisma>;

function makeDeps(overrides?: {
  prisma?: FakePrisma;
  approve?: ReturnType<typeof vi.fn>;
  recordDecision?: ReturnType<typeof vi.fn>;
  getAutonomy?: ReturnType<typeof vi.fn>;
  getProjectId?: ReturnType<typeof vi.fn>;
  resolveMode?: ReturnType<typeof vi.fn>;
  env?: Record<string, string | undefined>;
}): AutopilotDeps {
  return {
    prisma: overrides?.prisma as unknown as AutopilotDeps["prisma"],
    approve: overrides?.approve,
    recordDecision: overrides?.recordDecision,
    getAutonomy: overrides?.getAutonomy,
    getProjectId: overrides?.getProjectId,
    resolveMode: overrides?.resolveMode,
    env: overrides?.env,
  };
}

function defaultEnv(): Record<string, string> {
  return { AUTOPILOT_ENABLED: "1" };
}

function makeCandidate(overrides?: {
  id?: string;
  candidateType?: string;
  aiRevalidation?: string;
}) {
  return {
    id: overrides?.id ?? "cand-1",
    candidateType: overrides?.candidateType ?? "customer",
    metadata: {
      aiRevalidation: { decision: overrides?.aiRevalidation ?? "approve_candidate" },
    },
  };
}

function makePolicy(overrides?: {
  mode?: string;
  minAutonomy?: number;
  minSamples?: number;
  requireColorGatePass?: boolean;
}) {
  return {
    id: "pol-1",
    domain: "sales",
    decisionType: "autopilot_approve",
    mode: overrides?.mode ?? "auto",
    minAutonomy: overrides?.minAutonomy ?? 0.9,
    minSamples: overrides?.minSamples ?? 10,
    requireColorGatePass: overrides?.requireColorGatePass ?? true,
    updatedBy: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

describe("runAutopilotPass", () => {
  it("kill-switch: AUTOPILOT_ENABLED=0 -> all-zero result, no prisma calls", async () => {
    const prisma = buildFakePrisma();
    const result = await runAutopilotPass(undefined, {
      prisma: prisma as unknown as AutopilotDeps["prisma"],
      env: { AUTOPILOT_ENABLED: "0" },
    });

    expect(result).toEqual<typeof result>({
      scanned: 0,
      autoApproved: 0,
      suggested: 0,
      skipped: 0,
      demoted: [],
      results: [],
    });
    expect(prisma.mailDerivedCandidate.findMany).not.toHaveBeenCalled();
    expect(prisma.domainDecisionLog.findMany).not.toHaveBeenCalled();
  });

  it("dryRun:true with auto candidate -> review suggestion, no write-side calls", async () => {
    const prisma = buildFakePrisma();
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([makeCandidate()]);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.findUnique.mockResolvedValue(makePolicy({ mode: "auto" }));

    const approve = vi.fn();
    const recordDecisionFn = vi.fn();

    const result = await runAutopilotPass(
      { dryRun: true, limit: 20 },
      makeDeps({
        prisma,
        approve,
        recordDecision: recordDecisionFn,
        getAutonomy: vi.fn().mockResolvedValue({ pct: 95, sample: 15, label: "높음" }),
        getProjectId: vi.fn().mockResolvedValue("proj-1"),
        env: defaultEnv(),
      }),
    );

    expect(result.scanned).toBe(1);
    expect(result.autoApproved).toBe(0);
    expect(result.suggested).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.results[0]!.action).toBe("suggest");
    expect(result.results[0]!.reason).toBe("would_persist_review_draft (dryRun)");

    expect(approve).not.toHaveBeenCalled();
    expect(recordDecisionFn).not.toHaveBeenCalled();
    expect(prisma.mailDerivedCandidate.update).not.toHaveBeenCalled();
  });

  it("dryRun:false with auto candidate -> persisted review draft without auto-approval", async () => {
    const prisma = buildFakePrisma();
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([makeCandidate()]);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.findUnique.mockResolvedValue(makePolicy({ mode: "auto" }));

    const approve = vi.fn().mockResolvedValue({ created: { id: "entity-1" } });
    const recordDecisionFn = vi.fn().mockResolvedValue({ id: "dec-1" });

    const result = await runAutopilotPass(
      { dryRun: false },
      {
        prisma: prisma as unknown as AutopilotDeps["prisma"],
        approve,
        recordDecision: recordDecisionFn,
        getAutonomy: vi.fn().mockResolvedValue({ pct: 95, sample: 15, label: "높음" }),
        getProjectId: vi.fn().mockResolvedValue("proj-1"),
        env: defaultEnv(),
      },
    );

    expect(result.autoApproved).toBe(0);
    expect(result.suggested).toBe(1);
    expect(result.results[0]!.action).toBe("suggest");
    expect(result.results[0]!.reason).toBe("authenticated_crm_context_required");

    expect(approve).not.toHaveBeenCalled();
    expect(recordDecisionFn).not.toHaveBeenCalled();
    expect(prisma.mailDerivedCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-1" },
        data: {
          metadata: expect.objectContaining({
            autopilotReviewDraft: expect.objectContaining({
              reviewRequired: true,
              reason: "authenticated_crm_context_required",
              policyId: "pol-1",
            }),
          }),
        },
      }),
    );
  });

  it("suggest mode (non-dryRun) -> update called, approve/recordDecision NOT called", async () => {
    const prisma = buildFakePrisma();
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([makeCandidate()]);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.findUnique.mockResolvedValue(makePolicy({ mode: "suggest" }));
    prisma.mailDerivedCandidate.update.mockResolvedValue({ id: "cand-1" });

    const approve = vi.fn();
    const recordDecisionFn = vi.fn();

    const result = await runAutopilotPass(
      { dryRun: false },
      {
        prisma: prisma as unknown as AutopilotDeps["prisma"],
        approve,
        recordDecision: recordDecisionFn,
        getAutonomy: vi.fn().mockResolvedValue({ pct: 95, sample: 15, label: "높음" }),
        getProjectId: vi.fn().mockResolvedValue("proj-1"),
        env: defaultEnv(),
      },
    );

    expect(result.suggested).toBe(1);
    expect(result.results[0]!.action).toBe("suggest");

    expect(prisma.mailDerivedCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            autopilotSuggested: true,
          }),
        }),
      }),
    );

    expect(approve).not.toHaveBeenCalled();
    expect(recordDecisionFn).not.toHaveBeenCalled();
  });

  it("reversal auto-demote: 3 most recent all flipped -> policy updateMany called", async () => {
    const prisma = buildFakePrisma();
    const now = new Date();

    const aiRows = [
      { id: "ai-1", caseRef: "mail_candidate:r1", domain: "sales", createdAt: new Date(now.getTime() - 1000) },
      { id: "ai-2", caseRef: "mail_candidate:r2", domain: "sales", createdAt: new Date(now.getTime() - 2000) },
      { id: "ai-3", caseRef: "mail_candidate:r3", domain: "sales", createdAt: new Date(now.getTime() - 3000) },
    ];
    prisma.domainDecisionLog.findMany.mockResolvedValue(aiRows);

    prisma.domainDecisionLog.findFirst
      .mockResolvedValueOnce({ id: "rej-1" })
      .mockResolvedValueOnce({ id: "rej-2" })
      .mockResolvedValueOnce({ id: "rej-3" });

    prisma.mailDerivedCandidate.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.updateMany.mockResolvedValue({ count: 1 });

    const result = await runAutopilotPass(
      undefined,
      { prisma: prisma as unknown as AutopilotDeps["prisma"], env: defaultEnv() },
    );

    expect(prisma.autonomyPolicy.updateMany).toHaveBeenCalledWith({
      where: {
        domain: "sales",
        decisionType: "autopilot_approve",
        mode: "auto",
      },
      data: { mode: "suggest" },
    });

    expect(result.demoted).toContain("sales:autopilot_approve");
    expect(result.scanned).toBe(0);
  });

  it("reversal auto-demote: a non-auto policy is never elevated to suggest", async () => {
    const prisma = buildFakePrisma();
    const now = new Date();

    prisma.domainDecisionLog.findMany.mockResolvedValue([
      { id: "ai-1", caseRef: "mail_candidate:r1", domain: "sales", createdAt: new Date(now.getTime() - 1000) },
      { id: "ai-2", caseRef: "mail_candidate:r2", domain: "sales", createdAt: new Date(now.getTime() - 2000) },
      { id: "ai-3", caseRef: "mail_candidate:r3", domain: "sales", createdAt: new Date(now.getTime() - 3000) },
    ]);
    prisma.domainDecisionLog.findFirst
      .mockResolvedValueOnce({ id: "rej-1" })
      .mockResolvedValueOnce({ id: "rej-2" })
      .mockResolvedValueOnce({ id: "rej-3" });
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([]);
    // The conditional update finds no auto policy; observe/suggest/unknown modes must not move.
    prisma.autonomyPolicy.updateMany.mockResolvedValue({ count: 0 });

    const result = await runAutopilotPass(
      undefined,
      { prisma: prisma as unknown as AutopilotDeps["prisma"], env: defaultEnv() },
    );

    expect(prisma.autonomyPolicy.updateMany).toHaveBeenCalledWith({
      where: {
        domain: "sales",
        decisionType: "autopilot_approve",
        mode: "auto",
      },
      data: { mode: "suggest" },
    });
    expect(result.demoted).toEqual([]);
  });

  it("reversal auto-demote: only 2 recent rows -> no demotion (needs 3)", async () => {
    const prisma = buildFakePrisma();
    const now = new Date();

    prisma.domainDecisionLog.findMany.mockResolvedValue([
      { id: "ai-1", caseRef: "mail_candidate:r1", domain: "sales", createdAt: new Date(now.getTime() - 1000) },
      { id: "ai-2", caseRef: "mail_candidate:r2", domain: "sales", createdAt: new Date(now.getTime() - 2000) },
    ]);
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([]);

    const result = await runAutopilotPass(
      undefined,
      { prisma: prisma as unknown as AutopilotDeps["prisma"], env: defaultEnv() },
    );

    expect(prisma.autonomyPolicy.updateMany).not.toHaveBeenCalled();
    expect(result.demoted).toEqual([]);
  });

  it("whitelist: unsupported candidateType -> skipped with reason", async () => {
    const prisma = buildFakePrisma();
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([
      makeCandidate({ candidateType: "quote" }),
    ]);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);

    const result = await runAutopilotPass(
      undefined,
      { prisma: prisma as unknown as AutopilotDeps["prisma"], env: defaultEnv() },
    );

    expect(result.skipped).toBe(1);
    expect(result.scanned).toBe(1);
    expect(result.results[0]!.action).toBe("skipped");
    expect(result.results[0]!.reason).toBe("unsupported_candidate_type");
  });

  it("observe mode -> observe action, counted in skipped", async () => {
    const prisma = buildFakePrisma();
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([makeCandidate()]);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.findUnique.mockResolvedValue(makePolicy({ mode: "observe" }));

    const result = await runAutopilotPass(
      undefined,
      {
        prisma: prisma as unknown as AutopilotDeps["prisma"],
        env: defaultEnv(),
        getAutonomy: vi.fn().mockResolvedValue({ pct: 95, sample: 15, label: "높음" }),
      },
    );

    expect(result.skipped).toBe(1);
    expect(result.results[0]!.action).toBe("observe");
    expect(result.results[0]!.reason).toBe("observe");
  });

  it("never invokes a legacy approval dependency without AuthContext", async () => {
    const prisma = buildFakePrisma();
    prisma.mailDerivedCandidate.findMany.mockResolvedValue([makeCandidate()]);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.findUnique.mockResolvedValue(makePolicy({ mode: "auto" }));

    const approve = vi.fn().mockRejectedValue(new Error("candidate_rejected"));

    const result = await runAutopilotPass(
      { dryRun: false },
      {
        prisma: prisma as unknown as AutopilotDeps["prisma"],
        approve,
        getAutonomy: vi.fn().mockResolvedValue({ pct: 95, sample: 15, label: "높음" }),
        getProjectId: vi.fn().mockResolvedValue("proj-1"),
        env: defaultEnv(),
      },
    );

    expect(result.autoApproved).toBe(0);
    expect(result.suggested).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.results[0]!.action).toBe("suggest");
    expect(result.results[0]!.reason).toBe("authenticated_crm_context_required");
    expect(approve).not.toHaveBeenCalled();
  });

  it("respects limit: only N candidates scanned", async () => {
    const prisma = buildFakePrisma();
    const manyCandidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ id: `cand-${i}` }),
    );
    prisma.mailDerivedCandidate.findMany.mockResolvedValue(manyCandidates);
    prisma.domainDecisionLog.findMany.mockResolvedValue([]);
    prisma.autonomyPolicy.findUnique.mockResolvedValue(makePolicy({ mode: "observe" }));

    const result = await runAutopilotPass(
      { limit: 2 },
      {
        prisma: prisma as unknown as AutopilotDeps["prisma"],
        env: defaultEnv(),
        getAutonomy: vi.fn().mockResolvedValue({ pct: 95, sample: 15, label: "높음" }),
      },
    );

    expect(result.scanned).toBe(2);
    expect(result.results).toHaveLength(2);
  });
});
