import { Prisma, prisma } from "@sangfor/db";
import { resolveActiveCompanyRole, hasCapability, type PersistedCompanyRoleAssignment, type BusinessPermission } from "@sangfor/auth";
import {
  createArtifactVersion,
  evaluateArtifactRelease,
  appendAuditEvent,
  type ApprovalKernelCaller,
} from "../governance";
import {
  evaluateSizingRule,
  evaluateCompatibilityRule,
  validateRulePayload,
  type SizingRulePayload,
  type CompatibilityRulePayload,
  type SizingEvaluationResult,
  type CompatibilityEvaluationResult,
  RuleEngineError,
} from "./rule-engine";

type TxClient = Prisma.TransactionClient;

export type CatalogRuleErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "STALE_REVISION"
  | "APPROVAL_INVALID"
  | "CORRUPT_ACTIVE";

const HTTP_STATUS: Record<CatalogRuleErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  STALE_REVISION: 409,
  APPROVAL_INVALID: 409,
  CORRUPT_ACTIVE: 409,
};

export class CatalogRuleServiceError extends Error {
  readonly code: CatalogRuleErrorCode;
  readonly httpStatus: number;

  constructor(code: CatalogRuleErrorCode, message: string) {
    super(message);
    this.name = "CatalogRuleServiceError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export async function assertCatalogPermission(
  caller: ApprovalKernelCaller,
  requiredCapability: "catalog.read" | "catalog.write",
  tx: TxClient = prisma
): Promise<void> {
  const roles = await tx.userCompanyRole.findMany({
    where: {
      userId: caller.userId,
      companyId: caller.scope.companyId,
    },
    select: {
      id: true,
      userId: true,
      companyId: true,
      role: true,
      status: true,
      validFrom: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  const active = resolveActiveCompanyRole(roles as PersistedCompanyRoleAssignment[], new Date());
  if (!active.ok || !hasCapability(active.role, requiredCapability as BusinessPermission)) {
    throw new CatalogRuleServiceError("FORBIDDEN", `Permission denied: required capability '${requiredCapability}'`);
  }
}

export interface PublishRuleInput {
  artifactVersionId: string;
  approvalId: string;
  expectedActiveArtifactVersionId: string | null;
}

export async function publishSizingTemplate(
  caller: ApprovalKernelCaller,
  templateId: string,
  input: PublishRuleInput,
  tx?: TxClient
): Promise<{ templateId: string; activeArtifactVersionId: string; revision: number }> {
  // Reject any caller-supplied action override
  if ("action" in input && (input as any).action !== undefined) {
    throw new CatalogRuleServiceError("VALIDATION_ERROR", "Action override is not permitted; action is server-managed");
  }

  const runPublish = async (client: TxClient) => {
    await assertCatalogPermission(caller, "catalog.write", client);

    const template = await client.sizingTemplate.findUnique({
      where: { id: templateId },
      include: { activeArtifactVersion: true, artifact: true },
    });

    if (!template) {
      throw new CatalogRuleServiceError("NOT_FOUND", `SizingTemplate '${templateId}' not found`);
    }

    if (template.activeArtifactVersionId !== input.expectedActiveArtifactVersionId) {
      throw new CatalogRuleServiceError("STALE_REVISION", "activeArtifactVersionId CAS mismatch");
    }

    // Evaluate release with server-injected action "catalog.sizing.publish"
    const releaseEval = await evaluateArtifactRelease(
      {
        action: "catalog.sizing.publish",
        artifactVersionId: input.artifactVersionId,
        approvalId: input.approvalId,
      },
      caller,
      client
    );

    if (!releaseEval.releasable) {
      throw new CatalogRuleServiceError(
        "APPROVAL_INVALID",
        `Artifact release evaluation failed with reason: ${releaseEval.reasonCode}`
      );
    }

    // Atomic CAS update
    const updated = await client.sizingTemplate.updateMany({
      where: {
        id: templateId,
        activeArtifactVersionId: input.expectedActiveArtifactVersionId,
      },
      data: {
        activeArtifactVersionId: input.artifactVersionId,
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new CatalogRuleServiceError("STALE_REVISION", "Concurrent update detected; activeArtifactVersionId CAS failed");
    }

    // Audit event in same transaction
    await appendAuditEvent(client, {
      scope: { tenantId: caller.scope.tenantId, companyId: caller.scope.companyId, projectId: null, level: "COMPANY" },
      eventType: "catalog.sizing.publish",
      actorId: caller.userId,
      resourceType: "SizingTemplate",
      resourceId: templateId,
      details: {
        previousActiveVersionId: input.expectedActiveArtifactVersionId,
        newActiveVersionId: input.artifactVersionId,
        approvalId: input.approvalId,
      },
    });

    return {
      templateId,
      activeArtifactVersionId: input.artifactVersionId,
      revision: releaseEval.revision,
    };
  };

  if (tx) return runPublish(tx);
  return prisma.$transaction((client) => runPublish(client));
}

export async function publishCompatibilityRule(
  caller: ApprovalKernelCaller,
  ruleId: string,
  input: PublishRuleInput,
  tx?: TxClient
): Promise<{ ruleId: string; activeArtifactVersionId: string; revision: number }> {
  if ("action" in input && (input as any).action !== undefined) {
    throw new CatalogRuleServiceError("VALIDATION_ERROR", "Action override is not permitted; action is server-managed");
  }

  const runPublish = async (client: TxClient) => {
    await assertCatalogPermission(caller, "catalog.write", client);

    const rule = await client.compatibilityRule.findUnique({
      where: { id: ruleId },
      include: { activeArtifactVersion: true, artifact: true },
    });

    if (!rule) {
      throw new CatalogRuleServiceError("NOT_FOUND", `CompatibilityRule '${ruleId}' not found`);
    }

    if (rule.activeArtifactVersionId !== input.expectedActiveArtifactVersionId) {
      throw new CatalogRuleServiceError("STALE_REVISION", "activeArtifactVersionId CAS mismatch");
    }

    // Evaluate release with server-injected action "catalog.compatibility.publish"
    const releaseEval = await evaluateArtifactRelease(
      {
        action: "catalog.compatibility.publish",
        artifactVersionId: input.artifactVersionId,
        approvalId: input.approvalId,
      },
      caller,
      client
    );

    if (!releaseEval.releasable) {
      throw new CatalogRuleServiceError(
        "APPROVAL_INVALID",
        `Artifact release evaluation failed with reason: ${releaseEval.reasonCode}`
      );
    }

    // Atomic CAS update
    const updated = await client.compatibilityRule.updateMany({
      where: {
        id: ruleId,
        activeArtifactVersionId: input.expectedActiveArtifactVersionId,
      },
      data: {
        activeArtifactVersionId: input.artifactVersionId,
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new CatalogRuleServiceError("STALE_REVISION", "Concurrent update detected; activeArtifactVersionId CAS failed");
    }

    await appendAuditEvent(client, {
      scope: { ...caller.scope, level: "COMPANY" },
      eventType: "catalog.compatibility.publish",
      actorId: caller.userId,
      resourceType: "CompatibilityRule",
      resourceId: ruleId,
      details: {
        previousActiveVersionId: input.expectedActiveArtifactVersionId,
        newActiveVersionId: input.artifactVersionId,
        approvalId: input.approvalId,
      },
    });

    return {
      ruleId,
      activeArtifactVersionId: input.artifactVersionId,
      revision: releaseEval.revision,
    };
  };

  if (tx) return runPublish(tx);
  return prisma.$transaction((client) => runPublish(client));
}

export async function evaluateActiveSizingTemplate(
  caller: ApprovalKernelCaller,
  templateId: string,
  inputs: Record<string, unknown>,
  tx: TxClient = prisma
): Promise<SizingEvaluationResult> {
  await assertCatalogPermission(caller, "catalog.read", tx);

  const template = await tx.sizingTemplate.findUnique({
    where: { id: templateId },
    include: { activeArtifactVersion: true },
  });

  if (!template) {
    throw new CatalogRuleServiceError("NOT_FOUND", `SizingTemplate '${templateId}' not found`);
  }

  if (!template.activeArtifactVersionId || !template.activeArtifactVersion) {
    throw new CatalogRuleServiceError("CORRUPT_ACTIVE", `SizingTemplate '${templateId}' has no active ArtifactVersion (no silent fallback permitted)`);
  }

  let payload: SizingRulePayload;
  try {
    const rawContent = template.activeArtifactVersion.contentJson;
    const contentStr = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    payload = JSON.parse(contentStr);
    validateRulePayload(payload);
  } catch (err: any) {
    if (err instanceof RuleEngineError) throw err;
    throw new CatalogRuleServiceError("CORRUPT_ACTIVE", `Active ArtifactVersion payload for SizingTemplate '${templateId}' is corrupt JSON`);
  }

  return evaluateSizingRule(payload, inputs);
}

export async function evaluateActiveCompatibilityRule(
  caller: ApprovalKernelCaller,
  ruleId: string,
  inputs: Record<string, unknown>,
  tx: TxClient = prisma
): Promise<CompatibilityEvaluationResult> {
  await assertCatalogPermission(caller, "catalog.read", tx);

  const rule = await tx.compatibilityRule.findUnique({
    where: { id: ruleId },
    include: { activeArtifactVersion: true },
  });

  if (!rule) {
    throw new CatalogRuleServiceError("NOT_FOUND", `CompatibilityRule '${ruleId}' not found`);
  }

  if (!rule.activeArtifactVersionId || !rule.activeArtifactVersion) {
    throw new CatalogRuleServiceError("CORRUPT_ACTIVE", `CompatibilityRule '${ruleId}' has no active ArtifactVersion (no silent fallback permitted)`);
  }

  let payload: CompatibilityRulePayload;
  try {
    const rawContent = rule.activeArtifactVersion.contentJson;
    const contentStr = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    payload = JSON.parse(contentStr);
    validateRulePayload(payload);
  } catch (err: any) {
    if (err instanceof RuleEngineError) throw err;
    throw new CatalogRuleServiceError("CORRUPT_ACTIVE", `Active ArtifactVersion payload for CompatibilityRule '${ruleId}' is corrupt JSON`);
  }

  return evaluateCompatibilityRule(payload, inputs);
}
