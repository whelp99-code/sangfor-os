import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { Prisma, canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";
import { AI_QUALITY_POLICIES, type AiQualityPolicy } from "./ai-quality-types";

export class AiQualityReviewError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "AiQualityReviewError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId };
}

export type SubmitAiQualityReviewCommand = {
  authContext: AuthContext;
  artifactId: string;
  expectedArtifactVersionId: string;
  expectedArtifactContentHash: string;
  expectedArtifactRevision: number;
  assessmentId: string;
  expectedAssessmentResultHash: string;
  decision: "approved" | "rejected";
  comment?: string;
  idempotencyKey: string;
};

const FORBIDDEN_REVIEW_FIELDS = new Set([
  "actor", "companyId", "projectId", "reviewerRole", "reviewSlotKey", "action",
  "assessmentPolicy", "audit", "reviewerRoleSnapshot", "reviewInputHash",
]);

function validateReviewCommand(cmd: Record<string, unknown>): void {
  if (!cmd.artifactId) throw new AiQualityReviewError("ARTIFACT_ID_REQUIRED", "artifactId required", 400);
  if (!cmd.assessmentId) throw new AiQualityReviewError("ASSESSMENT_ID_REQUIRED", "assessmentId required", 400);
  if (!cmd.idempotencyKey) throw new AiQualityReviewError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey required", 400);
  if (cmd.decision !== "approved" && cmd.decision !== "rejected") {
    throw new AiQualityReviewError("INVALID_DECISION", "decision must be approved or rejected", 400);
  }
  if (cmd.comment !== undefined && cmd.comment !== null) {
    if (typeof cmd.comment !== "string" || cmd.comment.length > 1000) {
      throw new AiQualityReviewError("INVALID_COMMENT", "comment must be 0-1000 chars", 400);
    }
  }
  for (const key of Object.keys(cmd)) {
    if (FORBIDDEN_REVIEW_FIELDS.has(key)) {
      throw new AiQualityReviewError("FORBIDDEN_FIELD", `Caller cannot supply: ${key}`, 403);
    }
  }
}

function resolvePolicyForAssessment(policyKey: string): AiQualityPolicy {
  const policy = AI_QUALITY_POLICIES[policyKey];
  if (!policy) throw new AiQualityReviewError("UNKNOWN_POLICY", `Unknown policy: ${policyKey}`, 422);
  return policy;
}

