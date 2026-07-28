import { NextResponse, type NextRequest } from "next/server";
import {
  acceptDeliveryProjection,
  DeliveryAcceptanceError,
  resolveCrmAuthContext,
} from "@sangfor/business";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: engagementId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { quoteId, artifactVersionId, evidenceDetails } = body;

    if (!quoteId || !artifactVersionId) {
      return NextResponse.json({ error: "quoteId and artifactVersionId are required" }, { status: 400 });
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

    const result = await acceptDeliveryProjection({
      authContext,
      engagementId,
      quoteId,
      artifactVersionId,
      idempotencyKey,
      evidenceDetails,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof DeliveryAcceptanceError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
