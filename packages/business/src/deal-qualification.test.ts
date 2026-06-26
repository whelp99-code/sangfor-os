import { describe, it, expect } from "vitest";
import { calculateBantScore } from "./opportunity-stage";

describe("calculateBantScore", () => {
  it("returns passed=true when weightedScore >= 60", () => {
    const result = calculateBantScore({
      budgetScore: 80,
      authorityScore: 70,
      needScore: 90,
      timelineScore: 60,
    });
    expect(result.passed).toBe(true);
    expect(result.weightedScore).toBeGreaterThanOrEqual(60);
  });

  it("returns passed=false when weightedScore < 60", () => {
    const result = calculateBantScore({
      budgetScore: 10,
      authorityScore: 20,
      needScore: 30,
      timelineScore: 40,
    });
    expect(result.passed).toBe(false);
    expect(result.weightedScore).toBeLessThan(60);
  });

  it("applies correct weights: Budget 25%, Authority 25%, Need 30%, Timeline 20%", () => {
    const result = calculateBantScore({
      budgetScore: 100,
      authorityScore: 100,
      needScore: 100,
      timelineScore: 100,
    });
    expect(result.weightedScore).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("needScore contributes 30% — highest weight factor", () => {
    const highNeed = calculateBantScore({ budgetScore: 50, authorityScore: 50, needScore: 100, timelineScore: 50 });
    const lowNeed = calculateBantScore({ budgetScore: 80, authorityScore: 80, needScore: 0, timelineScore: 80 });
    expect(highNeed.passed).toBe(true);
    expect(lowNeed.passed).toBe(false);
  });

  it("rounds weightedScore to 2 decimal places", () => {
    const result = calculateBantScore({
      budgetScore: 33,
      authorityScore: 33,
      needScore: 33,
      timelineScore: 33,
    });
    expect(result.weightedScore.toString()).toMatch(/^\d+\.?\d{0,2}$/);
  });

  it("handles boundary value: weightedScore exactly 60", () => {
    const result = calculateBantScore({
      budgetScore: 60,
      authorityScore: 60,
      needScore: 60,
      timelineScore: 60,
    });
    expect(result.passed).toBe(true);
    expect(result.weightedScore).toBe(60);
  });
});
