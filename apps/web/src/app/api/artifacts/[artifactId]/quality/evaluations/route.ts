import { NextResponse, type NextRequest } from "next/server";
import {
  completeCurrentAiReleaseEvaluation,
  AiReleaseEvaluationError,
  resolveCrmAuthContext,
} from "@sangfor/business";

import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

const ALLOWED_EVAL_ACTIONS = new Set(["ai.internal_release", "ai.customer_send"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }

    const body = await req.json();
    const {
      artifactVersionId,
      artifactContentHash,
      expectedArtifactRevision,
      assessmentId,
      expectedAssessmentResultHash,
      action,
      approvalId,
      expectedApprovalRevision,
    } = body;

    if (!ALLOWED_EVAL_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `Action '${action}' is not supported for generic evaluations route` },
        { status: 400 },
      );
    }

    if (
      !assessmentId ||
      !artifactVersionId ||
      !artifactContentHash ||
      !expectedAssessmentResultHash ||
      typeof expectedArtifactRevision !== "number"
    ) {
      return NextResponse.json({ error: "Invalid evaluation parameters" }, { status: 400 });
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

    const result = await completeCurrentAiReleaseEvaluation({
      authContext,
      artifactId,
      expectedArtifactVersionId: artifactVersionId,
      expectedArtifactContentHash: artifactContentHash,
      expectedArtifactRevision,
      assessmentId,
      expectedAssessmentResultHash,
      action,
      approvalId,
      expectedApprovalRevision,
      idempotencyKey,
    });

    const status = result.idempotent ? 200 : 201;
    const res = NextResponse.json({ evaluationId: result.evaluationId }, { status });
    res.headers.set("Idempotent-Replay", result.idempotent ? "true" : "false");
    return res;
  } catch (err: any) {
    if (err instanceof AiReleaseEvaluationError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
