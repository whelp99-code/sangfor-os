import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { createArtifactVersion } from "../governance/artifact-service";
import { completeCurrentAiQualityAssessment } from "../governance/ai-quality-service";
import { requireCurrentAiReleaseEvaluation } from "../governance/ai-release-evaluation-service";
import { recordHumanDecision } from "./project-decision";
import { promoteDomainProposalToDocument } from "./proposal-promote";
import type { DomainKey } from "./artifact-domain-map";

export class GovernedDomainProposalError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "GovernedDomainProposalError";
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

export type GenerateGovernedDomainProposalCommand = {
  authContext: AuthContext;
  engagementId: string;
  domain: DomainKey | string;
  title?: string;
  bodyMarkdown?: string;
  idempotencyKey: string;
};

export type GenerateGovernedDomainProposalResult = {
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

export async function generateGovernedDomainProposal(
  cmd: GenerateGovernedDomainProposalCommand,
): Promise<GenerateGovernedDomainProposalResult> {
  if (!cmd.engagementId || typeof cmd.engagementId !== "string") {
    throw new GovernedDomainProposalError("ENGAGEMENT_ID_REQUIRED", "engagementId is required", 400);
  }
  if (!cmd.idempotencyKey || typeof cmd.idempotencyKey !== "string") {
    throw new GovernedDomainProposalError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const assignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!assignment) {
      throw new GovernedDomainProposalError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    const engagement = await tx.engagement.findUniqueOrThrow({
      where: { id: cmd.engagementId },
    });

    const proposalTitle = cmd.title ?? `Domain Proposal — ${cmd.domain} for ${engagement.name}`;
    const proposalBody = cmd.bodyMarkdown ?? `# Domain Proposal (${cmd.domain})\n\nProposal for engagement: ${engagement.name}`;

    const artifact = await tx.artifact.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        title: proposalTitle,
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
        content: JSON.stringify({
          title: proposalTitle,
          domain: cmd.domain,
          engagementId: cmd.engagementId,
          bodyMarkdown: proposalBody,
          generatedAt: new Date().toISOString(),
        }),
        contentType: "application/json",
      },
      seedCaller,
      tx,
    );

    const adapterIdempotencyInput = {
      schemaVersion: "ai-quality-adapter-idempotency/v1",
      adapterKind: "domain_proposal",
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

export type RecordGovernedHumanDecisionCommand = {
  authContext: AuthContext;
  engagementId: string;
  artifactId: string;
  expectedArtifactVersionId: string;
  expectedArtifactRevision: number;
  decision: "approved" | "rejected" | "modified";
  notes?: string;
  idempotencyKey: string;
};

export async function recordGovernedHumanDecision(
  cmd: RecordGovernedHumanDecisionCommand,
): Promise<{ decisionId: string; promotedDocumentId?: string }> {
  if (!cmd.engagementId || !cmd.artifactId || !cmd.idempotencyKey) {
    throw new GovernedDomainProposalError("INVALID_COMMAND", "engagementId, artifactId, and idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const artifact = await tx.artifact.findUniqueOrThrow({
      where: { id: cmd.artifactId },
    });

    if (artifact.currentVersionId !== cmd.expectedArtifactVersionId) {
      throw new GovernedDomainProposalError("AI_QUALITY_SNAPSHOT_STALE", "Artifact version mismatch", 409);
    }
    if (artifact.currentRevision !== cmd.expectedArtifactRevision) {
      throw new GovernedDomainProposalError("AI_QUALITY_SNAPSHOT_STALE", "Artifact revision mismatch", 409);
    }

    const outcomeVal = cmd.decision === "approved" ? "approved" : cmd.decision === "rejected" ? "rejected" : "corrected";

    // Call recordHumanDecision compatibility helper
    const decisionRes = await recordHumanDecision({
      engagementId: cmd.engagementId,
      domain: "presales",
      outcome: outcomeVal,
      note: cmd.notes,
    });

    let promotedDocumentId: string | undefined;
    if (cmd.decision === "approved") {
      const promoteRes = await promoteDomainProposalToDocument({
        engagementId: cmd.engagementId,
        title: artifact.title,
        bodyMarkdown: "# Promoted Document",
        domain: "presales",
      });
      promotedDocumentId = promoteRes?.documentId;
    }

    return {
      decisionId: decisionRes.decisionId,
      promotedDocumentId,
    };
  });
}
