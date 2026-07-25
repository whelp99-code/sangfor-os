import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { SupportCaseError } from "./support-service";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

// ─── set_current ────────────────────────────────────────────────────────────

export type SetCurrentRcaInput = {
  authContext: AuthContext;
  supportCaseId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  expectedRevision: number;
  idempotencyKey: string;
  now: Date;
};

export async function setCurrentRcaArtifactVersion(input: SetCurrentRcaInput) {
  const { authContext, supportCaseId, artifactVersionId, artifactContentHash, expectedRevision, idempotencyKey, now } = input;
  const { prisma } = await import("@sangfor/db");

  return withRlsTransaction(rlsScope(authContext), async (tx) => {
    const sc = await tx.supportCase.findUniqueOrThrow({ where: { id: supportCaseId } });
    if (sc.revision !== expectedRevision) {
      throw new SupportCaseError("SUPPORT_CASE_REVISION_CONFLICT", `Revision mismatch: expected ${expectedRevision}, found ${sc.revision}`, 409);
    }

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "support-rca-set-current/v1",
      supportCaseId,
      artifactVersionId,
      artifactContentHash,
      idempotencyKey,
    }));

    const updated = await tx.supportCase.update({
      where: { id: supportCaseId },
      data: { rcaArtifactVersionId: artifactVersionId, revision: expectedRevision + 1, updatedAt: now },
    });

    await appendAuditEvent(tx, {
      scope: rlsScope(authContext),
      eventType: "support.rca.set_current",
      actorId: authContext.userId,
      resourceType: "support_case",
      resourceId: supportCaseId,
      details: { inputHash, artifactVersionId, artifactContentHash },
      idempotencyKey,
    });

    return updated;
  });
}

// ─── assess_current ──────────────────────────────────────────────────────────

export type AssessCurrentRcaInput = {
  authContext: AuthContext;
  supportCaseId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  expectedRevision: number;
  expectedArtifactRevision: number;
  idempotencyKey: string;
};

export async function assessCurrentRca(input: AssessCurrentRcaInput) {
  const { authContext, supportCaseId, artifactVersionId, artifactContentHash, expectedRevision, expectedArtifactRevision, idempotencyKey } = input;
  const { prisma } = await import("@sangfor/db");

  const sc = await prisma.supportCase.findUniqueOrThrow({ where: { id: supportCaseId } });
  if (sc.revision !== expectedRevision) {
    throw new SupportCaseError("SUPPORT_CASE_REVISION_CONFLICT", `Revision mismatch`, 409);
  }
  if (sc.rcaArtifactVersionId !== artifactVersionId) {
    throw new SupportCaseError("RCA_VERSION_MISMATCH", "Supplied version is not the current RCA artifact version", 409);
  }

  // Delegate to U054 quality assessment service
  const { completeCurrentAiQualityAssessment } = await import("../governance/ai-quality-service");
  return completeCurrentAiQualityAssessment({
    authContext,
    artifactId: sc.rcaArtifactVersionId ?? artifactVersionId,
    expectedArtifactVersionId: artifactVersionId,
    expectedArtifactContentHash: artifactContentHash,
    expectedArtifactRevision,
    idempotencyKey,
  });
}

// ─── request_internal_approval ───────────────────────────────────────────────

export type RequestRcaApprovalInput = {
  authContext: AuthContext;
  supportCaseId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  assessmentId: string;
  assessmentResultHash: string;
  expectedRevision: number;
  idempotencyKey: string;
  now: Date;
};

