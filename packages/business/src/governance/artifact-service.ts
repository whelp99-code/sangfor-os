import { Prisma, prisma } from "@sangfor/db";
import { resolveActiveCompanyRole, type PersistedCompanyRoleAssignment } from "@sangfor/auth";

import { parseCanonicalArtifactContent } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";
import type { ApprovalKernelCaller } from "./approval-kernel";

type TxClient = Prisma.TransactionClient;

export interface ArtifactVersionWriter {
  readonly artifactId: string;
  readonly expectedCurrentVersionId: string | null;
  readonly expectedCurrentRevision: number;
  readonly content: string | Uint8Array;
  readonly contentType: string;
  readonly metadata?: Record<string, unknown>;
}

export interface CreatedArtifactVersion {
  readonly artifactId: string;
  readonly versionId: string;
  readonly version: number;
  readonly revision: number;
  readonly contentHash: string;
  readonly idempotent: boolean;
}

export type ArtifactServiceErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "STALE_CURRENT";

const HTTP_STATUS: Record<ArtifactServiceErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  STALE_CURRENT: 409,
};

export class ArtifactServiceError extends Error {
  readonly code: ArtifactServiceErrorCode;
  readonly httpStatus: number;

  constructor(code: ArtifactServiceErrorCode, message: string) {
    super(message);
    this.name = "ArtifactServiceError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function validateInput(input: ArtifactVersionWriter): void {
  if (typeof input.artifactId !== "string" || input.artifactId.length === 0) throw new ArtifactServiceError("VALIDATION_ERROR", "artifactId is required");
  if (input.expectedCurrentVersionId !== null && (typeof input.expectedCurrentVersionId !== "string" || input.expectedCurrentVersionId.length === 0)) {
    throw new ArtifactServiceError("VALIDATION_ERROR", "expectedCurrentVersionId must be a string or null");
  }
  if (!Number.isInteger(input.expectedCurrentRevision) || input.expectedCurrentRevision < 0) {
    throw new ArtifactServiceError("VALIDATION_ERROR", "expectedCurrentRevision must be a non-negative integer");
  }
  if (input.contentType !== "application/json") throw new ArtifactServiceError("VALIDATION_ERROR", "contentType must be application/json");
  if (typeof input.content !== "string" && !(input.content instanceof Uint8Array)) throw new ArtifactServiceError("VALIDATION_ERROR", "content must be JSON text or bytes");
  if (input.metadata !== undefined && (typeof input.metadata !== "object" || input.metadata === null || Array.isArray(input.metadata))) {
    throw new ArtifactServiceError("VALIDATION_ERROR", "metadata must be an object");
  }
}

async function resolveWriter(tx: TxClient, caller: ApprovalKernelCaller): Promise<string> {
  const rows = await tx.userCompanyRole.findMany({
    where: { userId: caller.userId, companyId: caller.scope.companyId },
    select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
  });
  const resolved = resolveActiveCompanyRole(rows as PersistedCompanyRoleAssignment[], new Date());
  if (!resolved.ok) throw new ArtifactServiceError("FORBIDDEN", `caller has no single active company role (${resolved.reason})`);
  return resolved.assignment.id;
}

async function createWithClient(tx: TxClient, input: ArtifactVersionWriter, caller: ApprovalKernelCaller): Promise<CreatedArtifactVersion> {
  validateInput(input);
  const writerAssignmentId = await resolveWriter(tx, caller);
  const artifact = await tx.artifact.findUnique({
    where: { id: input.artifactId },
    select: { id: true, tenantId: true, companyId: true, projectId: true, currentVersionId: true, currentRevision: true },
  });
  if (!artifact || artifact.tenantId !== caller.scope.tenantId || artifact.companyId !== caller.scope.companyId || artifact.projectId !== caller.scope.projectId) {
    throw new ArtifactServiceError("NOT_FOUND", "artifact not found");
  }
  if (artifact.currentVersionId !== input.expectedCurrentVersionId || artifact.currentRevision !== input.expectedCurrentRevision) {
    throw new ArtifactServiceError("STALE_CURRENT", "artifact current pointer or revision has changed");
  }
  if (artifact.currentVersionId === null && artifact.currentRevision !== 0) {
    throw new ArtifactServiceError("STALE_CURRENT", "artifact has an invalid inactive pointer state");
  }

  let canonical;
  try {
    canonical = parseCanonicalArtifactContent(input.content);
  } catch (error) {
    throw new ArtifactServiceError("VALIDATION_ERROR", error instanceof Error ? error.message : "invalid canonical artifact content");
  }

  if (artifact.currentVersionId !== null) {
    const current = await tx.artifactVersion.findUnique({
      where: { id: artifact.currentVersionId },
      select: { id: true, artifactId: true, version: true, contentHash: true },
    });
    if (!current || current.artifactId !== artifact.id) throw new ArtifactServiceError("STALE_CURRENT", "artifact current pointer is not a valid version");
    if (current.contentHash === canonical.contentHash) {
      return { artifactId: artifact.id, versionId: current.id, version: current.version, revision: artifact.currentRevision, contentHash: current.contentHash, idempotent: true };
    }
  }

  let version;
  try {
    version = await tx.artifactVersion.create({
      data: {
        artifactId: artifact.id,
        version: artifact.currentRevision + 1,
        contentHashVersion: canonical.contentHashVersion,
        canonicalContentEnvelope: canonical.canonicalContentEnvelope,
        contentHash: canonical.contentHash,
        contentJson: canonical.contentJson as Prisma.InputJsonValue,
        status: "human_draft",
        createdByAssignmentId: writerAssignmentId,
      },
      select: { id: true, artifactId: true, version: true, contentHash: true },
    });
  } catch (error) {
    // The unique (artifactId, version) race is the physical manifestation of another writer
    // having won this expected pointer. Never retry/rebase the caller's edit.
    if (isUniqueViolation(error)) throw new ArtifactServiceError("STALE_CURRENT", "artifact current pointer changed concurrently");
    throw error;
  }

  const cas = await tx.artifact.updateMany({
    where: { id: artifact.id, currentVersionId: input.expectedCurrentVersionId, currentRevision: input.expectedCurrentRevision },
    data: { currentVersionId: version.id, currentRevision: artifact.currentRevision + 1 },
  });
  if (cas.count !== 1) throw new ArtifactServiceError("STALE_CURRENT", "artifact current pointer changed concurrently");

  // The audit append deliberately remains in this caller-owned transaction. An audit failure
  // therefore rolls back both the immutable insert and the CAS pointer advance.
  await appendAuditEvent(tx, {
    scope: { tenantId: caller.scope.tenantId, companyId: caller.scope.companyId, projectId: caller.scope.projectId, level: "PROJECT" },
    eventType: "artifact.version.created",
    actorId: caller.userId,
    resourceType: "artifact_version",
    resourceId: version.id,
    details: { artifactId: artifact.id, version: version.version, currentRevision: artifact.currentRevision + 1, contentHash: version.contentHash, metadata: input.metadata ?? null },
  });

  return { artifactId: artifact.id, versionId: version.id, version: version.version, revision: artifact.currentRevision + 1, contentHash: version.contentHash, idempotent: false };
}

/** Creates one immutable canonical version and advances U017's current pointer with one exact CAS.
 * A supplied transaction is always reused; otherwise this standalone entrypoint opens one. */
export async function createArtifactVersion(input: ArtifactVersionWriter, caller: ApprovalKernelCaller, tx?: TxClient): Promise<CreatedArtifactVersion> {
  if (tx) return createWithClient(tx, input, caller);
  return prisma.$transaction((client) => createWithClient(client, input, caller));
}
