import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import {
  CommercialQuoteApprovalError,
  createCommercialApprovalForQuote,
  getCommercialApprovalStatus,
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
    const result = await createCommercialApprovalForQuote(ctx, id);
    return Response.json({ result }, { status: 201 });
  } catch (error) {
    if (error instanceof CommercialQuoteApprovalError) {
      return apiError(error.code, error, { status: error.httpStatus });
    }
    return apiError("INTERNAL_ERROR", error, { status: 500 });
  }
}

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
    const result = await getCommercialApprovalStatus(ctx, id);
    return Response.json({ result }, { status: 200 });
  } catch (error) {
    if (error instanceof CommercialQuoteApprovalError) {
      return apiError(error.code, error, { status: error.httpStatus });
    }
    return apiError("INTERNAL_ERROR", error, { status: 500 });
  }
}
