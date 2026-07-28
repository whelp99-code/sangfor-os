import { describe, expect, it } from "vitest";
import {
  evaluateSizingRule,
  evaluateCompatibilityRule,
  RuleEngineError,
  validateRulePayload,
} from "./rule-engine";

describe("Catalog Rule Engine (U046 Unit Tests)", () => {
  it("rejects unknown operators or executable code payloads", () => {
    const maliciousSizing = {
      version: "v1",
      rules: [
        {
          field: "userCount",
          operator: "$where",
          value: "this.userCount > 100",
        },
      ],
    };

    expect(() => evaluateSizingRule(maliciousSizing as any, { userCount: 150 })).toThrow(RuleEngineError);
  });

  it("rejects prototype pollution keys (__proto__, constructor, prototype)", () => {
    const protoPayload = JSON.parse(`{
      "version": "v1",
      "__proto__": { "admin": true },
      "rules": []
    }`);

    expect(() => validateRulePayload(protoPayload)).toThrow(RuleEngineError);
  });

  it("rejects NaN and Infinity in rule payloads", () => {
    const nanPayload = {
      version: "v1",
      tiers: [
        {
          minUsers: NaN,
          maxUsers: Infinity,
          recommendedSkuId: "sku-nan",
        },
      ],
    };

    expect(() => validateRulePayload(nanPayload)).toThrow(RuleEngineError);
  });

  it("produces deterministic output for identical input and rule version", () => {
    const sizingRule = {
      version: "v1" as const,
      baseSkuId: "sku-base-01",
      tiers: [
        {
          minUsers: 1,
          maxUsers: 100,
          recommendedSkuId: "sku-tier-1",
          recommendedCpu: 4,
          recommendedRamGb: 16,
        },
      ],
    };

    const res1 = evaluateSizingRule(sizingRule, { userCount: 50 });
    const res2 = evaluateSizingRule(sizingRule, { userCount: 50 });

    expect(res1).toEqual(res2);
    expect(res1.recommendedSkuId).toBe("sku-tier-1");
    expect(res1.solutionFitPassed).toBe(true);
  });

  it("evaluates compatibility rule and produces blocking reasons when incompatible", () => {
    const compatRule = {
      version: "v1" as const,
      sourceSkuId: "sku-src-01",
      targetSkuId: "sku-tgt-01",
      conditions: [
        {
          field: "osVersion",
          operator: "gte" as const,
          value: 10,
        },
      ],
      incompatibleSeverity: "BLOCKER" as const,
      incompatibleMessage: "Target OS version must be >= 10",
    };

    const res = evaluateCompatibilityRule(compatRule, { osVersion: 8 });
    expect(res.compatible).toBe(false);
    expect(res.blockingReasons).toContain("Target OS version must be >= 10");
    expect(res.solutionFitPassed).toBe(false);
  });
});
