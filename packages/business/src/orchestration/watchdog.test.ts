import { describe, it, expect, vi, beforeEach } from "vitest";

// task-center.ts (called internally by watchdog for task creation) imports
// prisma directly with no DI seam, so mock @sangfor/db at module level —
// same pattern as orchestration/task-center.test.ts.
vi.mock("@sangfor/db", () => {
  const state = {
    renewals: [] as unknown[],
    supportCases: [] as unknown[],
    domainDecisionLogs: [] as unknown[],
    existingTaskTitles: new Set<string>(),
    laterResolvedCaseRefs: new Set<string>(),
  };

  const renewalOpportunity = {
    findMany: vi.fn(async () => state.renewals),
  };
  const supportCase = {
    findMany: vi.fn(async () => state.supportCases),
  };
  const domainDecisionLog = {
    findMany: vi.fn(async () => state.domainDecisionLogs),
    findFirst: vi.fn(async (args: { where: { caseRef: string } }) =>
      state.laterResolvedCaseRefs.has(args.where.caseRef) ? { id: "later-1" } : null,
    ),
  };
  const workTask = {
    findFirst: vi.fn(async (args: { where: { title: string } }) =>
      state.existingTaskTitles.has(args.where.title) ? { id: "existing-1", title: args.where.title } : null,
    ),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.existingTaskTitles.add(args.data.title as string);
      return { id: "wt-new", ...args.data };
    }),
  };
  const project = {
    findUniqueOrThrow: vi.fn(async () => ({ id: "proj-1", slug: "demo-project" })),
  };
  const taskStatusEvent = { create: vi.fn(async () => ({})) };
  const taskLink = { upsert: vi.fn(async () => ({})) };

  return {
    __watchdogTestState: state,
    prisma: {
      renewalOpportunity,
      supportCase,
      domainDecisionLog,
      workTask,
      project,
      taskStatusEvent,
      taskLink,
    },
  };
});
vi.mock("../governance/audit", () => ({ logStateTransition: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../governance/ai-decision", () => ({ recordDecision: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "@sangfor/db";
import { runWatchdogPass } from "./watchdog";

type TestState = {
  renewals: unknown[];
  supportCases: unknown[];
  domainDecisionLogs: unknown[];
  existingTaskTitles: Set<string>;
  laterResolvedCaseRefs: Set<string>;
};

function getState(): TestState {
  return (prisma as unknown as { __watchdogTestState?: TestState }).__watchdogTestState as unknown as TestState;
}

describe("runWatchdogPass", () => {
  let state: TestState;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@sangfor/db");
    state = (mod as unknown as { __watchdogTestState: TestState }).__watchdogTestState;
    state.renewals = [];
    state.supportCases = [];
    state.domainDecisionLogs = [];
    state.existingTaskTitles = new Set();
    state.laterResolvedCaseRefs = new Set();
  });

  it("D-30 renewal creates exactly one task with the expected deterministic title", async () => {
    const now = new Date("2026-07-11T00:00:00Z");
    state.renewals = [
      {
        id: "ren-1",
        customerId: "cust-1",
        expiresAt: new Date("2026-08-05T00:00:00Z"), // 25 days out -> bucket 30
        status: "pending",
        customer: { name: "테스트고객" },
      },
    ];

    const result = await runWatchdogPass({ now });

    expect(result.renewalTasksCreated).toBe(1);
    expect(result.skippedExisting).toBe(0);
    expect(prisma.workTask.create).toHaveBeenCalledTimes(1);
    const createArgs = (prisma.workTask.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.title).toBe("[와치독] 리뉴얼 D-30: 테스트고객 (ren-1)");
  });

  it("re-run with the task already existing -> 0 created, skippedExisting >= 1 (idempotency)", async () => {
    const now = new Date("2026-07-11T00:00:00Z");
    state.renewals = [
      {
        id: "ren-1",
        customerId: "cust-1",
        expiresAt: new Date("2026-08-05T00:00:00Z"),
        status: "pending",
        customer: { name: "테스트고객" },
      },
    ];

    const first = await runWatchdogPass({ now });
    expect(first.renewalTasksCreated).toBe(1);

    const second = await runWatchdogPass({ now });
    expect(second.renewalTasksCreated).toBe(0);
    expect(second.skippedExisting).toBeGreaterThanOrEqual(1);
    expect(prisma.workTask.create).toHaveBeenCalledTimes(1);
  });

  it("SLA breach (past deadline) creates a task titled with 위반", async () => {
    const now = new Date("2026-07-11T12:00:00Z");
    state.supportCases = [
      {
        id: "case-1",
        customerId: "cust-2",
        status: "open",
        slaDeadline: new Date("2026-07-10T12:00:00Z"), // already past
        customer: { name: "SLA고객" },
      },
    ];

    const result = await runWatchdogPass({ now });

    expect(result.slaTasksCreated).toBe(1);
    expect(prisma.workTask.create).toHaveBeenCalledTimes(1);
    const createArgs = (prisma.workTask.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.title).toBe("[와치독] SLA 응답 위반: SLA고객 (case-1)");
  });

  it("SLA approaching (within 1 day) creates a task titled with 임박", async () => {
    const now = new Date("2026-07-11T00:00:00Z");
    state.supportCases = [
      {
        id: "case-2",
        customerId: "cust-3",
        status: "open",
        slaDeadline: new Date("2026-07-11T18:00:00Z"), // 18h out, within 1 day
        customer: { name: "임박고객" },
      },
    ];

    const result = await runWatchdogPass({ now });

    expect(result.slaTasksCreated).toBe(1);
    const createArgs = (prisma.workTask.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.data.title).toBe("[와치독] SLA 응답 임박: 임박고객 (case-2)");
  });

  it("no data -> all zeros", async () => {
    const now = new Date("2026-07-11T00:00:00Z");

    const result = await runWatchdogPass({ now });

    expect(result).toEqual({
      renewalTasksCreated: 0,
      slaTasksCreated: 0,
      cfoEscalations: [],
      skippedExisting: 0,
    });
    expect(prisma.workTask.create).not.toHaveBeenCalled();
  });

  it("renewal outside D-90 window is not touched", async () => {
    const now = new Date("2026-07-11T00:00:00Z");
    state.renewals = [
      {
        id: "ren-far",
        customerId: "cust-far",
        expiresAt: new Date("2026-12-01T00:00:00Z"), // ~140 days out
        status: "pending",
        customer: { name: "먼고객" },
      },
    ];

    const result = await runWatchdogPass({ now });

    expect(result.renewalTasksCreated).toBe(0);
    expect(prisma.workTask.create).not.toHaveBeenCalled();
  });

  it("cfo orange-fail row older than 7 days with no later resolution -> listed, no task created", async () => {
    const now = new Date("2026-07-11T00:00:00Z");
    state.domainDecisionLogs = [
      {
        id: "dec-1",
        caseRef: "opp:opp-1",
        colorGateJson: { required: ["orange"], reviewed: ["orange"], failed: ["orange"], pass: false },
        createdAt: new Date("2026-07-01T00:00:00Z"), // 10 days old
      },
    ];

    const result = await runWatchdogPass({ now });

    expect(result.cfoEscalations).toEqual([{ caseRef: "opp:opp-1", ageDays: 10 }]);
    expect(prisma.workTask.create).not.toHaveBeenCalled();
  });

  it("cfo orange-fail row WITH a later resolved row on the same caseRef is excluded", async () => {
    const now = new Date("2026-07-11T00:00:00Z");
    state.domainDecisionLogs = [
      {
        id: "dec-1",
        caseRef: "opp:opp-2",
        colorGateJson: { required: ["orange"], reviewed: ["orange"], failed: ["orange"], pass: false },
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
    ];
    state.laterResolvedCaseRefs.add("opp:opp-2");

    const result = await runWatchdogPass({ now });

    expect(result.cfoEscalations).toEqual([]);
  });
});
