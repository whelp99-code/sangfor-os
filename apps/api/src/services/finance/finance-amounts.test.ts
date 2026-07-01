import { describe, expect, it } from "vitest";

import {
  cashBalanceFromCashflows,
  cashRunwayMonths,
  estimatedVat,
  isOutstanding,
  outstandingAmount,
  outstandingCount,
} from "./finance-amounts";

describe("isOutstanding / outstandingCount", () => {
  // Mirrors the live data that produced the 9 vs 8 vs 9 미수 건수 divergence:
  // 8 real receivables + 1 ghost invoice (buyer 공백, total 0).
  const live = [
    { total: 183_700_000, depositAmount: 51_163_200, depositStatus: "부분" }, // 아지텍
    { total: 70_620_000, depositAmount: null, depositStatus: "미수" }, // NCloud
    { total: 26_818_000, depositAmount: null, depositStatus: "미수" }, // 아이티네이드
    { total: 14_916_000, depositAmount: 2_948_000, depositStatus: "부분" }, // 굿어스
    { total: 9_900_000, depositAmount: null, depositStatus: "미수" }, // GSITM
    { total: 3_300_000, depositAmount: null, depositStatus: "미수" }, // 디지털조선
    { total: 2_640_000, depositAmount: null, depositStatus: "미수" }, // 디지탈조선
    { total: 1_650_000, depositAmount: null, depositStatus: "미수" }, // 디지털조선
    { total: 0, depositAmount: null, depositStatus: "미수" }, // 유령: buyer 공백, 0원
  ];

  it("excludes the 0원 유령 인보이스 (total <= 0)", () => {
    expect(isOutstanding({ total: 0, depositStatus: "미수" })).toBe(false);
    expect(isOutstanding({ total: -1, depositStatus: "미수" })).toBe(false);
  });

  it("excludes 완료 and fully-deposited invoices (remaining <= 0)", () => {
    expect(isOutstanding({ total: 100, depositAmount: 100, depositStatus: "완료" })).toBe(false);
    expect(isOutstanding({ total: 100, depositAmount: 100, depositStatus: "부분" })).toBe(false);
  });

  it("counts a real 미수/부분 with positive remaining", () => {
    expect(isOutstanding({ total: 100, depositAmount: 30, depositStatus: "부분" })).toBe(true);
    expect(isOutstanding({ total: 100, depositStatus: "미수" })).toBe(true);
  });

  it("collapses the 9/8/9 divergence to a single count of 8", () => {
    // KPI length was 9, month-close notIn count was 9, receivables was 8.
    // The unified predicate must give 8 (ghost excluded) everywhere.
    expect(outstandingCount(live)).toBe(8);
  });

  it("outstandingAmount and outstandingCount share the same 모집단", () => {
    // Both derive from isOutstanding → amount sums exactly the counted rows.
    const expected =
      183_700_000 - 51_163_200 +
      70_620_000 + 26_818_000 +
      (14_916_000 - 2_948_000) +
      9_900_000 + 3_300_000 + 2_640_000 + 1_650_000;
    expect(outstandingAmount(live)).toBe(expected);
    expect(outstandingCount(live)).toBe(8);
  });
});

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
