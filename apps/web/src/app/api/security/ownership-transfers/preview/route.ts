import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { previewOwnershipTransfer, OwnershipTransferError, resolveCrmAuthContext } from "@sangfor/business";

export async function POST(req: NextRequest) {
  const cacheHeaders = { "Cache-Control": "no-store" };
  try {
    // Preview is read-only — Idempotency-Key is rejected (no persistence)
    if (req.headers.has("Idempotency-Key")) {
      return NextResponse.json({ error: "Idempotency-Key is not allowed on preview (read-only)" }, { status: 400, headers: cacheHeaders });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const { roleChangeRequestId, successorAssignmentId } = body;
    if (!roleChangeRequestId || !successorAssignmentId || Object.keys(body).some((k) => !["roleChangeRequestId", "successorAssignmentId"].includes(k))) {
      return NextResponse.json({ error: "body must be exactly {roleChangeRequestId,successorAssignmentId}" }, { status: 400, headers: cacheHeaders });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await previewOwnershipTransfer({ authContext, roleChangeRequestId, successorAssignmentId });
    return NextResponse.json(result, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof OwnershipTransferError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
