import { describe, expect, it } from "vitest";

import { calculateQuote, createQuoteSnapshot, evaluateQuoteMutation } from "./quote-engine";

describe("quote engine commercial gate", () => {
  it("calculates quote totals and allows healthy review-only quote", () => {
    const quote = calculateQuote([
      { productName: "HCI", quantity: 2, unitPrice: 100_000, costPrice: 60_000, discountPct: 5 },
    ]);

    expect(quote.totalRevenue).toBe(190_000);
    expect(quote.totalCost).toBe(120_000);
    expect(quote.requiresCommercialApproval).toBe(false);
    expect(quote.approvalDecision).toMatchObject({ blocked: false, decision: "allowed", reasons: [] });
  });

  it("requires commercial approval for low margin quote", () => {
    const quote = calculateQuote([
      { productName: "HCI", quantity: 1, unitPrice: 100_000, costPrice: 90_000, discountPct: 0 },
    ]);

    expect(quote.requiresCommercialApproval).toBe(true);
    expect(quote.approvalDecision).toMatchObject({
      blocked: true,
      decision: "requires_approval",
      reasons: expect.arrayContaining(["low_margin"]),
    });
  });

  it("requires commercial approval only when discount exceeds quote threshold", () => {
    const atThreshold = calculateQuote([
      { productName: "SASE", quantity: 1, unitPrice: 100_000, costPrice: 50_000, discountPct: 25 },
    ]);
    const aboveThreshold = calculateQuote([
      { productName: "SASE", quantity: 1, unitPrice: 100_000, costPrice: 50_000, discountPct: 26 },
    ]);

    expect(atThreshold.requiresCommercialApproval).toBe(false);
    expect(atThreshold.approvalDecision.reasons).not.toContain("high_discount");
    expect(aboveThreshold.requiresCommercialApproval).toBe(true);
    expect(aboveThreshold.approvalDecision.reasons).toEqual(expect.arrayContaining(["high_discount"]));
  });

  it("handles zero-revenue quotes as approval-required instead of throwing", () => {
    const quote = calculateQuote([
      { productName: "Free Trial", quantity: 1, unitPrice: 0, costPrice: 0, discountPct: 0 },
    ]);

    expect(quote.totalRevenue).toBe(0);
    expect(quote.requiresCommercialApproval).toBe(true);
    expect(quote.approvalDecision).toMatchObject({
      blocked: true,
      decision: "requires_approval",
      grossMarginPercent: 0,
      reasons: ["low_margin"],
    });
  });

  it("rejects invalid commercial inputs", () => {
    expect(() =>
      calculateQuote([
        { productName: "Bad", quantity: 1, unitPrice: 100_000, costPrice: 50_000, discountPct: Number.NaN },
      ]),
    ).toThrow("quote_discount_must_be_percentage");
  });
});

describe("quote versioning and immutability", () => {
  it("creates an immutable quote snapshot from calculated quote output", () => {
    const quote = calculateQuote([
      { productName: "HCI", quantity: 1, unitPrice: 100_000, costPrice: 60_000, discountPct: 5 },
    ]);

    expect(createQuoteSnapshot({ quoteId: "quote-1", version: 1, status: "draft", quote })).toEqual({
      quoteId: "quote-1",
      version: 1,
      status: "draft",
      lineItems: quote.lineItems,
      totals: {
        revenue: 95_000,
        cost: 60_000,
      },
      margin: {
        amount: 35_000,
        pct: quote.overallMarginPct,
      },
      totalRevenue: 95_000,
      totalCost: 60_000,
      totalMargin: 35_000,
      overallMarginPct: quote.overallMarginPct,
      approvalDecision: quote.approvalDecision,
    });
  });

  it("blocks mutation after quote approval", () => {
    expect(evaluateQuoteMutation({ status: "approved", action: "edit-line-items" })).toEqual({
      allowed: false,
      reason: "approved_quote_is_immutable",
    });
  });

  it("allows draft quote mutation", () => {
    expect(evaluateQuoteMutation({ status: "draft", action: "edit-line-items" })).toEqual({ allowed: true });
  });
});
