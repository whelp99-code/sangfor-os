// Shared date formatters. Consolidates the duplicated `formatDate` helpers that
// lived inline across deal detail / work-panel / mail-candidate surfaces.

/**
 * Format a date value as an ISO date (`YYYY-MM-DD`).
 *
 * Accepts a `Date`, an ISO/parsable string, or a nullish value. When the value
 * is missing or unparsable, `fallback` is returned (default `""`) so callers can
 * pick their own placeholder (e.g. `"—"`, `"미정"`).
 */
export function formatDate(
  value: Date | string | null | undefined,
  fallback = "",
): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString().slice(0, 10);
}

/**
 * Format a date value for an `<input type="date">` (`YYYY-MM-DD`).
 *
 * Behaves like {@link formatDate} but always falls back to an empty string,
 * which is the value an empty date input expects.
 */
export function formatDateInput(value: Date | string | null | undefined): string {
  return formatDate(value, "");
}
