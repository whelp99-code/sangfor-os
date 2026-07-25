import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { closeSupportCase, SupportCaseError, resolveCrmAuthContext } from "@sangfor/business";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: supportCaseId } = await params;
    const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header required" }, { status: 400 });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { expectedRevision } = body;
    if (expectedRevision === undefined) {
      return NextResponse.json({ error: "expectedRevision required" }, { status: 400 });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null, tenantId: session.tenantId,
      companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await closeSupportCase({
      authContext,
      supportCaseId,
      expectedRevision,
      idempotencyKey,
      now: new Date(),
      rcaArtifactVersionId: body.rcaArtifactVersionId,
      rcaArtifactContentHash: body.rcaArtifactContentHash,
      assessmentId: body.assessmentId,
      assessmentResultHash: body.assessmentResultHash,
      approvalId: body.approvalId,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof SupportCaseError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
