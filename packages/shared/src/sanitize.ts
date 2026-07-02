/**
 * Strip characters that are invalid in JSON / Postgres jsonb — C0 control chars
 * and unpaired UTF-16 surrogates. The latter arise when real email text (emoji,
 * astral-plane CJK) is truncated with `.slice(n)`, splitting a surrogate pair.
 *
 * @param value  The value to sanitize (strings, nested objects, arrays).
 * @param maxDepth  Recursion guard — stops descending past this depth (default 10).
 */
export function sanitizeJsonStrings(value: unknown, maxDepth: number = 10): unknown {
  if (maxDepth < 0) return value;
  if (typeof value === "string") {
    return value
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeJsonStrings(v, maxDepth - 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeJsonStrings(v, maxDepth - 1)]),
    );
  }
  return value;
}
