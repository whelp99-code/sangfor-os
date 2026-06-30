import { NextResponse } from "next/server";

/**
 * Purpose:
 * - Shared API-access guard for Next.js route handlers (secure by default).
 *
 * Policy:
 * - Mutating routes are blocked unless authentication bypass is *explicitly*
 *   enabled for dev/demo via `AUTH_BYPASS_ENABLED=1`. This mirrors the API
 *   server's `apiKeyMiddleware` / `authMiddleware` flag (apps/api).
 * - An empty or whitespace flag value is treated as "off", not "present".
 *
 * Usage:
 *   const denied = assertApiAccess(request);
 *   if (denied) return denied; // 401 JSON, short-circuits the handler
 *
 * Tests:
 * - src/lib/api-auth.test.ts
 */

/** True only when dev/demo bypass is explicitly opted in. */
export function isAuthBypassEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source.AUTH_BYPASS_ENABLED?.trim() === "1";
}

/**
 * Guards a mutating API route. Returns a 401 `NextResponse` when access is
 * denied, or `null` when the request may proceed.
 *
 * Returning the response (instead of throwing) lets callers early-return at the
 * top of the handler without try/catch coupling.
 */
export function assertApiAccess(_request: Request): NextResponse | null {
  if (isAuthBypassEnabled()) {
    return null;
  }
  return NextResponse.json(
    { error: "unauthorized", message: "Authentication required" },
    { status: 401 },
  );
}
