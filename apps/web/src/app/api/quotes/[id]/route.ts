import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import {
  QuoteServiceError,
  getQuoteDetail,
  resolveCrmAuthContext,
} from "@sangfor/business";

export async function GET(
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
    const quote = await getQuoteDetail(ctx, id);
    return Response.json({ quote }, { status: 200 });
  } catch (error) {
    if (error instanceof QuoteServiceError) {
      return apiError(error.code, error, { status: error.httpStatus });
    }
    return apiError("INTERNAL_ERROR", error, { status: 500 });
  }
}
