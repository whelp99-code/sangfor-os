import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { finalizeRoleChangeAfterOwnershipTransfer, OwnershipTransferError, resolveCrmAuthContext } from "@sangfor/business";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ownershipTransferId } = await params;
  const cacheHeaders = { "Cache-Control": "no-store" };
  try {
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length < 1 || idempotencyKey.length > 128) {
      return NextResponse.json({ error: "Idempotency-Key header (1–128 chars) required" }, { status: 400, headers: cacheHeaders });
    }

    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return NextResponse.json({ error: "Content-Type: application/json required" }, { status: 415, headers: cacheHeaders });

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const { expectedTransferRevision, expectedApprovalRevision, previewHash, reason } = body;

    if (
      typeof expectedTransferRevision !== "number" || expectedTransferRevision < 0 ||
      typeof expectedApprovalRevision !== "number" || expectedApprovalRevision < 0 ||
      typeof previewHash !== "string" || !/^[0-9a-f]{64}$/.test(previewHash)
    ) {
      return NextResponse.json({ error: "body must be {expectedTransferRevision,expectedApprovalRevision,previewHash,reason?}" }, { status: 400, headers: cacheHeaders });
    }

    if (reason !== undefined) {
      const trimmed = reason?.replace(/[\u0000-\u001f]/g, "").trim();
      if (!trimmed || trimmed.length > 500) {
        return NextResponse.json({ error: "reason must be 1–500 non-control chars" }, { status: 400, headers: cacheHeaders });
      }
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await finalizeRoleChangeAfterOwnershipTransfer({
      authContext, ownershipTransferId, expectedTransferRevision, expectedApprovalRevision,
      previewHash, reason: reason?.trim(), idempotencyKey, now: new Date(),
    });

    return NextResponse.json({ ...result, "Idempotent-Replay": false }, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof OwnershipTransferError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
