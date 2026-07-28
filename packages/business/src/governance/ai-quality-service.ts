import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { Prisma, canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import type { ApprovalKernelCaller } from "./approval-kernel";
import { appendAuditEvent } from "./audit-db";
import { evaluateQuality } from "./ai-quality-gate";
import {
  AI_QUALITY_THRESHOLDS,
  WRAPPER_POLICY_SELECTOR,
  type AiQualityEvidenceInput,
  type AiPromptProvenance,
  type AiModelProvenance,
} from "./ai-quality-types";

export class AiQualityServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "AiQualityServiceError";
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

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export type CompleteAiQualityAssessmentCommand = {
  authContext: AuthContext;
  artifactId: string;
  expectedArtifactVersionId: string;
  expectedArtifactContentHash: string;
  expectedArtifactRevision: number;
  idempotencyKey: string;
};

const FORBIDDEN_CALLER_FIELDS = new Set([
  "score", "policyKey", "policyVersion", "status", "resultHash", "qualityPassed",
  "customerSendAllowed", "evaluatorKey", "evaluatorVersion", "evidence", "citations",
  "sourceCoverage", "knownGaps", "missingInfo", "confidenceBasis", "injectionDetected",
  "leakageDetected", "blockers", "assessedByAssignmentId", "assessmentInputHash",
  "assessedAt", "wrapperKind", "actor", "scope", "timestamp", "reviewer", "slot",
  "action", "audit", "hash", "promptProvenance", "modelProvenance", "toolProvenance",
]);

function validateCommand(cmd: Record<string, unknown>): void {
  if (!cmd.artifactId || typeof cmd.artifactId !== "string") {
    throw new AiQualityServiceError("ARTIFACT_ID_REQUIRED", "artifactId is required", 400);
  }
  if (!cmd.idempotencyKey || typeof cmd.idempotencyKey !== "string") {
    throw new AiQualityServiceError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required", 400);
  }
  if (!cmd.expectedArtifactVersionId || typeof cmd.expectedArtifactVersionId !== "string") {
    throw new AiQualityServiceError("VERSION_ID_REQUIRED", "expectedArtifactVersionId is required", 400);
  }
  if (!cmd.expectedArtifactContentHash || typeof cmd.expectedArtifactContentHash !== "string") {
    throw new AiQualityServiceError("CONTENT_HASH_REQUIRED", "expectedArtifactContentHash is required", 400);
  }
  if (typeof cmd.expectedArtifactRevision !== "number" || !Number.isFinite(cmd.expectedArtifactRevision)) {
    throw new AiQualityServiceError("REVISION_REQUIRED", "expectedArtifactRevision must be a finite number", 400);
  }
  for (const key of Object.keys(cmd)) {
    if (FORBIDDEN_CALLER_FIELDS.has(key)) {
      throw new AiQualityServiceError("FORBIDDEN_FIELD", `Caller cannot supply field: ${key}`, 403);
    }
  }
}

function resolvePolicyKey(wrapperKind: string, action: string): string {
  const wrapperPolicies = WRAPPER_POLICY_SELECTOR[wrapperKind];
  if (!wrapperPolicies) {
    throw new AiQualityServiceError("UNKNOWN_WRAPPER", `Unknown wrapper kind: ${wrapperKind}`, 422);
  }
  const policyKey = wrapperPolicies[action];
  if (!policyKey) {
    throw new AiQualityServiceError("UNKNOWN_ACTION", `No policy for action: ${action}`, 422);
  }
  return policyKey;
}

export async function completeCurrentAiQualityAssessment(
  cmd: CompleteAiQualityAssessmentCommand,
): Promise<{ assessmentId: string; idempotent: boolean }> {
  validateCommand(cmd as unknown as Record<string, unknown>);

  const ctx = cmd.authContext;
  const caller = kernelCallerFromContext(ctx);

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`aiq:${cmd.artifactId}`}, 0))`,
    );

    const artifact = await tx.artifact.findUniqueOrThrow({
      where: { id: cmd.artifactId },
    });

    if (artifact.currentVersionId !== cmd.expectedArtifactVersionId) {
      throw new AiQualityServiceError("AI_QUALITY_SNAPSHOT_STALE", "Artifact current version mismatch", 409);
    }
    if (artifact.currentRevision !== cmd.expectedArtifactRevision) {
      throw new AiQualityServiceError("AI_QUALITY_SNAPSHOT_STALE", "Artifact current revision mismatch", 409);
    }

    const artifactVersion = await tx.artifactVersion.findUnique({
      where: { id: cmd.expectedArtifactVersionId },
    });
    if (!artifactVersion || artifactVersion.contentHash !== cmd.expectedArtifactContentHash) {
      throw new AiQualityServiceError("AI_QUALITY_SNAPSHOT_STALE", "Artifact version content hash mismatch", 409);
    }

    const assignment = await tx.userCompanyRole.findFirst({
      where: {
        userId: ctx.userId,
        companyId: ctx.companyId,
        status: "active",
      },
    });
    if (!assignment) {
      throw new AiQualityServiceError("NO_ASSIGNMENT", "No active same-company assignment", 403);
    }

    const existing = await tx.aiQualityAssessment.findFirst({
      where: {
        artifactVersionId: cmd.expectedArtifactVersionId,
        assessedByAssignmentId: assignment.id,
        idempotencyKey: cmd.idempotencyKey,
      },
    });

    if (existing) {
      return { assessmentId: existing.id, idempotent: true };
    }

    const wrapperKind = artifact.artifactType?.toLowerCase() ?? "proposal";
    const action = wrapperKind === "quote" ? "quote.internal_release" : "ai.internal_release";
    const policyKey = resolvePolicyKey(wrapperKind, action);

    const evaluatorResult = evaluateQuality({
      score: 0,
      injectionBlockRate: 0,
      leakageDetected: false,
      sourceCitationRate: 0,
      gaps: ["evaluator_not_configured"],
    });

    const canonicalResult = {
      score: evaluatorResult.score,
      qualityPassed: evaluatorResult.passed,
      injectionBlockRate: evaluatorResult.details.injectionBlockRate,
      leakageDetected: evaluatorResult.details.leakageDetected,
      sourceCitationRate: evaluatorResult.details.sourceCitationRate,
      gaps: evaluatorResult.details.gaps,
    };

    const resultHash = sha256Hex(canonicalizeRfc8785(canonicalResult));

    const assessmentInput = {
      artifactId: cmd.artifactId,
      artifactVersionId: cmd.expectedArtifactVersionId,
      artifactContentHash: cmd.expectedArtifactContentHash,
      expectedArtifactRevision: cmd.expectedArtifactRevision,
      wrapperKind,
      policyKey,
      policyVersion: "1",
      evaluatorKey: "sangfor-deterministic-v1",
      evaluatorVersion: "1",
      promptModelToolSnapshotHashes: [],
      evidenceIdentityHashes: [],
      canonicalAssessmentResult: canonicalResult,
      assessedByAssignmentId: assignment.id,
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
      idempotencyKey: cmd.idempotencyKey,
    };

    const assessmentInputHash = sha256Hex(canonicalizeRfc8785(assessmentInput));

    const assessment = await tx.aiQualityAssessment.create({
      data: {
        artifactVersionId: cmd.expectedArtifactVersionId,
        artifactContentHash: cmd.expectedArtifactContentHash,
        resultHash,
        policyKey,
        policyVersion: "1",
        evaluatorKey: "sangfor-deterministic-v1",
        evaluatorVersion: "1",
        status: "completed",
        score: evaluatorResult.score,
        sourceCoverage: evaluatorResult.details.sourceCitationRate,
        confidenceBasis: { basis: "deterministic-evaluator-v1" },
        missingInfo: [],
        knownGaps: evaluatorResult.details.gaps,
        riskFlags: [],
        injectionDetected: false,
        leakageDetected: evaluatorResult.details.leakageDetected,
        qualityPassed: evaluatorResult.passed,
        assessedByAssignmentId: assignment.id,
        idempotencyKey: cmd.idempotencyKey,
        assessmentInputHash,
        assessedAt: new Date(),
      },
    });

    await appendAuditEvent(tx, {
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" },
      eventType: "ai_quality.assessment_completed",
      resourceType: "AiQualityAssessment",
      resourceId: assessment.id,
      actorId: ctx.userId,
      details: {
        artifactId: cmd.artifactId,
        artifactVersionId: cmd.expectedArtifactVersionId,
        policyKey,
        qualityPassed: evaluatorResult.passed,
        resultHash,
      },
    });

    return { assessmentId: assessment.id, idempotent: false };
  });
}
