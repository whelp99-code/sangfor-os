import { describe, it, expect } from "vitest";
import { getDecisionStats } from "./ai-decision-analytics";

/**
 * Fake prisma exposing only domainDecisionLog.groupBy + findMany that
 * getDecisionStats consumes. Mirrors domain-dashboard.ts:150 groupBy pattern.
 */
function fakeStatsPrisma() {
  const rows = [
    { actor: "sales", actionType: "stage_transition", outcome: "approved", predictedConfidence: null },
    { actor: "sales", actionType: "stage_transition", outcome: "approved", predictedConfidence: null },
    { actor: "sales", actionType: "stage_transition", outcome: "rejected", predictedConfidence: null },
    { actor: "sales", actionType: "mail_revalidation", outcome: "approved", predictedConfidence: 0.91 },
    { actor: "sales", actionType: "mail_revalidation", outcome: "corrected", predictedConfidence: 0.62 },
    { actor: "cfo", actionType: "mail_revalidation", outcome: "rejected", predictedConfidence: 0.35 },
  ];

  return {
    domainDecisionLog: {
      groupBy: async ({ by }: { by: string[] }) => {
        // group by (actor, actionType, outcome)
        const map = new Map<string, { key: Record<string, unknown>; count: number }>();
        for (const r of rows) {
          const key: Record<string, unknown> = {};
          for (const k of by) key[k] = (r as Record<string, unknown>)[k];
          const id = JSON.stringify(key);
          const entry = map.get(id) ?? { key, count: 0 };
          entry.count += 1;
          map.set(id, entry);
        }
        return [...map.values()].map((e) => ({ ...e.key, _count: { _all: e.count } }));
      },
      findMany: async () => rows.map((r) => ({ predictedConfidence: r.predictedConfidence })),
    },
  };
}

describe("getDecisionStats", () => {
  it("aggregates approved/rejected/corrected counts per (actor, actionType)", async () => {
    const stats = await getDecisionStats(
      { prisma: fakeStatsPrisma() as never },
    );

    const salesStage = stats.byActorAction.find(
      (g) => g.actor === "sales" && g.actionType === "stage_transition",
    );
    expect(salesStage).toBeTruthy();
    expect(salesStage!.approved).toBe(2);
    expect(salesStage!.rejected).toBe(1);
    expect(salesStage!.corrected).toBe(0);
    expect(salesStage!.total).toBe(3);

    const salesMail = stats.byActorAction.find(
      (g) => g.actor === "sales" && g.actionType === "mail_revalidation",
    );
    expect(salesMail!.approved).toBe(1);
    expect(salesMail!.corrected).toBe(1);
    expect(salesMail!.total).toBe(2);
  });

  it("buckets predicted confidence (low/medium/high) ignoring nulls", async () => {
    const stats = await getDecisionStats({ prisma: fakeStatsPrisma() as never });
    // 0.91 → high, 0.62 → medium, 0.35 → low ; nulls excluded
    expect(stats.confidenceBuckets.high).toBe(1);
    expect(stats.confidenceBuckets.medium).toBe(1);
    expect(stats.confidenceBuckets.low).toBe(1);
  });

  it("returns empty aggregates on no rows without throwing", async () => {
    const empty = {
      domainDecisionLog: {
        groupBy: async () => [],
        findMany: async () => [],
      },
    };
    const stats = await getDecisionStats({ prisma: empty as never });
    expect(stats.byActorAction).toEqual([]);
    expect(stats.confidenceBuckets).toEqual({ low: 0, medium: 0, high: 0 });
  });
});
