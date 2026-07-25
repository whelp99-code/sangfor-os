import { getBusinessRoleDashboard, resolveCrmAuthContext } from "@sangfor/business";
import type { BusinessRole } from "@sangfor/auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ role: string }> },
) {
  const { role } = await params;
  try {
    const session = await evaluatePersistedSessionFromRequest(request);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const data = await getBusinessRoleDashboard({ authContext, requestedRole: role as BusinessRole });
    return NextResponse.json(data);
  } catch (error) {
    return apiError(`${role}_dashboard_failed`, error, { status: 500 });
  }
}
