import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { createArtifactVersion } from "../governance/artifact-service";
import { completeCurrentAiQualityAssessment } from "../governance/ai-quality-service";
import { requireCurrentAiReleaseEvaluation } from "../governance/ai-release-evaluation-service";

export class GovernedProposalError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "GovernedProposalError";
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

export type GenerateGovernedProposalCommand = {
  authContext: AuthContext;
  opportunityId?: string;
  title: string;
  content?: string;
  templateKey?: string;
  idempotencyKey: string;
};

export type GenerateGovernedProposalResult = {
  artifactId: string;
  versionId: string;
  contentHash: string;
  revision: number;
  assessmentId: string;
  assessmentResultHash: string;
  qualityPassed: boolean;
  internalReleaseAllowed: boolean;
  customerSendAllowed: boolean;
};

export async function generateGovernedProposal(
  cmd: GenerateGovernedProposalCommand,
): Promise<GenerateGovernedProposalResult> {
  if (!cmd.title || typeof cmd.title !== "string" || cmd.title.length < 2) {
    throw new GovernedProposalError("TITLE_REQUIRED", "title is required (min 2 chars)", 400);
  }
  if (!cmd.idempotencyKey || typeof cmd.idempotencyKey !== "string") {
    throw new GovernedProposalError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    // 1. Resolve or create assignment & Artifact
    const assignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!assignment) {
      throw new GovernedProposalError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    const proposalContent = cmd.content ?? JSON.stringify({
      title: cmd.title,
      templateKey: cmd.templateKey ?? "standard-proposal",
      opportunityId: cmd.opportunityId ?? null,
      generatedAt: new Date().toISOString(),
    });

    const artifact = await tx.artifact.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        title: cmd.title,
        artifactType: "PROPOSAL",
        classification: "internal",
        origin: "ai",
        createdByAssignmentId: assignment.id,
        ownerAssignmentId: assignment.id,
      },
    });

    const seedCaller = {
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? "anonymous",
      mfaVerifiedAt: new Date(),
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
    };

    const ver = await createArtifactVersion(
      {
        artifactId: artifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: proposalContent,
        contentType: "application/json",
      },
      seedCaller,
      tx,
    );

    // 2. Derive adapter idempotency key and delegate to U054 completeCurrentAiQualityAssessment
    const adapterIdempotencyInput = {
      schemaVersion: "ai-quality-adapter-idempotency/v1",
      adapterKind: "proposal",
      generationReceiptId: artifact.id,
      artifactVersionId: ver.versionId,
      idempotencyKey: cmd.idempotencyKey,
    };
    const adapterIdempotencyKey = sha256Hex(canonicalizeRfc8785(adapterIdempotencyInput));

    const assessmentRes = await completeCurrentAiQualityAssessment({
      authContext: ctx,
      artifactId: artifact.id,
      expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: adapterIdempotencyKey,
    });

    const assessment = await tx.aiQualityAssessment.findUniqueOrThrow({
      where: { id: assessmentRes.assessmentId },
    });

    // 3. Delegate to U054 requireCurrentAiReleaseEvaluation for release checks
    let internalReleaseAllowed = false;
    let customerSendAllowed = false;
    try {
      const relInternal = await requireCurrentAiReleaseEvaluation(tx, "ai.internal_release", ver.versionId, ver.contentHash);
      internalReleaseAllowed = relInternal.eligible;
    } catch {
      internalReleaseAllowed = false;
    }

    try {
      const relCustomer = await requireCurrentAiReleaseEvaluation(tx, "ai.customer_send", ver.versionId, ver.contentHash);
      customerSendAllowed = relCustomer.eligible;
    } catch {
      customerSendAllowed = false;
    }

    return {
      artifactId: artifact.id,
      versionId: ver.versionId,
      contentHash: ver.contentHash,
      revision: 1,
      assessmentId: assessment.id,
      assessmentResultHash: assessment.resultHash,
      qualityPassed: assessment.qualityPassed,
      internalReleaseAllowed,
      customerSendAllowed,
    };
  });
}