export async function submitAiQualityReview(
  cmd: SubmitAiQualityReviewCommand,
): Promise<{ reviewId: string; idempotent: boolean }> {
  validateReviewCommand(cmd as unknown as Record<string, unknown>);

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`aiqr:${cmd.assessmentId}`}, 0))`,
    );

    const artifact = await tx.artifact.findUniqueOrThrow({ where: { id: cmd.artifactId } });
    if (artifact.currentVersionId !== cmd.expectedArtifactVersionId) {
      throw new AiQualityReviewError("AI_QUALITY_SNAPSHOT_STALE", "Artifact version mismatch", 409);
    }
    if (artifact.currentRevision !== cmd.expectedArtifactRevision) {
      throw new AiQualityReviewError("AI_QUALITY_SNAPSHOT_STALE", "Artifact revision mismatch", 409);
    }

    const assessment = await tx.aiQualityAssessment.findFirst({
      where: {
        id: cmd.assessmentId,
        artifactVersionId: cmd.expectedArtifactVersionId,
        status: "completed",
      },
      orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
    });
    if (!assessment) {
      throw new AiQualityReviewError("ASSESSMENT_NOT_FOUND", "No completed assessment for this version", 404);
    }
    if (assessment.resultHash !== cmd.expectedAssessmentResultHash) {
      throw new AiQualityReviewError("AI_QUALITY_SNAPSHOT_STALE", "Assessment result hash mismatch", 409);
    }

    const policy = resolvePolicyForAssessment(assessment.policyKey);

    const existingReviews = await tx.aiQualityReview.findMany({
      where: { assessmentId: cmd.assessmentId },
      orderBy: [{ createdAt: "asc" }],
    });

    const existingSlotKeys = new Set(existingReviews.map((r: any) => r.reviewSlotKey));
    const existingReviewerIds = new Set(existingReviews.map((r: any) => r.reviewerAssignmentId));

    const hasRejection = existingReviews.some((r: any) => r.decision === "rejected");
    if (hasRejection) {
      throw new AiQualityReviewError("TERMINAL_REJECTION", "Assessment has a terminal rejection; no further reviews allowed", 409);
    }

    const nextSlot = policy.slots.find((s) => !existingSlotKeys.has(s.slotKey));
    if (!nextSlot) {
      throw new AiQualityReviewError("ALL_SLOTS_FILLED", "All review slots are already filled", 409);
    }

    const reviewerAssignment = await tx.userCompanyRole.findFirst({
      where: {
        userId: ctx.userId,
        companyId: ctx.companyId,
        role: nextSlot.businessRole,
        status: "active",
      },
    });
    if (!reviewerAssignment) {
      throw new AiQualityReviewError(
        "ROLE_MISMATCH",
        `Reviewer has no active same-company assignment holding required role: ${nextSlot.businessRole}`,
        403
      );
    }
    // Separation compares both UserCompanyRole.id and the resolved underlying User.id so
    // alternate memberships never let one human assess/review or fill two slots.
    if (reviewerAssignment.id === assessment.assessedByAssignmentId) {
      throw new AiQualityReviewError("ASSESSOR_CANNOT_REVIEW", "Assessor cannot review their own assessment", 403);
    }
    const assessorAssignment = await tx.userCompanyRole.findUnique({
      where: { id: assessment.assessedByAssignmentId },
      select: { userId: true },
    });
    if (assessorAssignment?.userId === ctx.userId) {
      throw new AiQualityReviewError(
        "ASSESSOR_CANNOT_REVIEW",
        "Assessor's underlying user cannot review via an alternate membership",
        403
      );
    }

    if (existingReviewerIds.has(reviewerAssignment.id)) {
      throw new AiQualityReviewError("DUPLICATE_REVIEWER", "Reviewer already submitted a review for this assessment", 409);
    }
    if (existingReviewerIds.size > 0) {
      const priorReviewerUsers = await tx.userCompanyRole.findMany({
        where: { id: { in: Array.from(existingReviewerIds) as string[] } },
        select: { userId: true },
      });
      if (priorReviewerUsers.some((prior: { userId: string }) => prior.userId === ctx.userId)) {
        throw new AiQualityReviewError(
          "DUPLICATE_REVIEWER",
          "The same underlying user cannot fill two review slots via alternate memberships",
          409
        );
      }
    }

    if (!(ctx.permissions as readonly string[] | undefined)?.includes(nextSlot.capability)) {
      throw new AiQualityReviewError(
        "CAPABILITY_MISSING",
        `Reviewer lacks required capability: ${nextSlot.capability}`,
        403
      );
    }

    const existing = await tx.aiQualityReview.findFirst({
      where: {
        assessmentId: cmd.assessmentId,
        reviewerAssignmentId: reviewerAssignment.id,
        idempotencyKey: cmd.idempotencyKey,
      },
    });
    if (existing) {
      return { reviewId: existing.id, idempotent: true };
    }

    const reviewerRoleSnapshot = JSON.stringify({
      businessRole: nextSlot.businessRole,
      capability: nextSlot.capability,
    });

    const reviewInput = {
      artifactId: cmd.artifactId,
      artifactVersionId: cmd.expectedArtifactVersionId,
      artifactContentHash: cmd.expectedArtifactContentHash,
      expectedArtifactRevision: cmd.expectedArtifactRevision,
      assessmentId: cmd.assessmentId,
      assessmentResultHash: cmd.expectedAssessmentResultHash,
      policyKey: assessment.policyKey,
      policyVersion: assessment.policyVersion,
      reviewSlotKey: nextSlot.slotKey,
      reviewerRoleSnapshot,
      decision: cmd.decision,
      comment: cmd.comment ?? null,
      reviewerAssignmentId: reviewerAssignment.id,
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
      idempotencyKey: cmd.idempotencyKey,
    };

    const reviewInputHash = sha256Hex(canonicalizeRfc8785(reviewInput));

    const review = await tx.aiQualityReview.create({
      data: {
        assessmentId: cmd.assessmentId,
        artifactVersionId: cmd.expectedArtifactVersionId,
        artifactContentHash: cmd.expectedArtifactContentHash,
        assessmentResultHash: cmd.expectedAssessmentResultHash,
        reviewSlotKey: nextSlot.slotKey,
        reviewerAssignmentId: reviewerAssignment.id,
        reviewerRoleSnapshot,
        decision: cmd.decision,
        comment: cmd.comment ?? null,
        idempotencyKey: cmd.idempotencyKey,
        reviewInputHash,
      },
    });

    await appendAuditEvent(tx, {
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" },
      eventType: "ai_quality.review_recorded",
      resourceType: "AiQualityReview",
      resourceId: review.id,
      actorId: ctx.userId,
      details: {
        assessmentId: cmd.assessmentId,
        reviewSlotKey: nextSlot.slotKey,
        decision: cmd.decision,
      },
    });

    return { reviewId: review.id, idempotent: false };
  });
}

export async function evaluateCurrentReviewSet(
  tx: any,
  assessmentId: string,
  policyKey: string,
): Promise<{ complete: boolean; reviewSetHash: string; blockers: string[] }> {
  const policy = resolvePolicyForAssessment(policyKey);
  const reviews = await tx.aiQualityReview.findMany({
    where: { assessmentId },
    orderBy: [{ reviewSlotKey: "asc" }],
  });

  const blockers: string[] = [];
  const slotMap = new Map<string, any>();
  for (const r of reviews) {
    slotMap.set(r.reviewSlotKey, r);
  }

  for (const slot of policy.slots) {
    const review = slotMap.get(slot.slotKey);
    if (!review) {
      blockers.push(`missing_slot:${slot.slotKey}`);
    } else if (review.decision !== "approved") {
      blockers.push(`not_approved:${slot.slotKey}`);
    }
  }

  if (reviews.length !== policy.slots.length) {
    blockers.push(`review_count_mismatch:expected=${policy.slots.length},actual=${reviews.length}`);
  }

  const sortedReviews = [...reviews].sort((a: any, b: any) =>
    a.reviewSlotKey < b.reviewSlotKey ? -1 : a.reviewSlotKey > b.reviewSlotKey ? 1 : 0,
  );

  const reviewSetHash = sha256Hex(
    canonicalizeRfc8785(
      sortedReviews.map((r: any) => ({
        id: r.id,
        policyKey,
        reviewSlotKey: r.reviewSlotKey,
        reviewerAssignmentId: r.reviewerAssignmentId,
        reviewerRoleSnapshot: r.reviewerRoleSnapshot,
        decision: r.decision,
        artifactVersionId: r.artifactVersionId,
        artifactContentHash: r.artifactContentHash,
        assessmentResultHash: r.assessmentResultHash,
        reviewInputHash: r.reviewInputHash,
      })),
    ),
  );

  return { complete: blockers.length === 0, reviewSetHash, blockers };
}
