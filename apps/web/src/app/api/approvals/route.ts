import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import { ApprovalKernelError, decideApproval, submitApprovalRequest, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { ApiError, API_ERRORS } from "../_lib/api-error";

// U022/APR-01b:
// - POST is the canonical creation contract — {action, artifactVersionId, artifactHash,
//   policyVersion, validationSnapshotHash?, requiredQuorum}, scope from the server-authenticated
//   caller. Callers never supply status or a readiness flag (contract §1).
// - PATCH is now an explicitly DEPRECATED compatibility adapter over the SAME canonical decision
//   kernel `POST /api/approvals/[approvalId]/decisions` uses. It still requires decision,
//   expectedRevision, and the canonical (server-resolved) AuthContext — it may not retain a body
//   actor or a one-click blind approval (contract §7), and it emits a `Deprecation` header.
//
// Both handlers independently re-verify the session/JWT rather than relying on
// AUTH_BYPASS_ENABLED/assertApiAccess's dev/demo bypass alone: a decision or a canonical creation
// with no real, DB-verified actor would violate "no auto-approve" / "actor comes from
// server-authenticated state" regardless of that flag.

const ALLOWED_CREATE_BODY_KEYS = new Set(["action", "artifactVersionId", "artifactHash", "policyVersion", "validationSnapshotHash", "requiredQuorum"]);
const ALLOWED_PATCH_BODY_KEYS = new Set(["approvalId", "decision", "expectedRevision", "reason"]);
const SESSION_SCOPE_KEYS = new Set(["tenantId", "companyId", "projectId"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kernelErrorResponse(error: ApprovalKernelError) {
  return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
}

/** Same canonical DB-backed AuthContext resolver as `[approvalId]/decisions/route.ts` — every
 * approval mutation on this router (create or decide) re-verifies the session/JWT fresh and
 * requires privileged-grade MFA freshness, since both creating and deciding an approval are
 * privileged capabilities. */
async function resolveApprovalCaller(request: Request): Promise<ApprovalKernelCaller | { error: ReturnType<typeof createApiErrorResponse> }> {
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

/** Validates that `body` carries only `allowedKeys` plus, for any of the three scope fields,
 * requires it to match the caller's own server-resolved scope (an explicit mismatching scope
 * selector is a 403; any other unknown key is a stable 400/422 — contract §8, §9). Returns an
 * error response, or null when the body is clean. */
function rejectUnknownOrForeignKeys(
  body: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  scope: ApprovalKernelCaller["scope"],
): ReturnType<typeof createApiErrorResponse> | null {
  for (const key of Object.keys(body)) {
    if (allowedKeys.has(key)) continue;
    if (SESSION_SCOPE_KEYS.has(key)) {
      const expected = key === "tenantId" ? scope.tenantId : key === "companyId" ? scope.companyId : scope.projectId;
      if (body[key] !== expected) {
        return createApiErrorResponse(new ApiError("FOREIGN_SCOPE", "Company/tenant/project scope is derived from the session, not the request body", 403));
      }
      continue;
    }
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR(`unknown field: ${key}`));
  }
  return null;
}

type ParsedBody =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: ReturnType<typeof createApiErrorResponse> };

// A plain `Record<string, unknown> | { error }` union does not narrow correctly via `"error" in
// parsed`: TypeScript cannot rule out the Record branch (its index signature structurally admits
// an "error" key too), so `parsed.error` widens to `unknown`. The explicit `ok` boolean
// discriminant below avoids that ambiguity entirely.
async function parseJsonObject(request: Request): Promise<ParsedBody> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, error: createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body")) };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, error: createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object")) };
  }
  return { ok: true, value: raw };
}

/** POST /api/approvals — canonical creation contract (§1). */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/approvals/route.ts");
  if (capabilityDenied) return capabilityDenied;

  const resolved = await resolveApprovalCaller(request);
  if ("error" in resolved) return resolved.error;
  const approvalCaller = resolved;

  const parsed = await parseJsonObject(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.value;

  const scopeError = rejectUnknownOrForeignKeys(body, ALLOWED_CREATE_BODY_KEYS, approvalCaller.scope);
  if (scopeError) return scopeError;

  if (typeof body.action !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("action is required"));
  if (typeof body.artifactVersionId !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("artifactVersionId is required"));
  if (typeof body.artifactHash !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("artifactHash is required"));
  if (typeof body.policyVersion !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("policyVersion is required"));
  if (typeof body.requiredQuorum !== "number") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("requiredQuorum is required"));
  if (body.validationSnapshotHash !== undefined && typeof body.validationSnapshotHash !== "string") {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("validationSnapshotHash must be a string"));
  }

  try {
    const { request: created, validity } = await submitApprovalRequest(
      {
        action: body.action,
        artifactVersionId: body.artifactVersionId,
        artifactHash: body.artifactHash,
        policyVersion: body.policyVersion,
        validationSnapshotHash: body.validationSnapshotHash as string | undefined,
        requiredQuorum: body.requiredQuorum,
      },
      approvalCaller,
    );
    return createApiResponse(
      {
        approval: { id: created.id, status: created.status, revision: created.revision },
        validity: { state: validity.state, requiredQuorum: validity.requiredQuorum, satisfiedQuorum: validity.satisfiedQuorum },
      },
      201,
    );
  } catch (error) {
    if (error instanceof ApprovalKernelError) return kernelErrorResponse(error);
    console.error("[api] approval_create_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}

/**
 * @deprecated compatibility adapter — canonical callers use `POST /api/approvals/[approvalId]/
 * decisions`. Still requires `decision`/`expectedRevision`/canonical AuthContext; may not retain a
 * body actor or one-click blind approval (contract §7).
 */
export async function PATCH(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/approvals/route.ts");
  if (capabilityDenied) return capabilityDenied;

  const resolved = await resolveApprovalCaller(request);
  if ("error" in resolved) return withDeprecationHeader(resolved.error);
  const approvalCaller = resolved;

  const parsed = await parseJsonObject(request);
  if (!parsed.ok) return withDeprecationHeader(parsed.error);
  const body = parsed.value;

  const scopeError = rejectUnknownOrForeignKeys(body, ALLOWED_PATCH_BODY_KEYS, approvalCaller.scope);
  if (scopeError) return withDeprecationHeader(scopeError);

  if (typeof body.approvalId !== "string") return withDeprecationHeader(createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("approvalId is required")));
  if (typeof body.decision !== "string") return withDeprecationHeader(createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("decision is required")));
  if (typeof body.expectedRevision !== "number") {
    return withDeprecationHeader(createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("expectedRevision is required")));
  }
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return withDeprecationHeader(createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("reason must be a string")));
  }

  try {
    const result = await decideApproval(
      { approvalId: body.approvalId, decision: body.decision, expectedRevision: body.expectedRevision, reason: body.reason as string | undefined },
      approvalCaller,
    );
    return withDeprecationHeader(
      createApiResponse({
        outcome: result.outcome,
        approval: { id: result.request.id, status: result.request.status, revision: result.request.revision },
      }),
    );
  } catch (error) {
    if (error instanceof ApprovalKernelError) return withDeprecationHeader(kernelErrorResponse(error));
    console.error("[api] approve_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return withDeprecationHeader(createApiErrorResponse(API_ERRORS.INTERNAL_ERROR()));
  }
}

function withDeprecationHeader<T extends { headers: Headers }>(response: T): T {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/approvals/{approvalId}/decisions>; rel="successor-version"');
  return response;
}
