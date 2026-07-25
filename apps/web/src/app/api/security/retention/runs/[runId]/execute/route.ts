import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { executeRetentionRun, RetentionServiceError, resolveCrmAuthContext } from "@sangfor/business";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const cacheHeaders = { "Cache-Control": "no-store" };
  try {
    const idempotencyKey = req.headers.get("Idempotency-Key");
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key header required" }, { status: 400, headers: cacheHeaders });

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const { approvalId, previewHash, dryRun } = body;

    if (!approvalId || !previewHash) {
      return NextResponse.json({ error: "approvalId and previewHash required" }, { status: 400, headers: cacheHeaders });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await executeRetentionRun({
      previewRunId: runId,
      approvalId,
      previewHash,
      dryRun: dryRun !== false,
      actorId: authContext.userId,
      now: new Date(),
    });

    return NextResponse.json(result, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof RetentionServiceError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
