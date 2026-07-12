import { describe, it, expect } from "vitest";

import { computeDealRisk } from "./deal-risk";

describe("computeDealRisk", () => {
  it("flags a long-dwelling deal with gate failures as high risk, with each factor explained", () => {
    const result = computeDealRisk({
      stageDwellDays: 45,
      mailSilenceDays: 20,
      lensFailCount: 2,
      probability: 20,
      amount: 50_000_000,
      stage: "NEGOTIATION",
    });

    expect(result.level).toBe("high");
    expect(result.score).toBeGreaterThan(66);

    const byKey = Object.fromEntries(result.factors.map((f) => [f.key, f]));
    expect(byKey.stage_dwell?.contribution).toBeGreaterThan(0);
    expect(byKey.mail_silence?.contribution).toBeGreaterThan(0);
    expect(byKey.lens_fail?.contribution).toBeGreaterThan(0);
    expect(byKey.probability?.contribution).toBeGreaterThan(0);
    for (const factor of result.factors) {
      expect(factor.note.length).toBeGreaterThan(0);
    }
  });

  it("scores a fresh deal with high win probability as low risk", () => {
    const result = computeDealRisk({
      stageDwellDays: 3,
      mailSilenceDays: 1,
      lensFailCount: 0,
      probability: 80,
      amount: 10_000_000,
      stage: "PROPOSAL",
    });

    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(34);
  });

  it("does not throw and assigns zero contribution when mail silence is unknown", () => {
    const result = computeDealRisk({
      stageDwellDays: 10,
      mailSilenceDays: null,
      lensFailCount: 0,
      probability: 70,
      stage: "QUALIFIED",
    });

    const mailSilence = result.factors.find((f) => f.key === "mail_silence");
    expect(mailSilence).toBeDefined();
    expect(mailSilence?.contribution).toBe(0);
    expect(mailSilence?.note).toMatch(/데이터 없음/);
  });

  it("clamps score to the 0-100 range even under extreme inputs", () => {
    const result = computeDealRisk({
      stageDwellDays: 9999,
      mailSilenceDays: 9999,
      lensFailCount: 999,
      probability: 0,
      amount: 999_000_000_000,
      stage: "LEAD",
    });

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.level).toBe("high");
  });

  it("keeps every factor's contribution honestly summing to the pre-clamp score, with no forced non-zero contributions for missing signals", () => {
    const result = computeDealRisk({
      stageDwellDays: 5,
      mailSilenceDays: null,
      lensFailCount: 0,
      stage: "LEAD",
    });

    const total = result.factors.reduce((sum, f) => sum + f.contribution, 0);
    expect(total).toBe(result.score);

    const mailSilence = result.factors.find((f) => f.key === "mail_silence");
    const probability = result.factors.find((f) => f.key === "probability");
    expect(mailSilence?.contribution).toBe(0);
    expect(probability?.contribution).toBe(0);
  });

  it("raises risk for an overdue deal with no next action, each explained", () => {
    const result = computeDealRisk({
      stageDwellDays: 5,
      probability: 35,
      overdueDays: 40,
      hasNextAction: false,
      stage: "PROPOSAL",
    });

    const byKey = Object.fromEntries(result.factors.map((f) => [f.key, f]));
    expect(byKey.overdue?.contribution).toBeGreaterThan(0);
    expect(byKey.overdue?.note).toMatch(/마감일/);
    expect(byKey.next_action?.contribution).toBe(10);
    expect(byKey.next_action?.note).toMatch(/방치/);
    expect(result.level).not.toBe("low");
  });

  it("assigns zero contribution when overdue/next-action signals are absent", () => {
    const result = computeDealRisk({ stageDwellDays: 5, stage: "LEAD" });
    const byKey = Object.fromEntries(result.factors.map((f) => [f.key, f]));
    expect(byKey.overdue?.contribution).toBe(0);
    expect(byKey.next_action?.contribution).toBe(0);
    expect(result.factors.reduce((s, f) => s + f.contribution, 0)).toBe(result.score);
  });

  it("excludes WON/LOST deals from the risk score entirely, explained as terminal", () => {
    const won = computeDealRisk({ stageDwellDays: 100, mailSilenceDays: 60, lensFailCount: 5, stage: "WON" });
    expect(won.score).toBe(0);
    expect(won.level).toBe("low");
    expect(won.factors).toHaveLength(1);
    expect(won.factors[0]?.note).toMatch(/종료/);

    const lost = computeDealRisk({ stageDwellDays: 100, stage: "LOST" });
    expect(lost.score).toBe(0);
  });
});
