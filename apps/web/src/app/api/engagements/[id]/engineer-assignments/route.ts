import { NextResponse, type NextRequest } from "next/server";
import { assignEngineerToEngagement, EngineerEligibilityError, resolveCrmAuthContext } from "@sangfor/business";
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

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { requirementId, engineerMembershipId, expectedRequirementSnapshotHash } = body;

    const authContext = await resolveCrmAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });

    const result = await assignEngineerToEngagement({
      authContext,
      engagementId,
      requirementId,
      engineerMembershipId,
      expectedRequirementSnapshotHash,
      idempotencyKey,
      now: new Date(),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof EngineerEligibilityError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
