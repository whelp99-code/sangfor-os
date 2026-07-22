import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { RoleChangeError, createRoleChangeRequest, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { createApiErrorResponse, createApiResponse } from "../../_lib/api-response";
import { ApiError } from "../../_lib/api-error";

const ALLOWED_KEYS = new Set(["targetMembershipId", "toRole", "reason", "expectedMembershipRevision"]);

function error(code: string, status: number) {
  return createApiErrorResponse(new ApiError(code, code, status));
}

async function caller(request: Request): Promise<ApprovalKernelCaller | Response> {
  const token = extractSessionToken(request);
  if (!token) return error("AUTH_REQUIRED", 401);
  let config;
  try { config = getWebSessionJwtConfig(); } catch { return error("AUTH_REQUIRED", 401); }
  const claims = verifySessionJwt(token, config);
  if (!claims) return error("AUTH_REQUIRED", 401);
  const evaluation = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!evaluation.ok) return error(evaluation.reason === "MFA_REQUIRED" || evaluation.reason === "MFA_STALE" ? "ROLE_CHANGE_FORBIDDEN" : "AUTH_REQUIRED", evaluation.reason === "MFA_REQUIRED" || evaluation.reason === "MFA_STALE" ? 403 : 401);
  return { userId: evaluation.userId, sessionId: claims.jti, scope: { tenantId: evaluation.tenantId, companyId: evaluation.companyId, projectId: evaluation.projectId }, mfaVerifiedAt: evaluation.mfaVerifiedAt };
}

function isResponse(value: ApprovalKernelCaller | Response): value is Response {
  return value instanceof Response;
}

/** POST /api/security/role-changes: body is deliberately narrow; every authority fact is server state. */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const actor = await caller(request);
  if (isResponse(actor)) return actor;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return error("ROLE_CHANGE_INVALID_REQUEST", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return error("ROLE_CHANGE_INVALID_REQUEST", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body as Record<string, unknown>).some((key) => !ALLOWED_KEYS.has(key))) return error("ROLE_CHANGE_INVALID_REQUEST", 400);
  try {
    const result = await createRoleChangeRequest({ ...(body as { targetMembershipId: string; toRole: string; reason: string; expectedMembershipRevision: number }), idempotencyKey }, actor);
    const response = createApiResponse({ roleChange: { id: result.request.id, status: result.request.status, revision: result.request.revision, approvalRequestId: result.request.approvalRequestId } }, result.idempotent ? 200 : 201);
    if (result.idempotent) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (cause) {
    if (cause instanceof RoleChangeError) return error(cause.code, cause.httpStatus);
    console.error("[api] role_change_create_failed", cause instanceof Error ? cause.message : cause);
    return error("ROLE_CHANGE_INVALID_REQUEST", 400);
  }
}
