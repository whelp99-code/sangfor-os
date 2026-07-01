// Shared KRW formatters. Consolidates the duplicated inline `won` / `wonE` /
// `wonC` helpers (CFO tables, project P&L) and the Korean 억/만 compaction used
// by the deal work-panels.
//
// Note: this intentionally mirrors the pre-existing inline behavior
// (`toLocaleString()` with the runtime default locale, no rounding) rather than
// `lib/cfo-theme.ts`'s `krw` (which rounds + forces the ko-KR locale) or
// `lib/cfo-client.ts`'s `formatKrw` (which appends a `원` suffix). Those two
// remain the canonical helpers for their own call sites; `won` is the exact
// drop-in for the `₩`-prefixed table/P&L formatters.

/**
 * Format a numeric value as `₩1,234`.
 *
 * Nullish values are treated as `0`. Grouping follows the runtime default
 * locale (matching the inline helpers this replaces).
 */
export function won(value: number | null | undefined): string {
  return `₩${(value ?? 0).toLocaleString()}`;
}

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
