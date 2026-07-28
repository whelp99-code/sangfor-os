import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { completeCurrentAiReleaseEvaluation } from "./ai-release-evaluation-service";
import { evaluateCommercialApproval } from "./commercial-approval";

export class CommercialReleaseError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "CommercialReleaseError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId };
}

export type ReleaseGovernedQuoteCommand = {
  authContext: AuthContext;
  quoteId: string;
  expectedQuoteRevision?: number;
  artifactId: string;
  expectedArtifactVersionId: string;
  expectedArtifactContentHash: string;
  expectedArtifactRevision: number;
  assessmentId: string;
  expectedAssessmentResultHash: string;
  approvalId?: string;
  expectedApprovalRevision?: number;
  idempotencyKey: string;
};

export type ReleaseGovernedQuoteResult = {
  evaluationId: string;
  evaluationKey: string;
  artifactVersionId: string;
  action: string;
  policyKey: string;
  eligible: boolean;
  blockers: string[];
  evaluatedAt: Date | string;
};

export async function releaseGovernedQuote(
  cmd: ReleaseGovernedQuoteCommand,
): Promise<ReleaseGovernedQuoteResult> {
  if (!cmd.quoteId || typeof cmd.quoteId !== "string") {
    throw new CommercialReleaseError("QUOTE_ID_REQUIRED", "quoteId is required", 400);
  }
  if (!cmd.artifactId || !cmd.assessmentId || !cmd.idempotencyKey) {
    throw new CommercialReleaseError("INVALID_COMMAND", "artifactId, assessmentId, idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    // 1. Resolve Quote and evaluate U048 commercial approval prerequisite
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: cmd.quoteId },
    });

    if (cmd.expectedQuoteRevision !== undefined && quote.version !== cmd.expectedQuoteRevision) {
      throw new CommercialReleaseError("QUOTE_REVISION_MISMATCH", "Quote revision mismatch", 409);
    }

    const revenue = Number(quote.totalRevenue ?? 0);
    const cost = Number(quote.totalCost ?? 0);
    const discountPercent = 0;

    const commDecision = evaluateCommercialApproval({
      revenue,
      cost,
      discountPercent,
      action: "quote.internal_release",
    });

    if (commDecision.blocked) {
      throw new CommercialReleaseError(
        "COMMERCIAL_APPROVAL_REQUIRED",
        `Commercial approval blocked: ${commDecision.reasons.join(", ")}`,
        409,
      );
    }

    // 2. Delegate to U054 completeCurrentAiReleaseEvaluation for quote.internal_release
    const evalRes = await completeCurrentAiReleaseEvaluation({
      authContext: ctx,
      artifactId: cmd.artifactId,
      expectedArtifactVersionId: cmd.expectedArtifactVersionId,
      expectedArtifactContentHash: cmd.expectedArtifactContentHash,
      expectedArtifactRevision: cmd.expectedArtifactRevision,
      assessmentId: cmd.assessmentId,
      expectedAssessmentResultHash: cmd.expectedAssessmentResultHash,
      action: "quote.internal_release",
      approvalId: cmd.approvalId,
      expectedApprovalRevision: cmd.expectedApprovalRevision,
      idempotencyKey: cmd.idempotencyKey,
    });

    const record = await tx.aiReleaseEvaluation.findUniqueOrThrow({
      where: { id: evalRes.evaluationId },
    });

    return {
      evaluationId: record.id,
      evaluationKey: record.evaluationKey,
      artifactVersionId: record.artifactVersionId,
      action: record.action,
      policyKey: record.policyKey,
      eligible: record.eligible,
      blockers: record.blockers as string[],
      evaluatedAt: record.evaluatedAt,
    };
  });
}
