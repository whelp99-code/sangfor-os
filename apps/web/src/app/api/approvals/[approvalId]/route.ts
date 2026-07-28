import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { getApprovalDetail, ApprovalDetailError, resolveCrmAuthContext } from "@sangfor/business";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  const { approvalId } = await params;
  const cacheHeaders = { "Cache-Control": "no-store" };

  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await getApprovalDetail({ authContext, approvalId });
    return NextResponse.json(result, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof ApprovalDetailError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
