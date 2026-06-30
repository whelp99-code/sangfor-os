import { describe, expect, it } from "vitest";

import {
  cashBalanceFromCashflows,
  cashRunwayMonths,
  estimatedVat,
  outstandingAmount,
} from "./finance-amounts";

describe("outstandingAmount", () => {
  it("sums (total - depositAmount) for 미완료 invoices, excluding 완료", () => {
    const result = outstandingAmount([
      { total: 110, depositAmount: null, depositStatus: "미수" },
      { total: 220, depositAmount: 0, depositStatus: "부분" },
      { total: 330, depositAmount: 330, depositStatus: "완료" }, // excluded (완료)
    ]);
    // 110 + 220, 완료 제외
    expect(result).toBe(330);
  });

  it("subtracts partial deposits (부분입금 차감) so it is not over-counted", () => {
    // Mirrors real data: 167M invoice with 51.16M 부분입금, 13.56M with 2.95M.
    const result = outstandingAmount([
      { total: 183_700_000, depositAmount: 51_163_200, depositStatus: "부분" },
      { total: 14_916_000, depositAmount: 2_948_000, depositStatus: "부분" },
    ]);
    expect(result).toBe(183_700_000 - 51_163_200 + (14_916_000 - 2_948_000));
  });

  it("uses total (VAT 포함), not amount, as the receivable basis", () => {
    // total = amount + vat = 100 + 10
    expect(outstandingAmount([{ total: 110, depositStatus: "미수" }])).toBe(110);
  });

  it("clamps a per-invoice over-deposit to 0 (cannot offset other receivables)", () => {
    const result = outstandingAmount([
      { total: 100, depositAmount: 150, depositStatus: "부분" }, // remaining -50 → 0
      { total: 200, depositAmount: 0, depositStatus: "미수" },
    ]);
    expect(result).toBe(200);
  });

  it("returns 0 for an empty list", () => {
    expect(outstandingAmount([])).toBe(0);
  });
});

describe("cashBalanceFromCashflows", () => {
  it("is derived from cashflows and is NOT the 미수금 (current cash != outstanding)", () => {
    // 미수금 ~= 259M; cashflow cashChange sum is a different, smaller figure.
    const cashflows = [
      { cashChange: 40_000_000 },
      { cashChange: 20_131_324 },
    ];
    const cash = cashBalanceFromCashflows(cashflows);
    expect(cash).toBe(60_131_324);
    expect(cash).not.toBe(259_432_800); // never equals 미수금
  });

  it("returns null (미산출) when there are no cashflows — does not fabricate cash", () => {
    expect(cashBalanceFromCashflows([])).toBeNull();
  });

  it("accumulates cashChange when no balanceAfter is present", () => {
    expect(
      cashBalanceFromCashflows([
        { cashChange: 100 },
        { cashChange: -30 },
        { cashChange: 5 },
      ]),
    ).toBe(75);
  });

  it("prefers the most recent balanceAfter when available", () => {
    expect(
      cashBalanceFromCashflows([
        { cashChange: 100, balanceAfter: 1000, date: "2026-01-01" },
        { cashChange: -30, balanceAfter: 970, date: "2026-03-01" },
        { cashChange: 5, balanceAfter: 975, date: "2026-02-01" },
      ]),
    ).toBe(970); // latest date = 2026-03-01
  });
});

describe("cashRunwayMonths", () => {
  it("is null when cash is null (미산출)", () => {
    expect(cashRunwayMonths(null, 1_000_000)).toBeNull();
  });

  it("is null when monthly burn is not positive", () => {
    expect(cashRunwayMonths(60_000_000, 0)).toBeNull();
    expect(cashRunwayMonths(60_000_000, -10)).toBeNull();
  });

  it("computes cash / burn rounded to 1 decimal", () => {
    expect(cashRunwayMonths(60_000_000, 20_000_000)).toBe(3);
    expect(cashRunwayMonths(50, 30)).toBe(1.7);
  });
});

describe("estimatedVat", () => {
  it("is salesVat - purchaseVat (positive 납부)", () => {
    expect(estimatedVat(10_000_000, 4_000_000)).toBe(6_000_000);
  });

  it("preserves a negative (환급) instead of clamping to 0", () => {
    // The old bug computed Math.max(0, 0 - purchaseVat) → always 0.
    expect(estimatedVat(1_000_000, 4_000_000)).toBe(-3_000_000);
  });

  it("is not always 0 when there is sales VAT", () => {
    expect(estimatedVat(5_000_000, 0)).toBe(5_000_000);
  });
});
