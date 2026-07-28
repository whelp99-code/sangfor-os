import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { WorkflowRuntimeError, activateWorkflowDefinition, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { ApiError, API_ERRORS } from "../../../_lib/api-error";
import { createApiErrorResponse, createApiResponse } from "../../../_lib/api-response";

export const dynamic = "force-dynamic";
const ALLOWED_KEYS = new Set(["expectedRevision", "approvalId"]);
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isResponse(value: ApprovalKernelCaller | Response): value is Response { return value instanceof Response; }
async function resolveCaller(request: Request): Promise<ApprovalKernelCaller | Response> {
  const token = extractSessionToken(request); if (!token) return createApiErrorResponse(API_ERRORS.UNAUTHORIZED());
  let config; try { config = getWebSessionJwtConfig(); } catch { return createApiErrorResponse(API_ERRORS.UNAUTHORIZED()); }
  const claims = verifySessionJwt(token, config); if (!claims) return createApiErrorResponse(API_ERRORS.UNAUTHORIZED());
  const session = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!session.ok) return createApiErrorResponse(new ApiError(session.reason, "Authentication required", session.reason === "MFA_REQUIRED" || session.reason === "MFA_STALE" ? 403 : 401));
  return { userId: session.userId, sessionId: claims.jti, scope: { tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId }, mfaVerifiedAt: session.mfaVerifiedAt };
}
function rejectUnknown(body: Record<string, unknown>): Response | null {
  for (const key of Object.keys(body)) {
    if (ALLOWED_KEYS.has(key)) continue;
    if (key === "tenantId" || key === "companyId" || key === "projectId") return createApiErrorResponse(new ApiError("FOREIGN_SCOPE", "scope is derived from the authenticated session", 403));
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR(`unknown field: ${key}`));
  }
  return null;
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const caller = await resolveCaller(request); if (isResponse(caller)) return caller;
  let body: unknown; try { body = await request.json(); } catch { return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body")); }
  if (!isRecord(body)) return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object"));
  const unknown = rejectUnknown(body); if (unknown) return unknown;
  const expectedRevision = body.expectedRevision;
  if (!Number.isInteger(expectedRevision) || typeof body.approvalId !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("expectedRevision and approvalId are required"));
  const { id } = await context.params;
  try { return createApiResponse({ definition: await activateWorkflowDefinition({ workflowDefinitionId: id, expectedRevision: expectedRevision as number, approvalId: body.approvalId }, caller) }); }
  catch (error) {
    if (error instanceof WorkflowRuntimeError) return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
    console.error("[api] workflow_definition_activate_failed:", error instanceof Error ? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
