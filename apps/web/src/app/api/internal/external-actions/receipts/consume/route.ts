import { INTERNAL_PRINCIPAL_HEADER, verifyInternalPrincipal } from "@sangfor/auth";
import {
  consumeExternalActionRelease,
  ExternalActionReleaseError,
  parseExternalActionReceiptConfig,
  verifyExternalActionReceipt,
} from "@sangfor/business";
import { getInternalPrincipalConfig } from "@sangfor/config";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** This endpoint intentionally has no user/session/API-key/bearer fallback: only U026 ENGINEER envelopes may consume. */
export async function POST(request: Request) {
  const raw = await request.text(); let body: unknown; try { body = JSON.parse(raw); } catch { return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 }); }
  if (!record(body) || Object.keys(body).length !== 1 || typeof body.receipt !== "string") return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 });
  const envelope = request.headers.get(INTERNAL_PRINCIPAL_HEADER); if (!envelope) return Response.json({ error: "INVALID_INTERNAL_PRINCIPAL" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const principal = verifyInternalPrincipal(envelope, { profile: "ENGINEER", method: "POST", path: url.pathname, query: url.search, body: raw }, getInternalPrincipalConfig());
    const receipt = verifyExternalActionReceipt(body.receipt, parseExternalActionReceiptConfig());
    if (principal.tenantId !== receipt.tenantId || principal.companyId !== receipt.companyId || principal.projectId !== receipt.projectId) return Response.json({ error: "EXTERNAL_ACTION_RELEASE_DENIED" }, { status: 403 });
    const result = await consumeExternalActionRelease(body.receipt, { userId: receipt.actorUserId, sessionId: principal.jti, scope: { tenantId: principal.tenantId, companyId: principal.companyId, projectId: principal.projectId }, mfaVerifiedAt: null }, parseExternalActionReceiptConfig());
    return Response.json({ claims: result.claims });
  } catch (error) {
    if (error instanceof ExternalActionReleaseError) return Response.json({ error: error.code }, { status: error.httpStatus });
    return Response.json({ error: "INVALID_INTERNAL_PRINCIPAL" }, { status: 401 });
  }
}
