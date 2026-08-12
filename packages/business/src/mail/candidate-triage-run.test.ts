import { beforeEach, describe, expect, it, vi } from "vitest";

interface CandidateRow {
  id: string;
  candidateType: string;
  confidence: number;
  status: string;
  title: string;
  metadata: unknown;
}

const harness = vi.hoisted(() => ({
  rows: [] as CandidateRow[],
  policies: [] as { key: string; status: string }[],
  updates: [] as { where: { id: string }; data: Record<string, unknown> }[],
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    mailDerivedCandidate: {
      findMany: vi.fn(async (args: { where: { status: unknown } }) => {
        const wanted = args.where.status as string | { in: string[] };
        const match = (row: CandidateRow) =>
          typeof wanted === "string" ? row.status === wanted : wanted.in.includes(row.status);
        return harness.rows.filter(match).map((row) => ({ ...row }));
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        harness.updates.push(args);
        const row = harness.rows.find((r) => r.id === args.where.id);
        if (!row) throw new Error(`no such row ${args.where.id}`);
        Object.assign(row, args.data);
        return { ...row };
      }),
    },
    policyMemory: {
      findMany: vi.fn(async () => harness.policies.filter((p) => p.status === "active")),
    },
  },
}));

import { revertTriageBatch, triageProposedCandidates } from "./candidate-triage-run";

/**
 * 25 decided rows at 70 that no human ever converted, plus one conversion at 95.
 * Every step (70/80/90) therefore has an unconverted sample of 25 below it, so the
 * learner climbs to the highest defensible floor: 90.
 */
function decidedHistory(): CandidateRow[] {
  return [
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `h-low-${i}`,
      candidateType: "task",
      confidence: 70,
      status: "knowledge_only",
      title: `history-low-${i}`,
      metadata: null,
    })),
    {
      id: "h-conv",
      candidateType: "partner",
      confidence: 95,
      status: "converted",
      title: "Partner: Nexias",
      metadata: null,
    },
  ];
}

beforeEach(() => {
  harness.rows = [];
  harness.policies = [];
  harness.updates = [];
});

describe("triageProposedCandidates", () => {
  it("defaults to a dry run that decides but writes nothing", async () => {
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p1",
        candidateType: "task",
        confidence: 60,
        status: "proposed",
        title: "Task: 낮은 신뢰도",
        metadata: null,
      },
    ];

    const report = await triageProposedCandidates();

    expect(report.dryRun).toBe(true);
    expect(report.rules.confidenceFloor).toBe(90);
    expect(report.historySize).toBe(26);
    expect(report.pendingBefore).toBe(1);
    expect(report.automated).toBe(1);
    expect(report.applied).toBe(0);
    expect(report.byRule).toEqual({ low_confidence: 1 });
    expect(harness.updates).toHaveLength(0);
    expect(harness.rows.find((r) => r.id === "p1")?.status).toBe("proposed");
  });

  it("only ever writes knowledge_only, never a converted or approved status", async () => {
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p-low",
        candidateType: "task",
        confidence: 60,
        status: "proposed",
        title: "Task: 낮은 신뢰도",
        metadata: null,
      },
      {
        id: "p-dupe",
        candidateType: "partner",
        confidence: 95,
        status: "proposed",
        title: "Partner: Nexias",
        metadata: null,
      },
    ];

    const report = await triageProposedCandidates({ dryRun: false });

    expect(report.applied).toBe(2);
    expect(harness.updates).toHaveLength(2);
    for (const update of harness.updates) {
      expect(update.data.status).toBe("knowledge_only");
    }
  });

  it("records reversible provenance on every automated row", async () => {
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p-low",
        candidateType: "task",
        confidence: 60,
        status: "proposed",
        title: "Task: 낮은 신뢰도",
        metadata: { existing: "keep me" },
      },
    ];

    const report = await triageProposedCandidates({ dryRun: false });
    const written = harness.updates[0]?.data.metadata as {
      existing?: string;
      autoTriage?: Record<string, unknown>;
    };

    expect(written.existing).toBe("keep me");
    expect(written.autoTriage).toMatchObject({
      batchId: report.batchId,
      rule: "low_confidence",
      previousStatus: "proposed",
    });
    expect(String(written.autoTriage?.evidence)).toContain("90");
  });

  it("leaves a genuinely new high-confidence candidate for a human", async () => {
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p-new",
        candidateType: "opportunity",
        confidence: 93,
        status: "proposed",
        title: "Opportunity: 신규 고객사",
        metadata: null,
      },
    ];

    const report = await triageProposedCandidates({ dryRun: false });

    expect(report.automated).toBe(0);
    expect(report.humanReviewRemaining).toBe(1);
    expect(harness.updates).toHaveLength(0);
  });

  it("files candidates whose entity policy memory already knows", async () => {
    harness.policies = [{ key: "Nexias", status: "active" }];
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p-known",
        candidateType: "customer",
        confidence: 95,
        status: "proposed",
        title: "Customer: Nexias Holdings",
        metadata: null,
      },
    ];

    const report = await triageProposedCandidates({ dryRun: false });

    expect(report.byRule).toEqual({ known_entity: 1 });
    expect(harness.updates[0]?.data.status).toBe("knowledge_only");
  });
});

describe("revertTriageBatch", () => {
  it("restores exactly the rows of one batch and touches no other row", async () => {
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p-low",
        candidateType: "task",
        confidence: 60,
        status: "proposed",
        title: "Task: 낮은 신뢰도",
        metadata: null,
      },
    ];

    const report = await triageProposedCandidates({ dryRun: false });
    expect(harness.rows.find((r) => r.id === "p-low")?.status).toBe("knowledge_only");

    harness.updates = [];
    const reverted = await revertTriageBatch(report.batchId);

    expect(reverted).toBe(1);
    expect(harness.updates).toHaveLength(1);
    expect(harness.rows.find((r) => r.id === "p-low")?.status).toBe("proposed");
    // A human's own knowledge_only decisions from history must survive untouched.
    expect(harness.rows.filter((r) => r.status === "knowledge_only")).toHaveLength(25);
  });

  it("reverts nothing for an unknown batch id", async () => {
    harness.rows = [
      ...decidedHistory(),
      {
        id: "p-low",
        candidateType: "task",
        confidence: 60,
        status: "proposed",
        title: "Task: 낮은 신뢰도",
        metadata: null,
      },
    ];
    await triageProposedCandidates({ dryRun: false });
    harness.updates = [];

    const reverted = await revertTriageBatch("triage-not-a-real-batch");

    expect(reverted).toBe(0);
    expect(harness.updates).toHaveLength(0);
  });
});
