import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";

export class RetentionServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RetentionServiceError";
    this.code = code;
    this.httpStatus = status;
  }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export type RetentionPreviewInput = {
  authContext: AuthContext;
  retentionAssignmentId: string;
  maxItems?: number;
  idempotencyKey: string;
  now: Date;
};

export async function previewRetentionRun(input: RetentionPreviewInput) {
  const { authContext, retentionAssignmentId, idempotencyKey, now } = input;
  const maxItems = Math.min(input.maxItems ?? 100, 100);
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    // Validate assignment — resourceKind is on RetentionAssignment, action is on policyVersion
    const assignment = await tx.retentionAssignment.findUniqueOrThrow({
      where: { id: retentionAssignmentId },
      include: { policyVersion: true },
    });

    // RetentionAssignment has resourceKind; RetentionPolicyVersion has action
    if (assignment.policyVersion.action !== "purge" || assignment.resourceKind !== "knowledge_chunk") {
      throw new RetentionServiceError(
        "RETENTION_UNSUPPORTED_POLICY",
        `Unsupported retention policy action="${assignment.policyVersion.action}" kind="${assignment.resourceKind}"`,
        422,
      );
    }

    // KnowledgeChunk → documentId → KnowledgeDocument.projectId → Project.companyId
    // Filter by projectId via document relation (document has projectId scalar)
    const chunks = await tx.knowledgeChunk.findMany({
      where: { document: { projectId: { not: undefined } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: maxItems,
      include: { document: { select: { id: true, projectId: true } } },
    });

    const items = chunks.map((chunk: any, idx: number) => ({
      ordinal: idx,
      phase: "preview",
      resourceKind: "knowledge_chunk",
      resourceId: chunk.id,
      documentId: chunk.documentId,
      projectId: chunk.document.projectId,
      policyVersionId: assignment.policyVersionId,
      policyContentHash: assignment.policyVersion.contentHash,
      preActionHash: sha256Hex(canonicalizeRfc8785({
        resourceKind: "knowledge_chunk",
        id: chunk.id,
        documentId: chunk.documentId,
        projectId: chunk.document.projectId,
        createdAt: chunk.createdAt.toISOString(),
        content: chunk.content,
      })),
      decision: "candidate",
      outcome: "not_executed",
      holdSetHash: sha256Hex("[]"),
    }));

    const previewHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "retention-preview/v1",
      retentionAssignmentId,
      policyVersionId: assignment.policyVersionId,
      policyContentHash: assignment.policyVersion.contentHash,
      cutoffAt: now.toISOString(),
      maxItems,
      items: items.map((i: any) => ({
        ordinal: i.ordinal, resourceId: i.resourceId,
        decision: i.decision, preActionHash: i.preActionHash, holdSetHash: i.holdSetHash,
      })),
    }));

    const inputHash = sha256Hex(canonicalizeRfc8785({
      retentionAssignmentId, policyVersionId: assignment.policyVersionId, maxItems, idempotencyKey,
    }));

    const auditLog = await appendAuditEvent(tx, {
      scope,
      eventType: "governance.retention.previewed",
      actorId: authContext.userId,
      resourceType: "retention_run",
      resourceId: `preview-${idempotencyKey}`,
      details: { retentionAssignmentId, previewHash, itemCount: items.length, inputHash },
      idempotencyKey,
    });

    const run = await tx.retentionRun.create({
      data: {
        companyId: scope.companyId,
        retentionAssignmentId,
        policyVersionId: assignment.policyVersionId,
        policyContentHash: assignment.policyVersion.contentHash,
        resourceKind: "knowledge_chunk",
        action: "purge",
        phase: "preview",
        status: "completed",
        revision: 0,
        cutoffAt: now,
        maxItems,
        previewHash,
        itemCount: items.length,
        candidateCount: items.filter((i: any) => i.decision === "candidate").length,
        heldCount: 0,
        ineligibleCount: 0,
        actorAssignmentId: authContext.userId,
        idempotencyKey,
        inputHash,
        auditLogId: auditLog.id,
        // Nested create for items — RetentionRunItem requires document/project/policyVersion connect
        items: {
          create: items.map((item: any) => ({
            ordinal: item.ordinal,
            phase: "preview",
            resourceKind: item.resourceKind,
            resourceId: item.resourceId,
            documentId: item.documentId,
            projectId: item.projectId,
            policyVersionId: item.policyVersionId,
            policyContentHash: item.policyContentHash,
            preActionHash: item.preActionHash,
            holdSetHash: item.holdSetHash,
            decision: item.decision,
            outcome: item.outcome,
          })),
        },
      },
    });

    return { runId: run.id, previewHash, itemCount: items.length };
  });
}
