import { Prisma, prisma } from "@sangfor/db";
import { hasCapability, resolveActiveCompanyRole, type PersistedCompanyRoleAssignment } from "@sangfor/auth";

import type { ApprovalKernelCaller } from "./approval-kernel";

type TxClient = Prisma.TransactionClient;

export interface ArtifactReleaseEvaluationInput {
  readonly action: string;
  readonly artifactVersionId: string;
  readonly approvalId: string;
}

export type ArtifactReleaseReasonCode =
  | "RELEASABLE"
  | "STALE_ARTIFACT_VERSION"
  | "ACTION_MISMATCH"
  | "APPROVAL_VERSION_MISMATCH"
  | "HASH_MISMATCH"
  | "POLICY_MISMATCH"
  | "APPROVAL_NOT_APPROVED"
  | "VALIDITY_NOT_VALID"
  | "QUORUM_NOT_SATISFIED"
  | "APPROVAL_EXPIRED"
  | "PERMISSION_DENIED";

export interface ArtifactReleaseEvaluation {
  readonly releasable: boolean;
  readonly reasonCode: ArtifactReleaseReasonCode;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly approvalId: string;
  readonly revision: number;
}

export type ArtifactReleaseErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "BRIDGE_INTEGRITY";
const HTTP_STATUS: Record<ArtifactReleaseErrorCode, number> = { VALIDATION_ERROR: 422, NOT_FOUND: 404, FORBIDDEN: 403, BRIDGE_INTEGRITY: 409 };

export class ArtifactReleaseError extends Error {
  readonly code: ArtifactReleaseErrorCode;
  readonly httpStatus: number;

