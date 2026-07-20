import { NextResponse } from "next/server";

import { getVerifiedSessionFromRequest } from "@/lib/auth/session";
import { isLocalTestRuntime } from "@/lib/auth/runtime-profile";

const CALLER_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "approvedBy",
  "actorId",
  "requestedBy",
  "requester",
  "approver",
  "approverId",
  "approverPersonaId",
  "personaId",
]);

export type WebOperatorContext = {
  readonly principalId: string;
  readonly businessRole: "system_admin";
};

/**
 * Purpose:
 * - Shared API-access guard for Next.js route handlers (secure by default).
 *
 * Policy:
 * - A request with a valid session (cookie or Bearer token, verified against
 *   the USER_JWT_* keyring — see @sangfor/config's user-jwt boundary) may
 *   proceed — without this, a logged-in user is still 401'd by every guarded
 *   route even though the outer proxy admitted them.
 * - Otherwise mutating routes are blocked unless authentication bypass is
 *   *explicitly* enabled for dev/demo via `AUTH_BYPASS_ENABLED=1`. This
 *   mirrors the API server's `apiKeyMiddleware` / `authMiddleware` flag
 *   (apps/api).
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
  return source.AUTH_BYPASS_ENABLED?.trim() === "1" && isLocalTestRuntime(source);
}

/**
 * Guards a mutating API route. Returns a 401 `NextResponse` when access is
 * denied, or `null` when the request may proceed.
 *
 * Returning the response (instead of throwing) lets callers early-return at the
 * top of the handler without try/catch coupling.
 */
export function assertApiAccess(request: Request): NextResponse | null {
  if (isAuthBypassEnabled()) {
    return null;
  }
  const session = getVerifiedSessionFromRequest(request);
  if (session) {
    if (
      session.role === "viewer" &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return null;
  }
  return unauthorizedResponse();
}

export function authorizeOperatorRequest(
  request: Request,
): WebOperatorContext | NextResponse {
  const session = getVerifiedSessionFromRequest(request);
  if (!session) return unauthorizedResponse();
  if (session.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { principalId: session.id, businessRole: "system_admin" };
}

export function findCallerIdentityConflicts(
  input: unknown,
  principalId: string,
): string[] {
  return findCallerIdentityConflictsInValue(input, principalId);
}

export function stripCallerIdentityFields(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown>;
export function stripCallerIdentityFields(input: unknown): unknown;
export function stripCallerIdentityFields(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stripCallerIdentityFields);
  if (!isUnknownRecord(input)) return input;
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !CALLER_IDENTITY_FIELDS.has(key))
      .map(([key, value]) => [key, stripCallerIdentityFields(value)]),
  );
}

function findCallerIdentityConflictsInValue(
  input: unknown,
  principalId: string,
  path = "",
): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((entry, index) =>
      findCallerIdentityConflictsInValue(entry, principalId, `${path}[${index}]`),
    );
  }
  if (!isUnknownRecord(input)) return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const fieldPath = path ? `${path}.${key}` : key;
    const ownConflict =
      CALLER_IDENTITY_FIELDS.has(key) && value !== principalId ? [fieldPath] : [];
    return [
      ...ownConflict,
      ...findCallerIdentityConflictsInValue(value, principalId, fieldPath),
    ];
  });
}

function isUnknownRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object";
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "unauthorized", message: "Authentication required" },
    { status: 401 },
  );
}

/**
 * Builds a sanitized error response for a mutating route.
 *
 * Why: raw `error.message` often carries internal detail (stack hints, DB
 * driver text, file paths, upstream API payloads). Surfacing it to clients is
 * an information-leak. This logs the real error server-side and returns a
 * stable, generic `error` code plus a fixed user-facing `message`.
 *
 * Usage:
 *   } catch (error) {
 *     return apiError("create_failed", error, { status: 400 });
 *   }
 */
export function apiError(
  code: string,
  error: unknown,
  options: { status?: number; message?: string; extra?: Record<string, unknown> } = {},
): NextResponse {
  const { status = 500, message = "Request could not be completed", extra } = options;
  // Server-side observability: keep the real cause out of the HTTP response.
  console.error(`[api] ${code}:`, error instanceof Error ? error.stack ?? error.message : error);
  return NextResponse.json({ error: code, message, ...extra }, { status });
}

/**
 * Minimal in-memory fixed-window rate limiter keyed by an arbitrary identifier
 * (typically client IP). Best-effort only: state is per-instance and resets on
 * restart, which is sufficient to blunt credential-stuffing against a single
 * dev/demo node. For multi-instance prod, back this with a shared store.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  options: { limit?: number; windowMs?: number } = {},
): { allowed: boolean; retryAfterSec: number } {
  const { limit = 10, windowMs = 60_000 } = options;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Best-effort client IP from standard proxy headers. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const [firstForwardedIp] = fwd.split(",");
    return firstForwardedIp?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
