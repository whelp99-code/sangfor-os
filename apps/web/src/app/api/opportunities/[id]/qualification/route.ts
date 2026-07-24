import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import {
  CrmServiceError,
  qualifyOpportunity,
  resolveCrmAuthContext,
} from "@sangfor/business";

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const accessError = assertApiAccess(req);
  if (accessError) return accessError;

  const session = await evaluatePersistedSessionFromRequest(req);
  if (!session.ok) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const ctx = await resolveCrmAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const { id } = await props.params;

  try {
    const body = await req.json();
    const idempotencyKey =
      req.headers.get("idempotency-key") ??
      body.idempotencyKey ??
      `qual-${Date.now()}`;

    // Forbidden scope / forged field check
    if (
      body.tenantId ||
      body.companyId ||
      body.projectId ||
      body.scoreTotal !== undefined ||
      body.passed !== undefined ||
      body.scoringVersion !== undefined
    ) {
      return Response.json(
        { error: "FORBIDDEN_SCOPE_OR_FORGED_FIELD" },
        { status: 403 },
      );
    }

    const qualification = await qualifyOpportunity(ctx, id, {
      ...body,
      idempotencyKey,
    });

    return Response.json({ qualification }, { status: 200 });
  } catch (error) {
    if (error instanceof CrmServiceError) {
      return apiError(error.code, error, { status: error.httpStatus });
    }
    return apiError("INTERNAL_ERROR", error, { status: 500 });
  }
}
