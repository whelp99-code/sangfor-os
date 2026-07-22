import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { ArtifactReleaseError, evaluateArtifactRelease, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { createApiErrorResponse, createApiResponse } from "../../../_lib/api-response";
import { ApiError, API_ERRORS } from "../../../_lib/api-error";

const ALLOWED_BODY_KEYS = new Set(["action", "artifactVersionId", "approvalId"]);
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function resolveCaller(request: Request): Promise<ApprovalKernelCaller | { error: ReturnType<typeof createApiErrorResponse> }> {
  const token = extractSessionToken(request);
  if (!token) return { error: createApiErrorResponse(API_ERRORS.UNAUTHORIZED()) };
  let config;
  try { config = getWebSessionJwtConfig(); } catch { return { error: createApiErrorResponse(API_ERRORS.UNAUTHORIZED()) }; }
  const claims = verifySessionJwt(token, config);
  if (!claims) return { error: createApiErrorResponse(API_ERRORS.UNAUTHORIZED()) };
  const session = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!session.ok) return { error: createApiErrorResponse(new ApiError(session.reason, "Authentication required", session.reason === "MFA_REQUIRED" || session.reason === "MFA_STALE" ? 403 : 401)) };
  return { userId: session.userId, sessionId: claims.jti, scope: { tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId }, mfaVerifiedAt: session.mfaVerifiedAt };
}

export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const resolved = await resolveCaller(request);
  if ("error" in resolved) return resolved.error;
  let body: unknown;
  try { body = await request.json(); } catch { return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body")); }
  if (!isPlainObject(body)) return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object"));
  for (const key of Object.keys(body)) {
    if (ALLOWED_BODY_KEYS.has(key)) continue;
    if (key === "tenantId" || key === "companyId" || key === "projectId") return createApiErrorResponse(new ApiError("FOREIGN_SCOPE", "scope is derived from the authenticated session", 403));
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR(`unknown field: ${key}`));
  }
  if (typeof body.action !== "string" || typeof body.artifactVersionId !== "string" || typeof body.approvalId !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("action, artifactVersionId, and approvalId are required"));
  const { artifactId } = await context.params;
  try {
    const result = await evaluateArtifactRelease({ action: body.action, artifactVersionId: body.artifactVersionId, approvalId: body.approvalId }, resolved);
    if (result.artifactId !== artifactId) return createApiErrorResponse(API_ERRORS.NOT_FOUND());
    return createApiResponse(result);
  } catch (error) {
    if (error instanceof ArtifactReleaseError) return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
    console.error("[api] artifact_release_evaluation_failed:", error instanceof Error ? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
