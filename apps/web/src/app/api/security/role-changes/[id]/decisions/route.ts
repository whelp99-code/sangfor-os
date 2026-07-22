import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { RoleChangeError, decideRoleChange, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { createApiErrorResponse, createApiResponse } from "../../../../_lib/api-response";
import { ApiError } from "../../../../_lib/api-error";

const ALLOWED_KEYS = new Set(["approvalId", "decision", "expectedRevision", "reason"]);
function error(code: string, status: number) { return createApiErrorResponse(new ApiError(code, code, status)); }
function isResponse(value: ApprovalKernelCaller | Response): value is Response { return value instanceof Response; }
async function caller(request: Request): Promise<ApprovalKernelCaller | Response> {
  const token = extractSessionToken(request); if (!token) return error("AUTH_REQUIRED", 401);
  let config; try { config = getWebSessionJwtConfig(); } catch { return error("AUTH_REQUIRED", 401); }
  const claims = verifySessionJwt(token, config); if (!claims) return error("AUTH_REQUIRED", 401);
  const evaluation = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!evaluation.ok) return error(evaluation.reason === "MFA_REQUIRED" || evaluation.reason === "MFA_STALE" ? "ROLE_CHANGE_FORBIDDEN" : "AUTH_REQUIRED", evaluation.reason === "MFA_REQUIRED" || evaluation.reason === "MFA_STALE" ? 403 : 401);
  return { userId: evaluation.userId, sessionId: claims.jti, scope: { tenantId: evaluation.tenantId, companyId: evaluation.companyId, projectId: evaluation.projectId }, mfaVerifiedAt: evaluation.mfaVerifiedAt };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const actor = await caller(request); if (isResponse(actor)) return actor;
  let body: unknown; try { body = await request.json(); } catch { return error("ROLE_CHANGE_INVALID_REQUEST", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body as Record<string, unknown>).some((key) => !ALLOWED_KEYS.has(key))) return error("ROLE_CHANGE_INVALID_REQUEST", 400);
  const value = body as Record<string, unknown>;
  const expectedRevision = value.expectedRevision;
  if (typeof value.approvalId !== "string" || (value.decision !== "approve" && value.decision !== "reject") || typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || (value.reason !== undefined && typeof value.reason !== "string")) return error("ROLE_CHANGE_POLICY_INVALID", 422);
  const { id } = await context.params;
  try {
    const result = await decideRoleChange({ roleChangeRequestId: id, approvalId: value.approvalId, decision: value.decision, expectedRevision, reason: value.reason as string | undefined }, actor);
    return createApiResponse({ outcome: result.outcome, roleChange: { id: result.request.id, status: result.request.status, revision: result.request.revision }, approval: { id: result.approval.id, status: result.approval.status, revision: result.approval.revision } });
  } catch (cause) {
    if (cause instanceof RoleChangeError) return error(cause.code, cause.httpStatus);
    console.error("[api] role_change_decision_failed", cause instanceof Error ? cause.message : cause);
    return error("ROLE_CHANGE_INVALID_REQUEST", 400);
  }
}
