import { NextResponse, type NextRequest } from "next/server";
import {
  recordVendorRequestOutcome,
  VendorRequestError,
  resolveCrmAuthContext,
} from "@sangfor/business";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: requestId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }

    const body = await req.json();
    const { outcome, expectedRevision, evidenceArtifactVersionId, externalReference } = body;

    if (
      !outcome ||
      (outcome !== "approved" && outcome !== "rejected" && outcome !== "completed") ||
      typeof expectedRevision !== "number"
    ) {
      return NextResponse.json({ error: "Invalid outcome command parameters" }, { status: 400 });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });

    const result = await recordVendorRequestOutcome({
      authContext,
      requestId,
      outcome,
      expectedRevision,
      evidenceArtifactVersionId,
      externalReference,
      idempotencyKey,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof VendorRequestError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
