import {
  BusinessRoleDashboardError,
  getBusinessRoleDashboard,
  resolveBusinessRoleDashboardAuthContext,
} from "@sangfor/business";
import { isBusinessRoleCode } from "@sangfor/auth";
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
    if (!isBusinessRoleCode(role)) {
      return NextResponse.json({ error: "INVALID_BUSINESS_ROLE" }, { status: 400 });
    }

    const authContext = await resolveBusinessRoleDashboardAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const data = await getBusinessRoleDashboard({ authContext, requestedRole: role });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BusinessRoleDashboardError) {
      return NextResponse.json({ error: error.code }, { status: error.httpStatus });
    }
    return apiError(`${role}_dashboard_failed`, error, { status: 500 });
  }
}
