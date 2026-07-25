import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { getRoiDashboard, resolveCrmAuthContext } from "@sangfor/business";

export async function GET(req: NextRequest) {
  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const data = await getRoiDashboard({ authContext });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
