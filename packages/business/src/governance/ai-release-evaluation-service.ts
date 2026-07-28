import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { Prisma, canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";
import { RELEASE_SELECTOR, AI_QUALITY_POLICIES } from "./ai-quality-types";
import { evaluateCurrentReviewSet } from "./ai-quality-review-service";

export class AiReleaseEvaluationError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "AiReleaseEvaluationError";
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

export type CompleteAiReleaseEvaluationCommand = {
  authContext: AuthContext;
  artifactId: string;
  expectedArtifactVersionId: string;
  expectedArtifactContentHash: string;
  expectedArtifactRevision: number;
  assessmentId: string;
  expectedAssessmentResultHash: string;
  action: string;
  approvalId?: string;
  expectedApprovalRevision?: number;
  idempotencyKey: string;
};

const FORBIDDEN_EVAL_FIELDS = new Set([
  "wrapperKind", "policyKey", "policyVersion", "policyHash", "reviewSetHash",
  "evaluationInputHash", "eligibility", "blockers", "owner", "reviewer", "assessor",
  "actor", "scope", "approvalSnapshot", "audit", "status", "timestamp", "resultHash",
  "evaluationKey", "slot", "quorum",
]);

function validateEvalCommand(cmd: Record<string, unknown>): void {
  if (!cmd.artifactId) throw new AiReleaseEvaluationError("ARTIFACT_ID_REQUIRED", "artifactId required", 400);
  if (!cmd.assessmentId) throw new AiReleaseEvaluationError("ASSESSMENT_ID_REQUIRED", "assessmentId required", 400);
  if (!cmd.action) throw new AiReleaseEvaluationError("ACTION_REQUIRED", "action required", 400);
  if (!cmd.idempotencyKey) throw new AiReleaseEvaluationError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey required", 400);
  for (const key of Object.keys(cmd)) {
    if (FORBIDDEN_EVAL_FIELDS.has(key)) {
      throw new AiReleaseEvaluationError("FORBIDDEN_FIELD", `Caller cannot supply: ${key}`, 403);
    }
  }
}

function resolveReleasePolicy(wrapperKind: string, action: string): string {
  const wrapperActions = RELEASE_SELECTOR[wrapperKind];
  if (!wrapperActions) throw new AiReleaseEvaluationError("UNKNOWN_WRAPPER", `No release selector for: ${wrapperKind}`, 422);
  const policyKey = wrapperActions[action];
  if (!policyKey) throw new AiReleaseEvaluationError("UNKNOWN_ACTION", `No release policy for: ${action}`, 422);
  return policyKey;
}

export async function completeCurrentAiReleaseEvaluation(
  cmd: CompleteAiReleaseEvaluationCommand,
): Promise<{ evaluationId: string; idempotent: boolean }> {
  validateEvalCommand(cmd as unknown as Record<string, unknown>);

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`aiqrel:${cmd.artifactId}:${cmd.action}`}, 0))`,
    );

    const artifact = await tx.artifact.findUniqueOrThrow({ where: { id: cmd.artifactId } });
    if (artifact.currentVersionId !== cmd.expectedArtifactVersionId) {
      throw new AiReleaseEvaluationError("AI_RELEASE_EVALUATION_STALE", "Artifact version mismatch", 409);
    }
    if (artifact.currentRevision !== cmd.expectedArtifactRevision) {
      throw new AiReleaseEvaluationError("AI_RELEASE_EVALUATION_STALE", "Artifact revision mismatch", 409);
    }

    const assessment = await tx.aiQualityAssessment.findFirst({
      where: { id: cmd.assessmentId, artifactVersionId: cmd.expectedArtifactVersionId, status: "completed" },
      orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
    });
    if (!assessment) {
      throw new AiReleaseEvaluationError("ASSESSMENT_NOT_FOUND", "No completed assessment", 404);
    }
    if (assessment.resultHash !== cmd.expectedAssessmentResultHash) {
      throw new AiReleaseEvaluationError("AI_RELEASE_EVALUATION_STALE", "Assessment result hash mismatch", 409);
    }

    const wrapperKind = artifact.artifactType?.toLowerCase() ?? "proposal";
    const policyKey = resolveReleasePolicy(wrapperKind, cmd.action);
    const policy = AI_QUALITY_POLICIES[policyKey];
    if (!policy) throw new AiReleaseEvaluationError("UNKNOWN_POLICY", `Unknown policy: ${policyKey}`, 422);

    const reviewSet = await evaluateCurrentReviewSet(tx, cmd.assessmentId, policyKey);
    if (!reviewSet.complete) {
      throw new AiReleaseEvaluationError("REVIEW_SET_INCOMPLETE", `Reviews incomplete: ${reviewSet.blockers.join(", ")}`, 409);
    }

    const assignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!assignment) {
      throw new AiReleaseEvaluationError("NO_ASSIGNMENT", "No active same-company assignment", 403);
    }

    const requestKeyHash = sha256Hex(canonicalizeRfc8785({
      companyId: ctx.companyId,
      actorAssignmentId: assignment.id,
      action: cmd.action,
      artifactVersionId: cmd.expectedArtifactVersionId,
      idempotencyKey: cmd.idempotencyKey,
    }));

    const existing = await tx.aiReleaseEvaluation.findFirst({
      where: { evaluationKey: requestKeyHash },
    });
    if (existing) {
      return { evaluationId: existing.id, idempotent: true };
    }

    const policyHash = sha256Hex(canonicalizeRfc8785({
      policyKey: policy.policyKey,
      policyVersion: policy.policyVersion,
      slots: policy.slots,
      quorum: policy.quorum,
    }));

    const evaluationInput = {
      artifactId: cmd.artifactId,
      artifactVersionId: cmd.expectedArtifactVersionId,
      artifactContentHash: cmd.expectedArtifactContentHash,
      expectedArtifactRevision: cmd.expectedArtifactRevision,
      assessmentId: cmd.assessmentId,
      assessmentResultHash: cmd.expectedAssessmentResultHash,
      action: cmd.action,
      policyKey,
      policyVersion: policy.policyVersion,
      policyHash,
      reviewSetHash: reviewSet.reviewSetHash,
      approvalId: cmd.approvalId ?? null,
      expectedApprovalRevision: cmd.expectedApprovalRevision ?? null,
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
      idempotencyKey: cmd.idempotencyKey,
    };

    const evaluationInputHash = sha256Hex(canonicalizeRfc8785(evaluationInput));

    const evaluation = await tx.aiReleaseEvaluation.create({
      data: {
        evaluationKey: requestKeyHash,
        evaluationInputHash,
        reviewSetHash: reviewSet.reviewSetHash,
        artifactVersionId: cmd.expectedArtifactVersionId,
        artifactContentHash: cmd.expectedArtifactContentHash,
        assessmentId: cmd.assessmentId,
        action: cmd.action,
        policyKey,
        policyVersion: policy.policyVersion,
        policyHash,
        approvalRequestId: cmd.approvalId ?? null,
        approvalRequestRevision: cmd.expectedApprovalRevision ?? null,
        eligible: assessment.qualityPassed,
        blockers: assessment.qualityPassed ? [] : ["quality_not_passed"],
        evaluatedAt: new Date(),
      },
    });

    await appendAuditEvent(tx, {
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" },
      eventType: "ai_quality.release_evaluation_completed",
      resourceType: "AiReleaseEvaluation",
      resourceId: evaluation.id,
      actorId: ctx.userId,
      details: {
        artifactId: cmd.artifactId,
        action: cmd.action,
        eligible: assessment.qualityPassed,
        reviewSetHash: reviewSet.reviewSetHash,
      },
    });

    return { evaluationId: evaluation.id, idempotent: false };
  });
}

export async function requireCurrentAiReleaseEvaluation(
  tx: any,
  action: string,
  artifactVersionId: string,
  artifactContentHash: string,
): Promise<{ evaluationId: string; eligible: boolean; blockers: string[] }> {
  const evaluation = await tx.aiReleaseEvaluation.findFirst({
    where: { action, artifactVersionId, artifactContentHash },
    orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
  });

  if (!evaluation) {
    throw new AiReleaseEvaluationError("AI_RELEASE_EVALUATION_REQUIRED", "No release evaluation found", 404);
  }

  return {
    evaluationId: evaluation.id,
    eligible: evaluation.eligible,
    blockers: evaluation.blockers as string[],
  };
}
