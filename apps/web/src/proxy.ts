import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isAuthConfigured } from "@/lib/auth/config";
import {
  INTERNAL_CONTEXT_HEADER,
  evaluatePersistedSessionFromRequest,
  signInternalContext,
} from "@/lib/auth/persisted-session";

/**
 * Purpose:
 * - Global session gate for /api/*, run by Next.js as `proxy` (the renamed
 *   `middleware` convention as of Next 16 — see node_modules/next/dist/docs/
 *   01-app/03-api-reference/03-file-conventions/proxy.md). Do NOT add a
 *   sibling `middleware.ts`: this file is the one Next.js actually invokes.
 *
 * Policy:
 * - Opt-in like before: only verifies a session when the USER_JWT_* keyring
 *   is configured (`isAuthConfigured()`). This preserves the existing
 *   dev/demo posture where an unconfigured deployment runs open.
 * - NEW: an unconfigured deployment now logs a loud, once-per-instance
 *   warning, and in NODE_ENV=production it actively blocks mutating requests
 *   (POST/PUT/PATCH/DELETE) instead of silently letting them through — a
 *   misconfigured prod deploy fails closed for writes rather than failing
 *   open.
 * - Route-level defense in depth (assertApiAccess, see lib/api-auth.ts) stays
 *   in place independently; this proxy is the outer layer.
 * - U013: Next 16's Proxy defaults to the Node runtime (see the doc above).
 * - U014/SEC-01: a verified JWT alone is no longer sufficient. This calls
 *   `evaluatePersistedSessionFromRequest` (apps/web/src/lib/auth/persisted-session.ts),
 *   the same DB-backed verifier route handlers use when tested directly — it
 *   resolves the token's `jti` to an unexpired, unrevoked AuthSession for an
 *   explicitly `active` User. Any client-supplied internal-auth header is
 *   stripped before this check runs; only a passing evaluation causes this
 *   function to forward a freshly server-signed minimal context.
 */

// Paths reachable without a session:
// - health/diagnostic probes (infra checks, no login context)
// - the login endpoint itself
// - the Outlook OAuth callback (protected by its own state-cookie CSRF check
//   against WEBHOOK-style external redirects, not by app session)
const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/unified-health",
  "/api/integrations/health",
  "/api/aios-v3/health",
  "/api/aios-v3-status",
  "/api/auth/login",
  "/api/mail/oauth/callback",
  // The login page itself must be reachable without a session, or the redirect
  // below would loop.
  "/login",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Fires at most once per server instance so an unconfigured deployment can't
// flood logs on every request, while still making the misconfiguration
// impossible to miss in the very first request's output.
let warnedUnconfigured = false;

function warnAuthUnconfiguredOnce() {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  console.warn(
    [
      "",
      "!".repeat(72),
      "[SECURITY] The USER_JWT_* keyring is not configured — /api/* session verification is DISABLED.",
      "Every request (including mutations, unless NODE_ENV=production) will pass",
      "through unauthenticated. This is only acceptable for local dev/demo.",
      "Set USER_JWT_ACTIVE_KID/USER_JWT_KEYRING_JSON before any production or externally reachable deployment.",
      "!".repeat(72),
      "",
    ].join("\n"),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  // Strip first, unconditionally: this header is only ever set below, by this
  // function, after evaluatePersistedSessionFromRequest actually passes.
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete(INTERNAL_CONTEXT_HEADER);

  if (!isAuthConfigured()) {
    warnAuthUnconfiguredOnce();
    // Defense in depth for a misconfigured production deploy: never let a
    // mutation through unauthenticated, even though reads still pass (matches
    // today's dev/demo posture for GET traffic when unconfigured).
    if (process.env.NODE_ENV === "production" && !isPublic && MUTATING_METHODS.has(request.method)) {
      console.error(
        `[SECURITY] blocking ${request.method} ${pathname} — the USER_JWT_* keyring is unset in production`,
      );
      return NextResponse.json(
        { error: "service_unavailable", message: "Authentication is not configured" },
        { status: 503 },
      );
    }
    return NextResponse.next({ request: { headers: forwardHeaders } });
  }

  if (!isPublic) {
    const evaluation = await evaluatePersistedSessionFromRequest(request);
    if (!evaluation.ok) {
      if (pathname.startsWith("/api")) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
    forwardHeaders.set(INTERNAL_CONTEXT_HEADER, signInternalContext(evaluation));
  }
  return NextResponse.next({ request: { headers: forwardHeaders } });
}

export const config = {
  // Guard every route except Next internals and static assets (any path with a
  // file extension). Page routes must be gated too, not just /api — otherwise
  // unauthenticated visitors read business data straight off the server render.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
