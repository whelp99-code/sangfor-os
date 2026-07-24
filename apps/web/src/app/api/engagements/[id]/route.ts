import { getEngagementDetail, resolveOpportunityAuthContext } from "@sangfor/business";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const session = await evaluatePersistedSessionFromRequest(request);
  if (!session.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const ctx = await resolveOpportunityAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });
    const engagement = await getEngagementDetail(ctx, id);
    if (!engagement) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ engagement: serializeDecimalAtBoundary(engagement) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}
