import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, Prisma, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";
import { RetentionServiceError } from "./retention-service";

export { RetentionServiceError };

export type ExecuteRetentionRunInput = {
  previewRunId: string;
  approvalId: string;
  previewHash: string;
  dryRun?: boolean;
  authContext?: AuthContext;
  actorId: string;
  now: Date;
  u009Receipt?: unknown;
};

type U009Receipt = {
  unit: "U009";
  alias: "T-OPS";
  exitCode: 0;
  sentinelMatch: true;
  checks: Record<string, "PASS">;
  cleanup: { containers: 0; networks: 0; volumes: 0 };
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scopeFrom(ctx: AuthContext) {
  return {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    level: "PROJECT" as const,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertU009Receipt(receipt: unknown): asserts receipt is U009Receipt {
  const expectedDigest = process.env["RETENTION_U009_RECEIPT_SHA256"];
  if (!expectedDigest || !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    throw new RetentionServiceError(
      "RETENTION_U009_RECEIPT_REQUIRED",
      "Destructive purge requires a digest-pinned U009 receipt",
      403,
    );
  }

  if (!isObject(receipt)) {
    throw new RetentionServiceError("RETENTION_U009_RECEIPT_INVALID", "U009 receipt is required", 403);
  }

  const canonicalReceipt = canonicalizeRfc8785(receipt);
  if (sha256Hex(canonicalReceipt) !== expectedDigest) {
    throw new RetentionServiceError("RETENTION_U009_RECEIPT_INVALID", "U009 receipt digest mismatch", 403);
  }

  const checks = receipt["checks"];
  const cleanup = receipt["cleanup"];
  const validChecks = isObject(checks)
    && Object.keys(checks).length > 0
    && Object.values(checks).every((value) => value === "PASS");
  const validCleanup = isObject(cleanup)
    && cleanup["containers"] === 0
    && cleanup["networks"] === 0
    && cleanup["volumes"] === 0;

  if (
    receipt["unit"] !== "U009"
    || receipt["alias"] !== "T-OPS"
    || receipt["exitCode"] !== 0
    || receipt["sentinelMatch"] !== true
    || !validChecks
    || !validCleanup
  ) {
    throw new RetentionServiceError("RETENTION_U009_RECEIPT_INVALID", "U009 receipt is not a passing isolated restore receipt", 403);
  }
}

function assertApprovalManifestContent(content: unknown, previewRunId: string, previewHash: string): void {
  if (!isObject(content) || content["previewRunId"] !== previewRunId || content["previewHash"] !== previewHash) {
    throw new RetentionServiceError(
      "RETENTION_APPROVAL_MANIFEST_MISMATCH",
      "Approval manifest is not bound to this retention preview",
      409,
    );
  }
}

function chunkHash(chunk: {
  id: string;
  documentId: string;
  content: string;
  createdAt: Date;
  document: { projectId: string };
}): string {
  return sha256Hex(canonicalizeRfc8785({
    resourceKind: "knowledge_chunk",
    id: chunk.id,
    documentId: chunk.documentId,
    projectId: chunk.document.projectId,
    createdAt: chunk.createdAt.toISOString(),
    content: chunk.content,
  }));
}

export async function executeRetentionRun(input: ExecuteRetentionRunInput): Promise<{
  status: string;
  purgedCount: number;
  wouldPurgeCount: number;
}> {
  const dryRun = input.dryRun !== false;
  const authContext = input.authContext;

  if (!authContext || authContext.userId !== input.actorId) {
    throw new RetentionServiceError(
      "RETENTION_AUTH_CONTEXT_REQUIRED",
      "A server-derived actor and RLS scope are required",
      403,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.previewHash)) {
    throw new RetentionServiceError("RETENTION_PREVIEW_HASH_INVALID", "previewHash must be 64 lowercase hex", 400);
  }

  if (!dryRun) {
    if (process.env["RETENTION_LOCAL_PURGE_ALLOWED"] !== "1") {
      throw new RetentionServiceError(
        "RETENTION_EXTERNAL_APPROVAL_REQUIRED",
        "Destructive purge requires RETENTION_LOCAL_PURGE_ALLOWED=1 and a valid U009 task-owned receipt",
        403,
      );
    }
    assertU009Receipt(input.u009Receipt);
  }

  const scope = scopeFrom(authContext);
  const executionMode = dryRun ? "dry_run" : "local_purge";
  const idempotencyKey = sha256Hex(canonicalizeRfc8785({
    previewRunId: input.previewRunId,
    approvalId: input.approvalId,
    previewHash: input.previewHash,
    actorId: input.actorId,
    executionMode,
  }));

  return withRlsTransaction(scope, async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`retention:${input.previewRunId}`}, 0))`,
    );

    const actorAssignment = await tx.userCompanyRole.findFirst({
      where: { userId: input.actorId, companyId: scope.companyId, status: "active" },
      select: { id: true },
    });
    if (!actorAssignment) {
      throw new RetentionServiceError("RETENTION_ACTOR_ASSIGNMENT_INVALID", "Active actor assignment not found", 403);
    }

    const existingExecution = await tx.retentionRun.findFirst({
      where: {
        previewRunId: input.previewRunId,
        phase: "execution",
        actorAssignmentId: actorAssignment.id,
        idempotencyKey,
      },
    });
    if (existingExecution) {
      return {
        status: existingExecution.status,
        purgedCount: existingExecution.purgedCount,
        wouldPurgeCount: existingExecution.wouldPurgeCount,
      };
    }

    const preview = await tx.retentionRun.findFirst({
      where: { id: input.previewRunId, companyId: scope.companyId, phase: "preview" },
      include: { items: { orderBy: { ordinal: "asc" } }, retentionAssignment: true },
    });
    if (!preview || preview.status !== "completed") {
      throw new RetentionServiceError("RETENTION_PREVIEW_NOT_FOUND", "Completed retention preview not found", 404);
    }
    if (preview.previewHash !== input.previewHash) {
      throw new RetentionServiceError("RETENTION_PREVIEW_STALE", "Preview hash mismatch", 409);
    }
    if (!preview.retentionAssignment.active || (preview.retentionAssignment.dueAt && preview.retentionAssignment.dueAt > input.now)) {
      throw new RetentionServiceError("RETENTION_ASSIGNMENT_INELIGIBLE", "Retention assignment is not currently executable", 409);
    }

    const approval = await tx.approvalRequest.findFirst({
      where: { id: input.approvalId, companyId: scope.companyId, projectId: scope.projectId },
      include: { currentValidity: true, artifactVersion: true },
    });
    const validity = approval?.currentValidity;
    const manifest = approval?.artifactVersion;
    if (
      !approval
      || approval.legacyUnbound
      || approval.status !== "approved"
      || approval.action !== "retention.purge"
      || !validity
      || validity.state !== "valid"
      || validity.requestRevision !== approval.revision
      || !validity.validUntil
      || validity.validUntil <= input.now
      || validity.artifactVersionId !== approval.artifactVersionId
      || validity.artifactHashSnapshot !== approval.artifactHashSnapshot
      || validity.policyHashSnapshot !== approval.policyHash
      || !manifest
      || manifest.contentHash !== approval.artifactHashSnapshot
    ) {
      throw new RetentionServiceError("RETENTION_APPROVAL_INVALID", "Current canonical approval is required", 403);
    }
    assertApprovalManifestContent(manifest.contentJson, input.previewRunId, input.previewHash);

    const revalidatedItems = [];
    let blocked = false;
    for (const item of preview.items) {
      const holds = await tx.legalHoldScope.findMany({
        where: {
          companyId: scope.companyId,
          resourceKind: item.resourceKind,
          OR: [{ resourceId: item.resourceId }, { resourceId: null }],
          legalHold: { status: "active", releasedAt: null },
        },
        select: { legalHoldId: true },
        orderBy: { legalHoldId: "asc" },
      });
      const holdSetHash = sha256Hex(canonicalizeRfc8785(holds.map((hold) => hold.legalHoldId)));
      const chunk = await tx.knowledgeChunk.findFirst({
        where: { id: item.resourceId, documentId: item.documentId },
        include: { document: { select: { projectId: true } } },
      });
      const unchanged = chunk !== null
        && chunk.document.projectId === item.projectId
        && item.policyVersionId === preview.policyVersionId
        && item.policyContentHash === preview.policyContentHash
        && chunkHash(chunk) === item.preActionHash
        && holdSetHash === item.holdSetHash;
      const held = holds.length > 0;
      const executable = item.decision === "candidate" && unchanged && !held;
      if (!executable) blocked = true;

      revalidatedItems.push({
        source: item,
        chunk,
        holdSetHash,
        decision: held ? "held" : executable ? "candidate" : "ineligible",
        outcome: executable ? (dryRun ? "would_purge" : "purged") : "blocked",
        reasonCode: held ? "legal_hold" : executable ? null : "candidate_drift",
      });
    }

    const revalidationHash = sha256Hex(canonicalizeRfc8785({
      previewRunId: preview.id,
      previewHash: preview.previewHash,
      items: revalidatedItems.map((item) => ({
        resourceId: item.source.resourceId,
        decision: item.decision,
        outcome: item.outcome,
        holdSetHash: item.holdSetHash,
      })),
    }));
    const inputHash = sha256Hex(canonicalizeRfc8785({ idempotencyKey, revalidationHash }));
    const status = blocked ? "blocked" : "completed";
    const executableItems = blocked ? [] : revalidatedItems;
    const wouldPurgeCount = dryRun && !blocked ? executableItems.length : 0;
    const purgedCount = !dryRun && !blocked ? executableItems.length : 0;

    if (!dryRun && !blocked) {
      const deleted = await tx.knowledgeChunk.deleteMany({
        where: {
          OR: executableItems.map((item) => ({
            id: item.source.resourceId,
            documentId: item.source.documentId,
            content: item.chunk!.content,
            createdAt: item.chunk!.createdAt,
          })),
        },
      });
      if (deleted.count !== purgedCount) {
        throw new RetentionServiceError("RETENTION_PURGE_CAS_FAILED", "Candidate set changed during purge", 409);
      }
    }

    const audit = await appendAuditEvent(tx, {
      scope,
      eventType: "governance.retention.executed",
      actorId: input.actorId,
      resourceType: "retention_run",
      resourceId: input.previewRunId,
      details: { executionMode, previewHash: input.previewHash, revalidationHash, status, purgedCount, wouldPurgeCount },
      idempotencyKey: `retention-execution:${idempotencyKey}`,
      occurredAt: input.now,
    });

    await tx.retentionRun.create({
      data: {
        companyId: preview.companyId,
        phase: "execution",
        status,
        revision: preview.revision + 1,
        retentionAssignmentId: preview.retentionAssignmentId,
        policyVersionId: preview.policyVersionId,
        policyContentHash: preview.policyContentHash,
        resourceKind: preview.resourceKind,
        action: preview.action,
        cutoffAt: preview.cutoffAt,
        maxItems: preview.maxItems,
        previewHash: preview.previewHash,
        itemCount: revalidatedItems.length,
        candidateCount: revalidatedItems.filter((item) => item.decision === "candidate").length,
        heldCount: revalidatedItems.filter((item) => item.decision === "held").length,
        ineligibleCount: revalidatedItems.filter((item) => item.decision === "ineligible").length,
        actorAssignmentId: actorAssignment.id,
        idempotencyKey,
        inputHash,
        auditLogId: audit.id,
        previewRunId: preview.id,
        executionMode,
        revalidationHash,
        approvalRequestId: approval.id,
        approvalRequestRevision: approval.revision,
        approvalManifestArtifactVersionId: manifest.id,
        approvalManifestContentHash: manifest.contentHash,
        approvalPolicyHash: approval.policyHash!,
        wouldPurgeCount,
        purgedCount,
        blockedCount: blocked ? revalidatedItems.length : 0,
        failedCount: 0,
        items: {
          create: revalidatedItems.map((item) => ({
            ordinal: item.source.ordinal,
            phase: "execution",
            resourceKind: item.source.resourceKind,
            resourceId: item.source.resourceId,
            documentId: item.source.documentId,
            projectId: item.source.projectId,
            policyVersionId: item.source.policyVersionId,
            policyContentHash: item.source.policyContentHash,
            preActionHash: item.source.preActionHash,
            holdSetHash: item.holdSetHash,
            decision: item.decision,
            outcome: blocked && item.outcome !== "blocked" ? "blocked" : item.outcome,
            reasonCode: blocked && item.reasonCode === null ? "batch_blocked" : item.reasonCode,
          })),
        },
      },
    });

    return { status, purgedCount, wouldPurgeCount };
  });
}
