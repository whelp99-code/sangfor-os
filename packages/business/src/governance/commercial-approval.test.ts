import { describe, expect, it } from "vitest";

import { calculateGrossMargin, evaluateCommercialApproval } from "./commercial-approval";

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
