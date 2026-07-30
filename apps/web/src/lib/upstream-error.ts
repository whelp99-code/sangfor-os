const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]);

/** True when a thrown value is a connection failure rather than a real fault. `fetch` buries the
 * code under `cause` and again inside `AggregateError.errors`, so the whole chain is walked. The
 * `seen` set keeps a cyclic `cause` from looping. */
export function isUpstreamUnreachable(error: unknown, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
  if (Array.isArray(errors) && errors.some((nested) => isUpstreamUnreachable(nested, seen))) return true;
  return isUpstreamUnreachable(cause, seen);
}
