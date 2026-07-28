import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { ArtifactServiceError, createArtifactVersion, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { createApiErrorResponse, createApiResponse } from "../../../_lib/api-response";
import { ApiError, API_ERRORS } from "../../../_lib/api-error";

const ALLOWED_BODY_KEYS = new Set(["expectedCurrentVersionId", "expectedCurrentRevision", "content", "contentType", "metadata"]);

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
  if (body.expectedCurrentVersionId !== null && typeof body.expectedCurrentVersionId !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("expectedCurrentVersionId is required"));
  if (typeof body.expectedCurrentRevision !== "number") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("expectedCurrentRevision is required"));
  if (typeof body.content !== "string" || typeof body.contentType !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("content and contentType are required"));
  if (body.metadata !== undefined && !isPlainObject(body.metadata)) return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("metadata must be an object"));
  const { artifactId } = await context.params;
  try {
    const result = await createArtifactVersion({ artifactId, expectedCurrentVersionId: body.expectedCurrentVersionId as string | null, expectedCurrentRevision: body.expectedCurrentRevision, content: body.content, contentType: body.contentType, metadata: body.metadata }, resolved);
    return createApiResponse(result, result.idempotent ? 200 : 201);
  } catch (error) {
    if (error instanceof ArtifactServiceError) return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
    console.error("[api] artifact_version_create_failed:", error instanceof Error ? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
