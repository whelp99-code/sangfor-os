import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import type { ApprovalKernelCaller } from "@sangfor/business";

import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { ApiError, API_ERRORS } from "@/app/api/_lib/api-error";
import { createApiErrorResponse } from "@/app/api/_lib/api-response";

/**
 * Resolves the server-derived {@link ApprovalKernelCaller} for governance-bearing routes
 * (workflow runs/definitions, artifact versions, release evaluations).
 *
 * Fail-closed by construction: a missing token, unavailable JWT configuration, unverifiable
 * JWT, or a rejected persisted session all return a `Response` — never a partially trusted
 * caller. The scope is derived from the persisted session, never from the request body, so
 * callers cannot forge `tenantId`/`companyId`/`projectId` (repo Quick Rule 2).
 *
 * Returns the caller on success, or the error `Response` to return as-is. Narrow with
 * `instanceof Response`.
 */
export async function resolveApprovalKernelCaller(
  request: Request,
): Promise<ApprovalKernelCaller | Response> {
  const token = extractSessionToken(request);
  if (!token) return createApiErrorResponse(API_ERRORS.UNAUTHORIZED());

  let config;
  try {
    config = getWebSessionJwtConfig();
  } catch {
    return createApiErrorResponse(API_ERRORS.UNAUTHORIZED());
  }

  const claims = verifySessionJwt(token, config);
  if (!claims) return createApiErrorResponse(API_ERRORS.UNAUTHORIZED());

  const session = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!session.ok) {
    const mfaFailure = session.reason === "MFA_REQUIRED" || session.reason === "MFA_STALE";
    return createApiErrorResponse(
      new ApiError(session.reason, "Authentication required", mfaFailure ? 403 : 401),
    );
  }

  return {
    userId: session.userId,
    sessionId: claims.jti,
    scope: { tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId },
    mfaVerifiedAt: session.mfaVerifiedAt,
  };
}
