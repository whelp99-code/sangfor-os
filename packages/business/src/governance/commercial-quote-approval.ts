import type { AuthContext } from "@sangfor/auth";
import { prisma, withRlsTransaction } from "@sangfor/db";
import { submitApprovalRequest, type ApprovalKernelCaller } from "./approval-kernel";
import {
  DEFAULT_COMMERCIAL_POLICY,
  evaluateWithPolicySnapshot,
  type CommercialPolicySnapshot,
  type PolicyBoundApprovalDecision,
} from "./commercial-approval";

export class CommercialQuoteApprovalError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "CommercialQuoteApprovalError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function kernelCallerFromContext(ctx: AuthContext): ApprovalKernelCaller {
  return {
    userId: ctx.userId,
    sessionId: ctx.sessionId ?? "anonymous",
    scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
    mfaVerifiedAt: null,
  };
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId };
}

export type CommercialQuoteApprovalResult = {
  quoteId: string;
  quoteVersion: number;
  contentHash: string;
  artifactVersionId: string;
  decision: PolicyBoundApprovalDecision;
  approvalRequestId: string | null;
  approvalStatus: string | null;
  aiQualityIntegration: "DEFERRED_TO_U055";
};

export async function createCommercialApprovalForQuote(
  ctx: AuthContext,
  quoteId: string,
  policy?: CommercialPolicySnapshot,
): Promise<CommercialQuoteApprovalResult> {
  const caller = kernelCallerFromContext(ctx);
  const activePolicy = policy ?? DEFAULT_COMMERCIAL_POLICY;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id: quoteId, companyId: ctx.companyId },
      include: {
        commercialSnapshot: true,
        artifactVersion: true,
      },
    });

    if (!quote) {
      throw new CommercialQuoteApprovalError("NOT_FOUND", "Quote not found", 404);
    }

    if (!quote.artifactVersionId || !quote.artifactVersion) {
      throw new CommercialQuoteApprovalError("ARTIFACT_LINK_MISSING", "Quote has no artifact version link", 422);
    }

    if (!quote.commercialSnapshot) {
      throw new CommercialQuoteApprovalError("SNAPSHOT_MISSING", "Quote has no commercial snapshot", 422);
    }

    if (!quote.contentHash) {
      throw new CommercialQuoteApprovalError("HASH_MISSING", "Quote has no content hash", 422);
    }

    if (quote.commercialSnapshot.costCoverageStatus === "auto_failed") {
      throw new CommercialQuoteApprovalError(
        "COST_COVERAGE_AUTO_FAILED",
        "Quote has auto_failed cost coverage and cannot enter approval readiness",
        422,
      );
    }

    const revenue = parseFloat(quote.commercialSnapshot.calculatedRevenue.toString());
    const cost = parseFloat(quote.commercialSnapshot.calculatedCost.toString());

    const lineDiscounts = await tx.quoteLineItem.findMany({
      where: { quoteId: quote.id },
      select: { discountPct: true },
    });
    const maxDiscountPct = lineDiscounts.length
      ? Math.max(...lineDiscounts.map((l) => parseFloat(l.discountPct.toString())))
      : 0;

    const decision = evaluateWithPolicySnapshot(
      {
        revenue,
        cost,
        discountPercent: maxDiscountPct,
        action: activePolicy.policyKey,
      },
      activePolicy,
    );

    let approvalRequestId: string | null = null;
    let approvalStatus: string | null = null;

    if (decision.decision === "requires_approval") {
      const assignment = await tx.userCompanyRole.findFirst({
        where: {
          userId: ctx.userId,
          companyId: ctx.companyId,
          status: "active",
        },
      });

      if (!assignment) {
        throw new CommercialQuoteApprovalError("NO_ASSIGNMENT", "Caller has no active assignment", 403);
      }

      const existingApproval = await tx.approvalRequest.findFirst({
        where: {
          artifactVersionId: quote.artifactVersionId,
          action: activePolicy.policyKey,
          status: { in: ["pending", "ready_for_human_approval"] },
        },
      });

      if (existingApproval) {
        approvalRequestId = existingApproval.id;
        approvalStatus = existingApproval.status;
      } else {
        const result = await submitApprovalRequest(
          {
            action: activePolicy.policyKey,
            artifactVersionId: quote.artifactVersionId,
            artifactHash: quote.artifactVersion.contentHash,
            policyVersion: activePolicy.policyVersion,
            requiredQuorum: activePolicy.requiredQuorum,
          },
          caller,
          tx,
        );
        approvalRequestId = result.request.id;
        approvalStatus = result.request.status;
      }
    }

    return {
      quoteId: quote.id,
      quoteVersion: quote.version,
      contentHash: quote.contentHash,
      artifactVersionId: quote.artifactVersionId,
      decision,
      approvalRequestId,
      approvalStatus,
      aiQualityIntegration: "DEFERRED_TO_U055" as const,
    };
  });
}

export async function getCommercialApprovalStatus(
  ctx: AuthContext,
  quoteId: string,
): Promise<CommercialQuoteApprovalResult> {
  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id: quoteId, companyId: ctx.companyId },
      include: {
        commercialSnapshot: true,
        artifactVersion: true,
      },
    });

    if (!quote) {
      throw new CommercialQuoteApprovalError("NOT_FOUND", "Quote not found", 404);
    }

    if (!quote.artifactVersionId || !quote.artifactVersion) {
      throw new CommercialQuoteApprovalError("ARTIFACT_LINK_MISSING", "Quote has no artifact version link", 422);
    }

    if (!quote.commercialSnapshot) {
      throw new CommercialQuoteApprovalError("SNAPSHOT_MISSING", "Quote has no commercial snapshot", 422);
    }

    const revenue = parseFloat(quote.commercialSnapshot.calculatedRevenue.toString());
    const cost = parseFloat(quote.commercialSnapshot.calculatedCost.toString());

    const lineDiscounts = await tx.quoteLineItem.findMany({
      where: { quoteId: quote.id },
      select: { discountPct: true },
    });
    const maxDiscountPct = lineDiscounts.length
      ? Math.max(...lineDiscounts.map((l) => parseFloat(l.discountPct.toString())))
      : 0;

    const decision = evaluateWithPolicySnapshot(
      {
        revenue,
        cost,
        discountPercent: maxDiscountPct,
        action: DEFAULT_COMMERCIAL_POLICY.policyKey,
      },
      DEFAULT_COMMERCIAL_POLICY,
    );

    const currentApproval = await tx.approvalRequest.findFirst({
      where: {
        artifactVersionId: quote.artifactVersionId,
        action: DEFAULT_COMMERCIAL_POLICY.policyKey,
      },
      orderBy: { revision: "desc" },
    });

    return {
      quoteId: quote.id,
      quoteVersion: quote.version,
      contentHash: quote.contentHash ?? "",
      artifactVersionId: quote.artifactVersionId,
      decision,
      approvalRequestId: currentApproval?.id ?? null,
      approvalStatus: currentApproval?.status ?? null,
      aiQualityIntegration: "DEFERRED_TO_U055" as const,
    };
  });
}
