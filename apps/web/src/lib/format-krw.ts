// Shared KRW formatters. The `won` helper was formerly defined here but has
// been superseded by `@sangfor/shared`'s `formatKRW` (rounded + ko-KR grouped +
// `원` suffix). Only `formatKRWShort` (억/만 compaction for the deal work-panels)
// remains — it has a distinct signature (amount, eokDigits) and should not be
// merged with the canonical formatters.


/**
 * Compact Korean amount formatter (억 / 만).
 *
 * - `>= 1e8` → `1.2억` (`eokDigits` decimal places, default 1)
 * - `>= 1e4` → `1,234만` (rounded to 만 units, ko-KR grouping)
 * - otherwise → `1,234` (ko-KR grouping)
 *
 * Shared by the bid/win work-panels' `formatAmount` helpers. `eokDigits`
 * preserves the per-call-site precision (bid → 1, win → 2).
 */
export function formatKRWShort(amount: number, eokDigits = 1): string {
  if (amount >= 100_000_000)
    return `${(amount / 100_000_000).toFixed(eokDigits)}억`;
  if (amount >= 10_000)
    return `${Math.round(amount / 10_000).toLocaleString("ko-KR")}만`;
  return amount.toLocaleString("ko-KR");
}
