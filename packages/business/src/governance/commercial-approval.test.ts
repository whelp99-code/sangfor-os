import { describe, expect, it } from "vitest";

import {
  calculateGrossMargin,
  evaluateCommercialApproval,
  evaluateWithPolicySnapshot,
  DEFAULT_COMMERCIAL_POLICY,
} from "./commercial-approval";

describe("commercial approval gate", () => {
  it("calculates gross margin percentage on the server", () => {
    expect(
      calculateGrossMargin({
        revenue: 100_000,
        cost: 70_000,
        discountPercent: 10,
        action: "export",
      }),
    ).toEqual({
      revenue: 100_000,
      cost: 70_000,
      grossMargin: 30_000,
      grossMarginPercent: 30,
    });
  });

  it("requires approval for low margin exports", () => {
    expect(
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 88_000,
        discountPercent: 5,
        action: "export",
      }),
    ).toMatchObject({
      decision: "requires_approval",
      blocked: true,
      reasons: ["low_margin", "unsafe_action"],
    });
  });

  it("requires approval for high discount even when margin is acceptable", () => {
    expect(
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 60_000,
        discountPercent: 25,
        action: "send",
      }),
    ).toMatchObject({
      decision: "requires_approval",
      blocked: true,
      reasons: ["high_discount", "unsafe_action"],
    });
  });

  it("allows review-only actions when commercial thresholds are healthy", () => {
    expect(
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 60_000,
        discountPercent: 5,
        action: "view-dashboard",
      }),
    ).toMatchObject({
      decision: "allowed",
      blocked: false,
      reasons: [],
    });
  });

  it("rejects non-finite discount and threshold inputs", () => {
    expect(() =>
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 60_000,
        discountPercent: Number.NaN,
        highDiscountThresholdPercent: Number.NaN,
        action: "view-dashboard",
      }),
    ).toThrow("commercial_discount_must_be_percentage");
  });
});

describe("policy-snapshot evaluation (U048)", () => {
  it("DEFAULT_COMMERCIAL_POLICY has documented thresholds", () => {
    expect(DEFAULT_COMMERCIAL_POLICY).toMatchObject({
      policyKey: "quote.internal_release",
      policyVersion: "v1",
      lowMarginThresholdPercent: 15,
      highDiscountThresholdPercent: 25,
      requiredQuorum: 2,
      requiredRoles: ["finance", "ceo"],
    });
  });

  it("evaluateWithPolicySnapshot returns policy-bound decision for healthy margin", () => {
    const result = evaluateWithPolicySnapshot(
      { revenue: 100_000, cost: 60_000, discountPercent: 5, action: "quote.internal_release" },
      DEFAULT_COMMERCIAL_POLICY,
    );
    expect(result.decision).toBe("allowed");
    expect(result.blocked).toBe(false);
    expect(result.policyKey).toBe("quote.internal_release");
    expect(result.policyVersion).toBe("v1");
    expect(result.requiredQuorum).toBe(2);
    expect(result.requiredRoles).toEqual(["finance", "ceo"]);
  });

  it("evaluateWithPolicySnapshot blocks low margin with policy metadata", () => {
    const result = evaluateWithPolicySnapshot(
      { revenue: 100_000, cost: 90_000, discountPercent: 0, action: "quote.internal_release" },
      DEFAULT_COMMERCIAL_POLICY,
    );
    expect(result.decision).toBe("requires_approval");
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("low_margin");
    expect(result.policyKey).toBe("quote.internal_release");
  });

  it("evaluateWithPolicySnapshot blocks high discount with policy metadata", () => {
    const result = evaluateWithPolicySnapshot(
      { revenue: 100_000, cost: 50_000, discountPercent: 30, action: "quote.internal_release" },
      DEFAULT_COMMERCIAL_POLICY,
    );
    expect(result.decision).toBe("requires_approval");
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("high_discount");
  });

  it("custom policy snapshot overrides default thresholds", () => {
    const strictPolicy = {
      ...DEFAULT_COMMERCIAL_POLICY,
      policyVersion: "v2-strict",
      lowMarginThresholdPercent: 30,
      highDiscountThresholdPercent: 10,
    };
    const result = evaluateWithPolicySnapshot(
      { revenue: 100_000, cost: 75_000, discountPercent: 5, action: "quote.internal_release" },
      strictPolicy,
    );
    expect(result.decision).toBe("requires_approval");
    expect(result.reasons).toContain("low_margin");
    expect(result.policyVersion).toBe("v2-strict");
  });
});
