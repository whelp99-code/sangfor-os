import { describe, expect, it } from "vitest";

import { evaluateCandidateColorGate } from "./color-gate";

describe("evaluateCandidateColorGate", () => {
  it("passes a high-confidence approved opportunity candidate", () => {
    const g = evaluateCandidateColorGate({
      candidateType: "opportunity",
      confidence: 88,
      revalidation: "approve_candidate",
      hasSummary: true,
    });
    expect(g.mode).toBe("deterministic");
    expect(g.lenses.gray).toBe("pass");
    expect(g.lenses.red).toBe("pass");
    expect(g.pass).toBe(true);
  });

  it("flags Red when revalidation recommends reject", () => {
    const g = evaluateCandidateColorGate({
      candidateType: "opportunity",
      confidence: 80,
      revalidation: "reject",
      hasSummary: true,
    });
    expect(g.lenses.red).toBe("fail");
    expect(g.failed).toContain("red");
  });

  it("fails Orange (가치) for a low-margin commercial candidate", () => {
    const g = evaluateCandidateColorGate({
      candidateType: "opportunity",
      confidence: 85,
      hasSummary: true,
      marginPercent: 12,
    });
    expect(g.lenses.orange).toBe("fail");
  });

  it("requires the commercial (orange) lens for opportunities and gates on it", () => {
    const g = evaluateCandidateColorGate({
      candidateType: "opportunity",
      confidence: 45, // low → orange fails (conf<60), high risk
      hasSummary: false,
    });
    expect(g.required).toContain("orange");
    expect(g.pass).toBe(false);
  });

  it("marks Teal n/a when there is no summary to review", () => {
    const g = evaluateCandidateColorGate({
      candidateType: "task",
      confidence: 90,
      hasSummary: false,
    });
    expect(g.lenses.teal).toBe("na");
    expect(g.reviewed).not.toContain("teal");
  });
});