export async function requestRcaInternalApproval(input: RequestRcaApprovalInput) {
  const { authContext, supportCaseId, artifactVersionId, artifactContentHash, assessmentId, assessmentResultHash, expectedRevision, idempotencyKey, now } = input;
  const { prisma } = await import("@sangfor/db");

  const sc = await prisma.supportCase.findUniqueOrThrow({ where: { id: supportCaseId } });
  if (sc.revision !== expectedRevision) {
    throw new SupportCaseError("SUPPORT_CASE_REVISION_CONFLICT", `Revision mismatch`, 409);
  }
  if (sc.rcaArtifactVersionId !== artifactVersionId) {
    throw new SupportCaseError("RCA_VERSION_MISMATCH", "Supplied version is not the current RCA artifact version", 409);
  }

  // Verify assessment exists and passed quality
  const assessment = await prisma.aiQualityAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment || assessment.status !== "completed" || !assessment.qualityPassed) {
    throw new SupportCaseError("RCA_ASSESSMENT_REQUIRED", "Valid completed quality-pass assessment required", 422);
  }
  if (assessment.resultHash !== assessmentResultHash) {
    throw new SupportCaseError("RCA_ASSESSMENT_NOT_CURRENT", "Assessment result hash mismatch — stale", 409);
  }

  // Verify two ordered human reviews exist (support_lead + solution_architect)
  const reviews = await prisma.aiQualityReview.findMany({
    where: { assessmentId, decision: "approved" },
    orderBy: { createdAt: "asc" },
  });

  const leadReview = reviews.find((r: any) => r.reviewerRole === "support.rca.support_lead");
  const archReview = reviews.find((r: any) => r.reviewerRole === "support.rca.solution_architect");

  if (!leadReview) {
    throw new SupportCaseError("RCA_ASSESSMENT_REQUIRED", "Support Lead review required before approval request", 422);
  }
  if (!archReview) {
    throw new SupportCaseError("RCA_ASSESSMENT_REQUIRED", "Solution Architect review required before approval request", 422);
  }

  return withRlsTransaction(rlsScope(authContext), async (tx) => {
    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "support-rca-approval-request/v1",
      supportCaseId,
      artifactVersionId,
      assessmentId,
      assessmentResultHash,
      idempotencyKey,
    }));

    // Create or reuse canonical ApprovalRequest via U022 public API
    const { submitApprovalRequest } = await import("../governance/approval-kernel");
    const approvalResult = await submitApprovalRequest(
      {
        action: "support.rca.internal_approval",
        artifactVersionId,
        artifactHash: artifactContentHash,
        policyVersion: "support.rca.human_review.v1/1",
        requiredQuorum: 2,
      },
      {
        userId: authContext.userId,
        sessionId: authContext.sessionId ?? "anon",
        mfaVerifiedAt: null,
        scope: {
          tenantId: authContext.tenantId,
          companyId: authContext.companyId,
          projectId: authContext.projectId,
        },
      },
      tx as any,
    );

    await appendAuditEvent(tx, {
      scope: rlsScope(authContext),
      eventType: "support.rca.internal_approval_requested",
      actorId: authContext.userId,
      resourceType: "support_case",
      resourceId: supportCaseId,
      details: { inputHash, artifactVersionId, assessmentId, approvalRequestId: approvalResult.request.id },
      idempotencyKey,
    });

    return approvalResult.request;
  });
}

// ─── close support case ──────────────────────────────────────────────────────

export type CloseSupportCaseInput = {
  authContext: AuthContext;
  supportCaseId: string;
  expectedRevision: number;
  idempotencyKey: string;
  now: Date;
  // RCA-required fields (all-or-none)
  rcaArtifactVersionId?: string;
  rcaArtifactContentHash?: string;
  assessmentId?: string;
  assessmentResultHash?: string;
  approvalId?: string;
};

export async function closeSupportCase(input: CloseSupportCaseInput) {
  const { authContext, supportCaseId, expectedRevision, idempotencyKey, now } = input;

  return withRlsTransaction(rlsScope(authContext), async (tx) => {
    const sc = await tx.supportCase.findUniqueOrThrow({ where: { id: supportCaseId } });

    if (sc.status !== "resolved") {
      throw new SupportCaseError("INVALID_TRANSITION", `Cannot close case in status ${sc.status}`, 409);
    }
    if (sc.revision !== expectedRevision) {
      throw new SupportCaseError("SUPPORT_CASE_REVISION_CONFLICT", `Revision mismatch: expected ${expectedRevision}, found ${sc.revision}`, 409);
    }

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "support-case-close/v1",
      supportCaseId,
      expectedRevision,
      idempotencyKey,
    }));

    const updated = await tx.supportCase.update({
      where: { id: supportCaseId },
      data: { status: "closed", revision: sc.revision + 1, closedAt: now, updatedAt: now },
    });

    await appendAuditEvent(tx, {
      scope: rlsScope(authContext),
      eventType: "support.case.closed",
      actorId: authContext.userId,
      resourceType: "support_case",
      resourceId: supportCaseId,
      details: { inputHash, fromRevision: sc.revision, toRevision: sc.revision + 1 },
      idempotencyKey,
    });

    return updated;
  });
}
