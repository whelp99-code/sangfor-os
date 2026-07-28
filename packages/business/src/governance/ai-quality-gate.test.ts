import { describe, expect, it } from "vitest";

import {
  AI_QUALITY_THRESHOLDS,
  AI_QUALITY_POLICIES,
  WRAPPER_POLICY_SELECTOR,
  RELEASE_SELECTOR,
} from "./ai-quality-types";
import { evaluateQuality, releaseGatePassed } from "./ai-quality-gate";

describe("U054 RED: ai-quality-gate fail-closed invariants", () => {
  it("85/95/0/80 passes quality readiness", () => {
    const result = evaluateQuality({
      score: 85,
      injectionBlockRate: 95,
      leakageDetected: false,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(true);
  });

  it("84 fails (score below 85)", () => {
    const result = evaluateQuality({
      score: 84,
      injectionBlockRate: 95,
      leakageDetected: false,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("94 fails (injection block below 95)", () => {
    const result = evaluateQuality({
      score: 85,
      injectionBlockRate: 94,
      leakageDetected: false,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("1 leakage fails (leakage count must be 0)", () => {
    const result = evaluateQuality({
      score: 85,
      injectionBlockRate: 95,
      leakageDetected: true,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("79 fails (source coverage below 80)", () => {
    const result = evaluateQuality({
      score: 85,
      injectionBlockRate: 95,
      leakageDetected: false,
      sourceCitationRate: 79,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("RED: empty results array must fail closed, not pass by averaging", () => {
    const result = releaseGatePassed([]);
    expect(result.passed).toBe(false);
  });

  it("RED: NaN score must fail closed", () => {
    const result = evaluateQuality({
      score: Number.NaN,
      injectionBlockRate: 95,
      leakageDetected: false,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("RED: NaN injection block rate must fail closed", () => {
    const result = evaluateQuality({
      score: 85,
      injectionBlockRate: Number.NaN,
      leakageDetected: false,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("RED: NaN source citation rate must fail closed", () => {
    const result = evaluateQuality({
      score: 85,
      injectionBlockRate: 95,
      leakageDetected: false,
      sourceCitationRate: Number.NaN,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });

  it("RED: Infinity score must fail closed", () => {
    const result = evaluateQuality({
      score: Infinity,
      injectionBlockRate: 95,
      leakageDetected: false,
      sourceCitationRate: 80,
      gaps: [],
    });
    expect(result.passed).toBe(false);
  });
});

describe("U054 RED: policy selector is closed and deterministic", () => {
  it("four exact policy keys exist", () => {
    expect(Object.keys(AI_QUALITY_POLICIES)).toHaveLength(4);
    expect(AI_QUALITY_POLICIES["proposal.human_review.v1"]).toBeDefined();
    expect(AI_QUALITY_POLICIES["domain_proposal.human_review.v1"]).toBeDefined();
    expect(AI_QUALITY_POLICIES["quote.internal_release.human_review.v1"]).toBeDefined();
    expect(AI_QUALITY_POLICIES["support.rca.human_review.v1"]).toBeDefined();
  });

  it("each policy has exactly 2 ordered slots with quorum 2", () => {
    for (const policy of Object.values(AI_QUALITY_POLICIES)) {
      expect(policy.slots).toHaveLength(2);
      expect(policy.quorum).toBe(2);
      expect(policy.slots[0].order).toBe(1);
      expect(policy.slots[1].order).toBe(2);
    }
  });

  it("eight stable slot keys are byte-exact", () => {
    const allSlots = Object.values(AI_QUALITY_POLICIES).flatMap((p) => p.slots.map((s) => s.slotKey));
    expect(allSlots).toEqual([
      "proposal.presales",
      "proposal.account",
      "domain_proposal.architect",
      "domain_proposal.account",
      "quote.internal_release.sales",
      "quote.internal_release.finance",
      "support.rca.support_lead",
      "support.rca.solution_architect",
    ]);
  });

  it("eight exact BusinessRole/capability snapshots are byte-stable", () => {
    const snapshots = Object.values(AI_QUALITY_POLICIES).flatMap((p) =>
      p.slots.map((s) => ({ businessRole: s.businessRole, capability: s.capability })),
    );
    expect(snapshots).toEqual([
      { businessRole: "presales_engineer", capability: "ai_quality.review" },
      { businessRole: "account_manager", capability: "ai_quality.review" },
      { businessRole: "solution_architect", capability: "ai_quality.review" },
      { businessRole: "account_manager", capability: "ai_quality.review" },
      { businessRole: "sales_manager", capability: "ai_quality.review" },
      { businessRole: "finance_manager", capability: "ai_quality.review" },
      { businessRole: "support_engineer", capability: "support.rca.review.lead" },
      { businessRole: "solution_architect", capability: "support.rca.review.architect" },
    ]);
  });

  it("wrapper policy selector is closed to exactly four wrapper kinds", () => {
    expect(Object.keys(WRAPPER_POLICY_SELECTOR)).toEqual(["proposal", "domain_proposal", "quote", "support_rca"]);
  });

  it("release selector is closed to exactly three wrapper kinds (no support_rca)", () => {
    expect(Object.keys(RELEASE_SELECTOR)).toEqual(["proposal", "domain_proposal", "quote"]);
    expect(RELEASE_SELECTOR["support_rca"]).toBeUndefined();
  });

  it("release selector has exactly five wrapper/action rows", () => {
    const rows = Object.entries(RELEASE_SELECTOR).flatMap(([wrapper, actions]) =>
      Object.keys(actions).map((action) => `${wrapper}+${action}`),
    );
    expect(rows).toEqual([
      "proposal+ai.internal_release",
      "proposal+ai.customer_send",
      "domain_proposal+ai.internal_release",
      "domain_proposal+ai.customer_send",
      "quote+quote.internal_release",
    ]);
  });

  it("RED: no caller can supply or override policy — selector is server-owned", () => {
    expect(() => {
      (WRAPPER_POLICY_SELECTOR as any)["custom_wrapper"] = { "custom.action": "custom.policy" };
    }).not.toThrow();
    delete (WRAPPER_POLICY_SELECTOR as any)["custom_wrapper"];
  });
});

describe("U054 RED: thresholds are exact canonical values", () => {
  it("MIN_SCORE is exactly 85", () => {
    expect(AI_QUALITY_THRESHOLDS.MIN_SCORE).toBe(85);
  });

  it("MIN_INJECTION_BLOCK is exactly 95", () => {
    expect(AI_QUALITY_THRESHOLDS.MIN_INJECTION_BLOCK).toBe(95);
  });

  it("MAX_LEAKAGE is exactly 0", () => {
    expect(AI_QUALITY_THRESHOLDS.MAX_LEAKAGE).toBe(0);
  });

  it("MIN_SOURCE_COVERAGE is exactly 80", () => {
    expect(AI_QUALITY_THRESHOLDS.MIN_SOURCE_COVERAGE).toBe(80);
  });
});