  constructor(code: ArtifactReleaseErrorCode, message: string) {
    super(message);
    this.name = "ArtifactReleaseError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

function validateEvaluationInput(input: ArtifactReleaseEvaluationInput): void {
  if (typeof input.action !== "string" || input.action.trim().length === 0) throw new ArtifactReleaseError("VALIDATION_ERROR", "action is required");
  if (typeof input.artifactVersionId !== "string" || input.artifactVersionId.length === 0) throw new ArtifactReleaseError("VALIDATION_ERROR", "artifactVersionId is required");
  if (typeof input.approvalId !== "string" || input.approvalId.length === 0) throw new ArtifactReleaseError("VALIDATION_ERROR", "approvalId is required");
}

async function canEvaluate(tx: TxClient, caller: ApprovalKernelCaller): Promise<boolean> {
  const rows = await tx.userCompanyRole.findMany({
    where: { userId: caller.userId, companyId: caller.scope.companyId },
    select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
  });
  const role = resolveActiveCompanyRole(rows as PersistedCompanyRoleAssignment[], new Date());
  return role.ok && hasCapability(role.role, "role.manage");
}

async function evaluateWithClient(tx: TxClient, input: ArtifactReleaseEvaluationInput, caller: ApprovalKernelCaller): Promise<ArtifactReleaseEvaluation> {
  validateEvaluationInput(input);
  const version = await tx.artifactVersion.findUnique({
    where: { id: input.artifactVersionId },
    include: { artifact: { select: { id: true, tenantId: true, companyId: true, projectId: true, currentVersionId: true, currentRevision: true } } },
  });
  if (!version || version.artifact.tenantId !== caller.scope.tenantId || version.artifact.companyId !== caller.scope.companyId || version.artifact.projectId !== caller.scope.projectId) {
    throw new ArtifactReleaseError("NOT_FOUND", "artifact version not found");
  }
  const base = { artifactId: version.artifact.id, artifactVersionId: version.id, approvalId: input.approvalId, revision: version.artifact.currentRevision };
  if (!(await canEvaluate(tx, caller))) return { releasable: false, reasonCode: "PERMISSION_DENIED", ...base };
  if (version.artifact.currentVersionId !== version.id) return { releasable: false, reasonCode: "STALE_ARTIFACT_VERSION", ...base };

  const approval = await tx.approvalRequest.findUnique({
    where: { id: input.approvalId },
    include: { currentValidity: true },
  });
  if (
    !approval || approval.legacyUnbound || approval.tenantId !== caller.scope.tenantId || approval.companyId !== caller.scope.companyId || approval.projectId !== caller.scope.projectId
  ) {
    throw new ArtifactReleaseError("NOT_FOUND", "approval request not found");
  }
  if (approval.action !== input.action) return { releasable: false, reasonCode: "ACTION_MISMATCH", ...base };
  if (approval.artifactVersionId !== version.id) return { releasable: false, reasonCode: "APPROVAL_VERSION_MISMATCH", ...base };
  if (approval.artifactHashSnapshot !== version.contentHash) return { releasable: false, reasonCode: "HASH_MISMATCH", ...base };
  if (approval.status !== "approved") return { releasable: false, reasonCode: "APPROVAL_NOT_APPROVED", ...base };
  if (!approval.currentValidity || approval.currentValidity.state !== "valid") return { releasable: false, reasonCode: "VALIDITY_NOT_VALID", ...base };
  const validity = approval.currentValidity;
  if (validity.artifactVersionId !== version.id || validity.artifactHashSnapshot !== version.contentHash) return { releasable: false, reasonCode: "HASH_MISMATCH", ...base };
  if (validity.policyHashSnapshot !== approval.policyHash) return { releasable: false, reasonCode: "POLICY_MISMATCH", ...base };
  if (validity.requiredQuorum !== approval.requiredQuorum || validity.satisfiedQuorum < validity.requiredQuorum) return { releasable: false, reasonCode: "QUORUM_NOT_SATISFIED", ...base };
  const now = new Date();
  if ((approval.expiresAt && approval.expiresAt <= now) || (validity.validUntil && validity.validUntil <= now)) return { releasable: false, reasonCode: "APPROVAL_EXPIRED", ...base };
  return { releasable: true, reasonCode: "RELEASABLE", ...base };
}

/** Read-only evaluator: it returns an eligibility decision and never sends, shares, queues, or
 * mutates a release. A caller-owned transaction can be supplied for a consistent governed read. */
export async function evaluateArtifactRelease(input: ArtifactReleaseEvaluationInput, caller: ApprovalKernelCaller, tx?: TxClient): Promise<ArtifactReleaseEvaluation> {
  if (tx) return evaluateWithClient(tx, input, caller);
  return prisma.$transaction((client) => evaluateWithClient(client, input, caller));
}

export type LegacyArtifactSourceType = "GeneratedDocument" | "DocumentVersion";
export type LegacyArtifactCompatibility =
  | { readonly kind: "mapped"; readonly legacySourceType: LegacyArtifactSourceType; readonly legacySourceId: string; readonly artifactId: string; readonly artifactVersionId: string | null }
  | { readonly kind: "quarantined"; readonly legacySourceType: LegacyArtifactSourceType; readonly legacySourceId: string; readonly reasonCode: string; readonly artifactId: null; readonly artifactVersionId: null };

export interface LegacyArtifactCompatibilityInput {
  readonly legacySourceType: LegacyArtifactSourceType;
  readonly legacySourceId: string;
}

async function resolveLegacyWithClient(tx: TxClient, input: LegacyArtifactCompatibilityInput, caller: ApprovalKernelCaller): Promise<LegacyArtifactCompatibility> {
  if ((input.legacySourceType !== "GeneratedDocument" && input.legacySourceType !== "DocumentVersion") || typeof input.legacySourceId !== "string" || input.legacySourceId.length === 0) {
    throw new ArtifactReleaseError("VALIDATION_ERROR", "legacy source type and id are required");
  }
  const quarantine = await tx.scopeBackfillQuarantine.findUnique({ where: { sourceModel_sourceId: { sourceModel: input.legacySourceType, sourceId: input.legacySourceId } }, select: { reasonCode: true } });
  if (input.legacySourceType === "GeneratedDocument") {
    const artifact = await tx.artifact.findUnique({ where: { legacySourceType_legacySourceId: { legacySourceType: "GeneratedDocument", legacySourceId: input.legacySourceId } }, select: { id: true, tenantId: true, companyId: true, projectId: true, legacySourceType: true, legacySourceId: true } });
    if (artifact && quarantine) throw new ArtifactReleaseError("BRIDGE_INTEGRITY", "legacy source is both mapped and quarantined");
    if (artifact) {
      if (artifact.tenantId !== caller.scope.tenantId || artifact.companyId !== caller.scope.companyId || artifact.projectId !== caller.scope.projectId) throw new ArtifactReleaseError("NOT_FOUND", "legacy artifact not found");
      if (artifact.legacySourceType !== "GeneratedDocument" || artifact.legacySourceId !== input.legacySourceId) throw new ArtifactReleaseError("BRIDGE_INTEGRITY", "artifact bridge bytes do not match source");
      return { kind: "mapped", legacySourceType: input.legacySourceType, legacySourceId: input.legacySourceId, artifactId: artifact.id, artifactVersionId: null };
    }
  } else {
    const version = await tx.artifactVersion.findUnique({ where: { legacySourceType_legacySourceId: { legacySourceType: "DocumentVersion", legacySourceId: input.legacySourceId } }, include: { artifact: { select: { id: true, tenantId: true, companyId: true, projectId: true, legacySourceType: true, legacySourceId: true } } } });
    if (version && quarantine) throw new ArtifactReleaseError("BRIDGE_INTEGRITY", "legacy source is both mapped and quarantined");
    if (version) {
      if (version.artifact.tenantId !== caller.scope.tenantId || version.artifact.companyId !== caller.scope.companyId || version.artifact.projectId !== caller.scope.projectId) throw new ArtifactReleaseError("NOT_FOUND", "legacy artifact version not found");
      if (version.legacySourceType !== "DocumentVersion" || version.legacySourceId !== input.legacySourceId || version.artifact.legacySourceType !== "GeneratedDocument" || version.artifact.legacySourceId === null) {
        throw new ArtifactReleaseError("BRIDGE_INTEGRITY", "legacy version is not mapped beneath its canonical artifact");
      }
      return { kind: "mapped", legacySourceType: input.legacySourceType, legacySourceId: input.legacySourceId, artifactId: version.artifact.id, artifactVersionId: version.id };
    }
  }
  if (quarantine) return { kind: "quarantined", legacySourceType: input.legacySourceType, legacySourceId: input.legacySourceId, reasonCode: quarantine.reasonCode, artifactId: null, artifactVersionId: null };
  throw new ArtifactReleaseError("BRIDGE_INTEGRITY", "legacy source has neither a persisted mapping nor quarantine row");
}

/** Compatibility read only. It queries U020-persisted bridge keys; it never derives an ID. */
export async function resolveLegacyArtifactCompatibility(input: LegacyArtifactCompatibilityInput, caller: ApprovalKernelCaller, tx?: TxClient): Promise<LegacyArtifactCompatibility> {
  if (tx) return resolveLegacyWithClient(tx, input, caller);
  return prisma.$transaction((client) => resolveLegacyWithClient(client, input, caller));
}
