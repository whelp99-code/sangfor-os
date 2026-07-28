import { PRIVILEGED_MFA_MAX_AGE_SECONDS, verifySessionJwt } from "@sangfor/auth";
import {
  ExternalActionReleaseError,
  externalActionCanonicalHash,
  issueExternalActionRelease,
  parseExternalActionReceiptConfig,
  type ApprovalKernelCaller,
} from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";
import { getWebSessionJwtConfig } from "@/lib/auth/config";
import { evaluatePersistedSessionFromClaims } from "@/lib/auth/persisted-session";
import { extractSessionToken } from "@/lib/auth/session";

const KEYS = new Set(["action", "target", "artifactVersionId", "approvalId", "idempotencyKey", "operation"]);
const MUTATION_ACTIONS = new Set(["sangfor.apply_approved_product_change", "sangfor.execute_console_action_live"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

async function caller(request: Request): Promise<ApprovalKernelCaller | null> {
  const token = extractSessionToken(request); if (!token) return null;
  let config; try { config = getWebSessionJwtConfig(); } catch { return null; }
  const claims = verifySessionJwt(token, config); if (!claims) return null;
  const session = await evaluatePersistedSessionFromClaims(claims, new Date(), PRIVILEGED_MFA_MAX_AGE_SECONDS);
  if (!session.ok) return null;
  return { userId: session.userId, sessionId: claims.jti, scope: { tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId }, mfaVerifiedAt: session.mfaVerifiedAt };
}

/** Root-only issuance. Actor, scope, body hash, and approval authority are never read from client JSON. */
export async function POST(request: Request) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const context = await caller(request); if (!context) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 }); }
  if (!record(body) || Object.keys(body).some(key => !KEYS.has(key))) return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 });
  for (const key of ["action", "target", "artifactVersionId", "approvalId", "idempotencyKey"] as const) if (typeof body[key] !== "string" || body[key].length === 0) return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 });
  if (!MUTATION_ACTIONS.has(body.action as string) || !record(body.operation) || body.operation.target !== body.target) return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 });
  try {
    const result = await issueExternalActionRelease({ action: body.action as string, target: body.target as string, artifactVersionId: body.artifactVersionId as string, approvalId: body.approvalId as string, idempotencyKey: body.idempotencyKey as string, bodyHash: externalActionCanonicalHash(body.operation) }, context, parseExternalActionReceiptConfig());
    return Response.json({ receipt: result.receipt, claims: result.claims }, { status: 201, headers: result.idempotentReplay ? { "Idempotent-Replay": "true" } : undefined });
  } catch (error) {
    if (error instanceof ExternalActionReleaseError) return Response.json({ error: error.code }, { status: error.httpStatus });
    console.error("[api] external_action_release_failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "EXTERNAL_ACTION_RELEASE_UNAVAILABLE" }, { status: 503 });
  }
}
