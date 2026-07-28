import { listEngagements, resolveOpportunityAuthContext } from "@sangfor/business";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export async function GET(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const session = await evaluatePersistedSessionFromRequest(request);
  if (!session.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const ctx = await resolveOpportunityAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });
    const engagements = await listEngagements(ctx);
    return NextResponse.json({ engagements: serializeDecimalAtBoundary(engagements) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}
