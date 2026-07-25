import { NextResponse, type NextRequest } from "next/server";
import {
  releaseGovernedQuote,
  CommercialReleaseError,
  resolveCrmAuthContext,
} from "@sangfor/business";

import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: quoteId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }

    const body = await req.json();
    const {
      expectedQuoteRevision,
      artifactId,
      expectedArtifactVersionId,
      expectedArtifactContentHash,
      expectedArtifactRevision,
      assessmentId,
      expectedAssessmentResultHash,
      approvalId,
      expectedApprovalRevision,
    } = body;

    if (
      !artifactId ||
      !expectedArtifactVersionId ||
      !expectedArtifactContentHash ||
      !assessmentId ||
      !expectedAssessmentResultHash ||
      typeof expectedArtifactRevision !== "number"
    ) {
      return NextResponse.json({ error: "Invalid quote release parameters" }, { status: 400 });
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

    const result = await releaseGovernedQuote({
      authContext,
      quoteId,
      expectedQuoteRevision,
      artifactId,
      expectedArtifactVersionId,
      expectedArtifactContentHash,
      expectedArtifactRevision,
      assessmentId,
      expectedAssessmentResultHash,
      approvalId,
      expectedApprovalRevision,
      idempotencyKey,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof CommercialReleaseError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
