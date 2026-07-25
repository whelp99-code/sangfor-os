import { NextResponse, type NextRequest } from "next/server";
import {
  submitAiQualityReview,
  AiQualityReviewError,
  resolveCrmAuthContext,
} from "@sangfor/business";

import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

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
      assessmentId,
      artifactVersionId,
      artifactContentHash,
      assessmentResultHash,
      expectedArtifactRevision,
      decision,
      comment,
    } = body;

    if (
      !assessmentId ||
      !artifactVersionId ||
      !artifactContentHash ||
      !assessmentResultHash ||
      typeof expectedArtifactRevision !== "number" ||
      (decision !== "approved" && decision !== "rejected")
    ) {
      return NextResponse.json(
        { error: "Invalid review parameters" },
        { status: 400 },
      );
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

    const result = await submitAiQualityReview({
      authContext,
      artifactId,
      expectedArtifactVersionId: artifactVersionId,
      expectedArtifactContentHash: artifactContentHash,
      expectedArtifactRevision,
      assessmentId,
      expectedAssessmentResultHash: assessmentResultHash,
      decision,
      comment,
      idempotencyKey,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof AiQualityReviewError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
