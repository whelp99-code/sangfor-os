import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { reprobeTarget, acknowledgeObservation, IntegrationObservabilityError, resolveCrmAuthContext } from "@sangfor/business";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const cacheHeaders = { "Cache-Control": "no-store" };

  try {
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return NextResponse.json({ error: "Idempotency-Key header (16–128 chars) required" }, { status: 400, headers: cacheHeaders });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    if (action === "reprobe-target") {
      const { targetId } = body;
      if (!targetId) return NextResponse.json({ error: "targetId required" }, { status: 400, headers: cacheHeaders });
      const result = await reprobeTarget({ authContext, targetId, idempotencyKey });
      return NextResponse.json(result, { status: result.state === "healthy" || result.state === "degraded" ? 200 : 503, headers: cacheHeaders });
    }

    if (action === "acknowledge-observation") {
      const { targetId, observationId } = body;
      if (!targetId || !observationId) return NextResponse.json({ error: "targetId and observationId required" }, { status: 400, headers: cacheHeaders });
      const result = await acknowledgeObservation({ authContext, targetId, observationId, idempotencyKey });
      return NextResponse.json(result, { status: 200, headers: cacheHeaders });
    }

    return NextResponse.json({ error: "Unsupported remediation action" }, { status: 404, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof IntegrationObservabilityError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
