import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";

export class ArtifactAccessError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ArtifactAccessError";
    this.code = code;
    this.httpStatus = status;
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

// ─── Artifact Access Event factory ──────────────────────────────────────────

export type ArtifactAccessEventFields = {
  artifactId: string;
  artifactVersionId: string;
  actorAssignmentId: string;
  requestId: string;
  createdAt: Date;
} & (
  | { accessType: "view"; policyResult: "allowed"; watermarkApplied: true; redactionApplied: boolean; denialReason: null; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.view" } }
  | { accessType: "view"; policyResult: "denied"; watermarkApplied: false; redactionApplied: false; denialReason: "artifact_view_permission_denied" | "artifact_view_policy_denied"; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.view" } }
  | { accessType: "copy"; policyResult: "denied"; watermarkApplied: true; redactionApplied: boolean; denialReason: "restricted_copy_blocked_best_effort"; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.copy"; source: "restricted_view" } }
  | { accessType: "export"; policyResult: "allowed"; watermarkApplied: false; redactionApplied: boolean; denialReason: null; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.export.issue"; format: "json" } }
  | { accessType: "export"; policyResult: "denied"; watermarkApplied: false; redactionApplied: false; denialReason: string; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.export.issue"; format: "json" } }
  | { accessType: "download"; policyResult: "allowed"; watermarkApplied: false; redactionApplied: boolean; denialReason: null; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.export.consume"; format: "json" } }
  | { accessType: "download"; policyResult: "denied"; watermarkApplied: false; redactionApplied: false; denialReason: string; requestMetadata: { schemaVersion: "artifact-access-event/v1"; routeAction: "artifact.export.consume"; format: "json" } }
);

export async function createArtifactAccessEvent(
  tx: any,
  fields: ArtifactAccessEventFields,
): Promise<{ id: string }> {
  const event = await tx.artifactAccessEvent.create({
    data: {
      artifactId: fields.artifactId,
      artifactVersionId: fields.artifactVersionId,
      actorAssignmentId: fields.actorAssignmentId,
      accessType: fields.accessType,
      policyResult: fields.policyResult,
      watermarkApplied: fields.watermarkApplied,
      redactionApplied: fields.redactionApplied,
      denialReason: fields.denialReason,
      requestId: fields.requestId,
      requestMetadata: fields.requestMetadata,
      createdAt: fields.createdAt,
    },
  });
  return event;
}

// ─── Export Issuance ─────────────────────────────────────────────────────────

export type IssueDataExportInput = {
  authContext: AuthContext;
  artifactId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  approvalId: string;
  purpose: string;
  idempotencyKey: string;
  requestId: string;
  now: Date;
};

export async function issueDataExport(input: IssueDataExportInput) {
  const {
    authContext, artifactVersionId, artifactContentHash,
    approvalId, purpose, idempotencyKey, requestId, now,
  } = input;

  // Generate capability token: 32 raw bytes → base64url (43 chars) → digest for storage only
  const secretBytes = randomBytes(32);
  if (secretBytes.length !== 32) {
    throw new ArtifactAccessError("CSPRNG_FAILURE", "CSPRNG did not return exactly 32 bytes", 500);
  }
  const encodedSecret = secretBytes.toString("base64url").replace(/=/g, "");
  if (encodedSecret.length !== 43) {
    throw new ArtifactAccessError("CSPRNG_FAILURE", "base64url encoding did not produce 43 chars", 500);
  }
  const capability = `exp1.${encodedSecret}`;
  // Digest input is the raw exactly 32-byte secretBytes buffer
  const tokenDigest = createHash("sha256").update(secretBytes).digest("hex");

  const expiresAt = new Date(now.getTime() + 600 * 1000);
  const scope = rlsScope(authContext);

  const requestInputHash = sha256Hex(canonicalizeRfc8785({
    action: "artifact.export",
    artifactVersionId,
    artifactContentHash,
    approvalId,
    purpose,
    format: "json",
    scope: { tenantId: scope.tenantId, companyId: scope.companyId, projectId: scope.projectId },
  }));

  return withRlsTransaction(scope, async (tx) => {
    const auditLog = await appendAuditEvent(tx, {
      scope,
      eventType: "governance.export.issued",
      actorId: authContext.userId,
      resourceType: "data_export_request",
      resourceId: requestId,
      details: { artifactVersionId, approvalId, requestInputHash, idempotencyKey },
      idempotencyKey,
    });

    // Schema: DataExportRequest uses canonicalStatus (not status), approvalRequestId (not approvalId)
    const exportReq = await tx.dataExportRequest.create({
      data: {
        companyId: scope.companyId,
        artifactVersionId,
        artifactContentHash,
        classification: "restricted",
        format: "json",
        purpose,
        requestedByAssignmentId: authContext.userId,
        approvalRequestId: approvalId,
        canonicalStatus: "issued",
        issuedAt: now,
        expiresAt,
        completedAt: null,
        idempotencyKey,
        requestInputHash,
        auditLogId: auditLog.id,
      },
    });

    // Schema: ExportCapability uses exportRequestId (not exportId), requesterAssignmentId (not actorAssignmentId)
    const exportCapability = await tx.exportCapability.create({
      data: {
        exportRequestId: exportReq.id,
        tokenDigest,
        artifactVersionId,
        artifactContentHash,
        requesterAssignmentId: authContext.userId,
        expiresAt,
      },
    });

    await createArtifactAccessEvent(tx, {
      artifactId: input.artifactId,
      artifactVersionId,
      actorAssignmentId: authContext.userId,
      requestId,
      createdAt: now,
      accessType: "export",
      policyResult: "allowed",
      watermarkApplied: false,
      redactionApplied: false,
      denialReason: null,
      requestMetadata: { schemaVersion: "artifact-access-event/v1", routeAction: "artifact.export.issue", format: "json" },
    });

    return {
      exportId: exportReq.id,
      capabilityId: exportCapability.id,
      status: "issued",
      expiresAt,
      capability, // raw capability returned only once — never persisted
    };
  });
}

// ─── Export Consumption ───────────────────────────────────────────────────────

export type ConsumeDataExportInput = {
  authContext: AuthContext;
  exportId: string;
  capabilityHeader: string; // "exp1.<43chars>"
  requestId: string;
  now: Date;
};

export async function consumeDataExport(input: ConsumeDataExportInput) {
  const { authContext, exportId, capabilityHeader, requestId, now } = input;

  // Parse capability: exp1. + 43 base64url chars
  const PREFIX = "exp1.";
  if (!capabilityHeader.startsWith(PREFIX) || capabilityHeader.length !== PREFIX.length + 43) {
    throw new ArtifactAccessError("EXPORT_CAPABILITY_INVALID", "Malformed capability", 401);
  }
  const encodedPart = capabilityHeader.slice(PREFIX.length);
  const decodedBytes = Buffer.from(encodedPart, "base64url");
  if (decodedBytes.length !== 32) {
    throw new ArtifactAccessError("EXPORT_CAPABILITY_INVALID", "Capability decoded to wrong length", 401);
  }
  // Re-encode to confirm canonical form
  const reEncoded = decodedBytes.toString("base64url").replace(/=/g, "");
  if (reEncoded !== encodedPart) {
    throw new ArtifactAccessError("EXPORT_CAPABILITY_INVALID", "Non-canonical base64url", 401);
  }
  const presentedDigest = createHash("sha256").update(decodedBytes).digest("hex");

  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const exportReq = await tx.dataExportRequest.findUnique({ where: { id: exportId } });
    if (!exportReq || exportReq.companyId !== scope.companyId) {
      await appendAuditEvent(tx, {
        scope, eventType: "governance.target_not_visible", actorId: authContext.userId,
        resourceType: "governance_denial", resourceId: requestId,
        details: { denialCode: "target_not_visible", routeAction: "artifact.export.consume" }, idempotencyKey: requestId,
      });
      throw new ArtifactAccessError("EXPORT_NOT_FOUND", "Export not found", 404);
    }

    // canonicalStatus (not status), expiresAt can be null
    const expiresAt = exportReq.expiresAt;
    if (exportReq.canonicalStatus !== "issued" || !expiresAt || now >= expiresAt) {
      throw new ArtifactAccessError("EXPORT_CAPABILITY_EXPIRED", "Export expired or not in issued state", 410);
    }

    // exportRequestId (not exportId) in ExportCapability
    const cap = await tx.exportCapability.findFirst({ where: { exportRequestId: exportId } });
    if (!cap) throw new ArtifactAccessError("EXPORT_CAPABILITY_MISSING", "Capability missing", 401);
    if (cap.consumedAt) throw new ArtifactAccessError("EXPORT_CAPABILITY_CONSUMED", "Already consumed", 410);
    if (cap.revokedAt) throw new ArtifactAccessError("EXPORT_CAPABILITY_REVOKED", "Capability revoked", 401);

    const storedDigestBuf = Buffer.from(cap.tokenDigest, "hex");
    const presentedDigestBuf = Buffer.from(presentedDigest, "hex");
    if (storedDigestBuf.length !== presentedDigestBuf.length || !timingSafeEqual(storedDigestBuf, presentedDigestBuf)) {
      throw new ArtifactAccessError("EXPORT_CAPABILITY_INVALID", "Capability mismatch", 401);
    }

    // CAS: mark consumed
    await tx.dataExportRequest.update({ where: { id: exportId }, data: { canonicalStatus: "consumed", completedAt: now } });
    await tx.exportCapability.update({ where: { id: cap.id }, data: { consumedAt: now } });

    await appendAuditEvent(tx, {
      scope, eventType: "governance.export.consumed", actorId: authContext.userId,
      resourceType: "data_export_request", resourceId: exportId,
      details: { artifactVersionId: exportReq.artifactVersionId ?? "", requestId }, idempotencyKey: requestId,
    });

    const artifactVersionId = exportReq.artifactVersionId ?? "";
    const artifactId = (exportReq as any).legacyArtifactId ?? "";

    await createArtifactAccessEvent(tx, {
      artifactId,
      artifactVersionId,
      actorAssignmentId: authContext.userId,
      requestId,
      createdAt: now,
      accessType: "download",
      policyResult: "allowed",
      watermarkApplied: false,
      redactionApplied: false,
      denialReason: null,
      requestMetadata: { schemaVersion: "artifact-access-event/v1", routeAction: "artifact.export.consume", format: "json" },
    });

    return { exportId, status: "consumed", artifactVersionId };
  });
}
