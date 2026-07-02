import { isAuthConfigured } from "@/lib/auth/config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Purpose:
 * - Global session gate for /api/*, run by Next.js as `proxy` (the renamed
 *   `middleware` convention as of Next 16 — see node_modules/next/dist/docs/
 *   01-app/03-api-reference/03-file-conventions/proxy.md). Do NOT add a
 *   sibling `middleware.ts`: this file is the one Next.js actually invokes.
 *
 * Policy:
 * - Opt-in like before: only verifies a session when JWT_SECRET is configured
 *   (`isAuthConfigured()`). This preserves the existing dev/demo posture where
 *   an unconfigured deployment runs open.
 * - NEW: an unconfigured deployment now logs a loud, once-per-instance
 *   warning, and in NODE_ENV=production it actively blocks mutating requests
 *   (POST/PUT/PATCH/DELETE) instead of silently letting them through — a
 *   misconfigured prod deploy fails closed for writes rather than failing
 *   open.
 * - Route-level defense in depth (assertApiAccess, see lib/api-auth.ts) stays
 *   in place independently; this proxy is the outer layer.
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
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyEdgeSessionToken(token: string | null | undefined, secret: string) {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return base64UrlEncode(signed) === sig;
}

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
      "[SECURITY] JWT_SECRET is not configured — /api/* session verification is DISABLED.",
      "Every request (including mutations, unless NODE_ENV=production) will pass",
      "through unauthenticated. This is only acceptable for local dev/demo.",
      "Set JWT_SECRET before any production or externally reachable deployment.",
      "!".repeat(72),
      "",
    ].join("\n"),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isAuthConfigured()) {
    warnAuthUnconfiguredOnce();
    // Defense in depth for a misconfigured production deploy: never let a
    // mutation through unauthenticated, even though reads still pass (matches
    // today's dev/demo posture for GET traffic when unconfigured).
    if (process.env.NODE_ENV === "production" && !isPublic && MUTATING_METHODS.has(request.method)) {
      console.error(
        `[SECURITY] blocking ${request.method} ${pathname} — JWT_SECRET is unset in production`,
      );
      return NextResponse.json(
        { error: "service_unavailable", message: "Authentication is not configured" },
        { status: 503 },
      );
    }
    return NextResponse.next();
  }

  if (!isPublic) {
    const secret = process.env.JWT_SECRET!.trim();
    const token =
      request.cookies.get("session")?.value ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!(await verifyEdgeSessionToken(token, secret))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
