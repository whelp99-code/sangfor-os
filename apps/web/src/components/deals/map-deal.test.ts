import { describe, expect, it } from "vitest";

import { toDeal } from "@/components/deals/map-deal";
import type { SerializedOpportunityForDeal } from "@/components/deals/map-deal";

const base: SerializedOpportunityForDeal = {
  id: "opp-1",
  code: "PRJ-2025-0001",
  title: "Test Deal",
  stage: "QUALIFIED",
  probability: 50,
  amount: 1000000,
  customer: { name: "Acme Corp" },
  partner: { name: "Partner Co" },
  closeDate: new Date("2025-12-31T00:00:00.000Z"),
  nextAction: "Follow up call",
  updatedAt: new Date("2025-06-01T12:00:00.000Z"),
};

describe("toDeal", () => {
  it("maps all real fields from a serialized opportunity", () => {
    const deal = toDeal(base);
    expect(deal.id).toBe("opp-1");
    expect(deal.code).toBe("PRJ-2025-0001");
    expect(deal.title).toBe("Test Deal");
    expect(deal.stage).toBe("QUALIFIED");
    expect(deal.probability).toBe(50);
    expect(deal.amount).toBe(1000000);
    expect(deal.customer).toBe("Acme Corp");
    expect(deal.partner).toBe("Partner Co");
    expect(deal.nextAction).toBe("Follow up call");
    expect(deal.closeDate).toBe("2025-12-31T00:00:00.000Z");
    expect(deal.updatedAt).toBe("2025-06-01T12:00:00.000Z");
  });

  it("sets placeholder fields to null", () => {
    const deal = toDeal(base);
    expect(deal.dealStatus).toBeNull();
    expect(deal.marginPct).toBeNull();
    expect(deal.productLine).toBeNull();
    expect(deal.regStatus).toBeNull();
    expect(deal.owner).toBeNull();
  });

  it("coerces null code to null", () => {
    const deal = toDeal({ ...base, code: null });
    expect(deal.code).toBeNull();
  });

  it("coerces missing code to null", () => {
    const { code: _code, ...withoutCode } = base;
    const deal = toDeal(withoutCode);
    expect(deal.code).toBeNull();
  });

  it("defaults probability to 0 when missing", () => {
    const deal = toDeal({ ...base, probability: null });
    expect(deal.probability).toBe(0);
  });

  it("sets amount to null when absent", () => {
    const deal = toDeal({ ...base, amount: null });
    expect(deal.amount).toBeNull();
  });

  it("sets closeDate to null when absent", () => {
    const deal = toDeal({ ...base, closeDate: null });
    expect(deal.closeDate).toBeNull();
  });

  it("sets customer to null when customer is absent", () => {
    const deal = toDeal({ ...base, customer: null });
    expect(deal.customer).toBeNull();
  });

  it("sets partner to null when partner is absent", () => {
    const deal = toDeal({ ...base, partner: null });
    expect(deal.partner).toBeNull();
  });

  it("accepts a string closeDate and normalizes to ISO", () => {
    const deal = toDeal({ ...base, closeDate: "2025-12-31" });
    expect(deal.closeDate).toBe(new Date("2025-12-31").toISOString());
  });

  it("handles numeric-string amount via Number coercion path", () => {
    // Simulate a Decimal-like object with toString
    const decimalLike = { toString: () => "2500000" } as unknown as number;
    const deal = toDeal({ ...base, amount: decimalLike });
    expect(deal.amount).toBe(2500000);
  });
});
