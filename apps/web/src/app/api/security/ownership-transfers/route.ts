import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { createOwnershipTransfer, OwnershipTransferError, resolveCrmAuthContext } from "@sangfor/business";
import { randomUUID } from "node:crypto";

export async function POST(req: NextRequest) {
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
    const { roleChangeRequestId, successorAssignmentId, previewHash } = body;

    if (!roleChangeRequestId || !successorAssignmentId || !previewHash ||
        typeof previewHash !== "string" || !/^[0-9a-f]{64}$/.test(previewHash)) {
      return NextResponse.json({ error: "body must be exactly {roleChangeRequestId,successorAssignmentId,previewHash}" }, { status: 400, headers: cacheHeaders });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await createOwnershipTransfer({
      authContext, roleChangeRequestId, successorAssignmentId, previewHash, idempotencyKey, now: new Date(),
    });

    return NextResponse.json(result, { status: 201, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof OwnershipTransferError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
