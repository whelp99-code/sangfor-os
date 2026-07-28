import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { RetentionServiceError, resolveCrmAuthContext } from "@sangfor/business";

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
    const { previewHash } = body;
    if (!previewHash || typeof previewHash !== "string" || previewHash.length !== 64) {
      return NextResponse.json({ error: "previewHash must be 64 lowercase hex" }, { status: 400, headers: cacheHeaders });
    }

    // Stub: in full impl, creates retention_purge_manifest ArtifactVersion and ApprovalRequest via U022
    return NextResponse.json({ runId, approvalRequestId: `apr-${runId}`, status: "pending" }, { status: 201, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof RetentionServiceError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
