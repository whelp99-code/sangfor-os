import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { ApprovalKernelError, decideApproval, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { createApiResponse, createApiErrorResponse } from "../../../_lib/api-response";
import { ApiError, API_ERRORS } from "../../../_lib/api-error";

// U022/APR-01b — canonical decision endpoint. `PATCH /api/approvals` (apps/web/src/app/api/
// approvals/route.ts) is now a deprecated compatibility adapter over the SAME kernel call below.
//
// Canonical decision input is EXACTLY {decision, expectedRevision, reason?} — approvalId comes
// from the URL, never the body. Every other fact (actor, membership, company/tenant scope,
// BusinessRole, session, MFA evidence, status, quorum) is resolved server-side inside the kernel
// from a freshly re-verified, DB-backed session — never trusted from request JSON (U022 contract
// §2, §9). AUTH_BYPASS_ENABLED (assertApiAccess's dev/demo escape hatch) is deliberately
// insufficient here: a decision with no real, DB-verified actor would violate "no auto-approve"
// and "actor comes from server-authenticated state" regardless of that flag, so this handler
// independently re-verifies the session/JWT itself rather than trusting the coarse gate alone.
//
// This route is also in the U015/SEC-02a mechanical coverage set (route-capability-registry.ts
// classifies it `privileged`/`role.manage`, identically to its PATCH /api/approvals sibling) — it
// MUST call `assertBusinessCapability` itself, same as every other guarded route, so an
// account_manager-grade caller cannot approve/reject here even though they are correctly denied on
// the deprecated PATCH path.

const ALLOWED_DECISION_BODY_KEYS = new Set(["decision", "expectedRevision", "reason"]);
const SESSION_SCOPE_KEYS = new Set(["tenantId", "companyId", "projectId"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kernelErrorResponse(error: ApprovalKernelError) {
  return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
}

/**
 * Resolves the canonical server-authenticated caller context (U013/U014's DB-backed session
 * resolver): re-verifies the session JWT, then re-evaluates the persisted AuthSession/User rows
 * fresh (never trusting the token's own claims), requiring a fresh privileged-grade MFA
 * verification — approval decisions are always a privileged capability (`isPrivilegedCapability`
 * treats "approve" as a privileged marker; see @sangfor/auth/principal-policy.ts).
 */
async function resolveDecisionCaller(request: Request): Promise<ApprovalKernelCaller | { error: ReturnType<typeof createApiErrorResponse> }> {
  const token = extractSessionToken(request);
  if (!token) return { error: createApiErrorResponse(API_ERRORS.UNAUTHORIZED()) };

  let config;
  try {
    config = getWebSessionJwtConfig();
  } catch {
    return { error: createApiErrorResponse(API_ERRORS.UNAUTHORIZED()) };
  }

  const claims = verifySessionJwt(token, config);
  if (!claims) return { error: createApiErrorResponse(API_ERRORS.UNAUTHORIZED()) };

  const evaluation = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!evaluation.ok) {
    const status = evaluation.reason === "MFA_REQUIRED" || evaluation.reason === "MFA_STALE" ? 403 : 401;
    return { error: createApiErrorResponse(new ApiError(evaluation.reason, "Authentication required", status)) };
  }

  return {
    userId: evaluation.userId,
    sessionId: claims.jti,
    scope: { tenantId: evaluation.tenantId, companyId: evaluation.companyId, projectId: evaluation.projectId },
    mfaVerifiedAt: evaluation.mfaVerifiedAt,
  };
}

export async function POST(request: Request, context: { params: Promise<{ approvalId: string }> }) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/approvals/[approvalId]/decisions/route.ts");
  if (capabilityDenied) return capabilityDenied;

  const resolved = await resolveDecisionCaller(request);
  if ("error" in resolved) return resolved.error;
  const decisionCaller = resolved;

  const { approvalId } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body"));
  }
  if (!isPlainObject(raw)) {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object"));
  }

  for (const key of Object.keys(raw)) {
    if (ALLOWED_DECISION_BODY_KEYS.has(key)) continue;
    if (SESSION_SCOPE_KEYS.has(key)) {
      const expected =
        key === "tenantId" ? decisionCaller.scope.tenantId : key === "companyId" ? decisionCaller.scope.companyId : decisionCaller.scope.projectId;
      if (raw[key] !== expected) {
        return createApiErrorResponse(new ApiError("FOREIGN_SCOPE", "Company/tenant/project scope is derived from the session, not the request body", 403));
      }
      continue;
    }
    // Every other unknown key — including actorId/approvedBy/status/quorum/artifactHash/MFA —
    // is a stable 400/422, never silently ignored (contract §2, §9).
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR(`unknown field: ${key}`));
  }

  if (typeof raw.decision !== "string") {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("decision is required"));
  }
  if (typeof raw.expectedRevision !== "number") {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("expectedRevision is required"));
  }
  if (raw.reason !== undefined && typeof raw.reason !== "string") {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("reason must be a string"));
  }

  try {
    const result = await decideApproval(
      { approvalId, decision: raw.decision, expectedRevision: raw.expectedRevision, reason: raw.reason as string | undefined },
      decisionCaller,
    );
    return createApiResponse({
      outcome: result.outcome,
      approval: { id: result.request.id, status: result.request.status, revision: result.request.revision },
      decision: { id: result.decision.id, sequence: result.decision.sequence, decision: result.decision.decision },
      validity: { state: result.validity.state, satisfiedQuorum: result.validity.satisfiedQuorum, requiredQuorum: result.validity.requiredQuorum },
    });
  } catch (error) {
    if (error instanceof ApprovalKernelError) return kernelErrorResponse(error);
    console.error("[api] approval_decision_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
