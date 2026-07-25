import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { setCurrentRcaArtifactVersion, assessCurrentRca, requestRcaInternalApproval, SupportCaseError, resolveCrmAuthContext } from "@sangfor/business";

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
    const { action } = body;

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null, tenantId: session.tenantId,
      companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const now = new Date();

    if (action === "set_current") {
      const { artifactVersionId, artifactContentHash, expectedRevision } = body;
      if (!artifactVersionId || !artifactContentHash || expectedRevision === undefined) {
        return NextResponse.json({ error: "artifactVersionId, artifactContentHash, expectedRevision required" }, { status: 400 });
      }
      const result = await setCurrentRcaArtifactVersion({
        authContext, supportCaseId, artifactVersionId, artifactContentHash, expectedRevision, idempotencyKey, now,
      });
      return NextResponse.json(result, { status: 200 });
    }

    if (action === "assess_current") {
      const { artifactVersionId, artifactContentHash, expectedRevision, expectedArtifactRevision } = body;
      if (!artifactVersionId || !artifactContentHash || expectedRevision === undefined || expectedArtifactRevision === undefined) {
        return NextResponse.json({ error: "artifactVersionId, artifactContentHash, expectedRevision, expectedArtifactRevision required" }, { status: 400 });
      }
      const result = await assessCurrentRca({
        authContext, supportCaseId, artifactVersionId, artifactContentHash,
        expectedRevision, expectedArtifactRevision, idempotencyKey,
      });
      return NextResponse.json(result, { status: 200 });
    }

    if (action === "request_internal_approval") {
      const { artifactVersionId, artifactContentHash, assessmentId, assessmentResultHash, expectedRevision } = body;
      if (!artifactVersionId || !artifactContentHash || !assessmentId || !assessmentResultHash || expectedRevision === undefined) {
        return NextResponse.json({ error: "artifactVersionId, artifactContentHash, assessmentId, assessmentResultHash, expectedRevision required" }, { status: 400 });
      }
      const result = await requestRcaInternalApproval({
        authContext, supportCaseId, artifactVersionId, artifactContentHash,
        assessmentId, assessmentResultHash, expectedRevision, idempotencyKey, now,
      });
      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown action. Accepted: set_current, assess_current, request_internal_approval" }, { status: 400 });
  } catch (err: any) {
    if (err instanceof SupportCaseError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
