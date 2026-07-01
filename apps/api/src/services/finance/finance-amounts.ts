/**
 * Finance amount SSOT (single source of truth) helpers.
 *
 * These pure functions centralize the amount-basis policy so that every
 * surface (dashboard KPI, dashboard 미수금 panel, month-close summary) computes
 * the same number the same way. Mixing bases was the root cause of the
 * 미수금 285M/259M/313M divergence and the "현금 = 미수금" runway error.
 *
 * Amount policy:
 *   - supply = `amount`          (공급가, pre-VAT)
 *   - total  = `amount + vat`    (VAT 포함; persisted on Invoice.total)
 *   - 미수금(outstanding) = Σ(total - depositAmount) for 미완료 invoices
 *                          → VAT 포함 + 부분입금 차감
 *   - 현금(cash)         = cashflow 기반 (절대 미수금을 현금으로 쓰지 않는다)
 *   - estimatedVat       = salesVat - purchaseVat (환급 음수 보존)
 */

/** Invoice shape needed for outstanding calculation. */
export interface OutstandingInvoiceLike {
  total: number;
  depositAmount?: number | null;
  depositStatus?: string | null;
}

/** Deposit status meaning "fully settled" — excluded from 미수금. */
export const DEPOSIT_STATUS_COMPLETE = '완료';

/**
 * 미수 "건" 판정 SSOT (single predicate for the outstanding *count*).
 *
 * An invoice is 미수(outstanding) iff ALL of:
 *   1. total > 0                       — 0원 유령 인보이스(buyer 공백, amount 0) 제외
 *   2. (total - COALESCE(depositAmount, 0)) > 0  — 잔액이 남아있다
 *   3. depositStatus !== '완료'        — 완료분 제외
 *
 * This is the ONE predicate every surface must use so the 미수 건수가 일치한다.
 * Root cause of the 9 vs 8 vs 9 divergence was three surfaces each using a
 * different subset of these conditions (length-of-notdone / remaining>0 /
 * notIn['완료','취소']). A 0원·buyer 공백 유령 인보이스 slipped through the
 * length-only and status-only counts. Requiring total>0 excludes it uniformly.
 */
export function isOutstanding(inv: OutstandingInvoiceLike): boolean {
  const total = inv.total ?? 0;
  if (total <= 0) return false;
  if (inv.depositStatus === DEPOSIT_STATUS_COMPLETE) return false;
  return total - (inv.depositAmount ?? 0) > 0;
}

/**
 * 미수 건수 SSOT. isOutstanding를 만족하는 인보이스 수.
 */
export function outstandingCount(invoices: OutstandingInvoiceLike[]): number {
  return invoices.reduce((n, inv) => (isOutstanding(inv) ? n + 1 : n), 0);
}

/**
 * 미수금 SSOT (금액).
 *
 * Σ(total - COALESCE(depositAmount, 0)) over 미수(isOutstanding) invoices. Uses
 * `total` (VAT 포함) as the receivable basis and subtracts any partial deposit
 * so 부분입금 invoices are not over-counted. isOutstanding와 동일 술어를 써서
 * 금액 합계와 건수가 동일한 모집단에서 산출되게 한다.
 */
export function outstandingAmount(invoices: OutstandingInvoiceLike[]): number {
  let sum = 0;
  for (const inv of invoices) {
    if (!isOutstanding(inv)) continue;
    sum += (inv.total ?? 0) - (inv.depositAmount ?? 0);
  }
  return Math.round(sum);
}

/** Cashflow shape needed for cash-balance calculation. */
export interface CashflowLike {
  cashChange: number;
  balanceAfter?: number | null;
  date?: Date | string | null;
}

/**
 * 현재 현금잔액 SSOT.
 *
 * Derived from cashflows only — never from 미수금. Strategy:
 *   1. If any row carries a post-transaction balance (balanceAfter), use the
 *      most recent one (latest date, then last row) as the bank truth.
 *   2. Otherwise accumulate cashChange across all rows.
 *   3. If there are no cashflows at all, return null (미산출) — we report
 *      honestly rather than fabricate a number.
 */
export function cashBalanceFromCashflows(cashflows: CashflowLike[]): number | null {
  if (cashflows.length === 0) return null;

  const withBalance = cashflows.filter(
    (c) => c.balanceAfter != null && Number.isFinite(c.balanceAfter),
  );
  if (withBalance.length > 0) {
    const latest = withBalance.reduce((a, b) => (cashflowOrder(b) >= cashflowOrder(a) ? b : a));
    return Math.round(latest.balanceAfter as number);
  }

  return Math.round(cashflows.reduce((s, c) => s + (c.cashChange ?? 0), 0));
}

function cashflowOrder(c: CashflowLike): number {
  if (c.date == null) return 0;
  const t = c.date instanceof Date ? c.date.getTime() : new Date(c.date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * 런웨이(개월). cash / monthlyBurn. cash 미산출(null)이거나 burn이 양수가 아니면 null.
 */
export function cashRunwayMonths(cash: number | null, monthlyBurn: number): number | null {
  if (cash == null) return null;
  if (!(monthlyBurn > 0)) return null;
  return Math.round((cash / monthlyBurn) * 10) / 10;
}

/**
 * 예상 부가세(VAT). 매출세액 - 매입세액. 매입이 매출을 초과하면 음수(환급) 그대로 보존한다.
 * (이전 구현은 `Math.max(0, 0 - purchaseVat)`로 항상 0이었다.)
 */
export function estimatedVat(salesVat: number, purchaseVat: number): number {
  return Math.round((salesVat ?? 0) - (purchaseVat ?? 0));
}
