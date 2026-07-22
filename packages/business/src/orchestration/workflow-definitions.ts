import { Prisma, prisma } from "@sangfor/db";
import { resolveActiveCompanyRole, type PersistedCompanyRoleAssignment } from "@sangfor/auth";

import { evaluateArtifactRelease } from "../governance/artifact-release";
import { appendAuditEvent } from "../governance/audit-db";
import type { ApprovalKernelCaller } from "../governance/approval-kernel";
import { WORKFLOW_DEFINITION_HASH_VERSION, WorkflowRuntimeError, assertWorkflowDefinitionEnvelope } from "./workflow-contracts";

type TxClient = Prisma.TransactionClient;

export interface CreateWorkflowDefinitionInput {
  readonly workflowKey: string;
  readonly name: string;
  readonly definitionArtifactVersionId: string;
}

export interface ActivateWorkflowDefinitionInput {
  readonly workflowDefinitionId: string;
  readonly expectedRevision: number;
  readonly approvalId: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function assertScope(row: { tenantId: string; companyId: string; projectId: string }, caller: ApprovalKernelCaller): void {
  if (row.tenantId !== caller.scope.tenantId || row.companyId !== caller.scope.companyId || row.projectId !== caller.scope.projectId) {
    throw new WorkflowRuntimeError("NOT_FOUND", "workflow definition not found");
  }
}

async function resolveAssignmentId(tx: TxClient, caller: ApprovalKernelCaller): Promise<string> {
  const rows = await tx.userCompanyRole.findMany({
    where: { userId: caller.userId, companyId: caller.scope.companyId },
    select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
  });
  const resolved = resolveActiveCompanyRole(rows as PersistedCompanyRoleAssignment[], new Date());
  if (!resolved.ok) throw new WorkflowRuntimeError("FOREIGN_SCOPE", `caller has no single active company role (${resolved.reason})`);
  return resolved.assignment.id;
}

function validateCreate(input: CreateWorkflowDefinitionInput): void {
  if (typeof input.workflowKey !== "string" || !input.workflowKey.trim()) throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflowKey is required");
  if (typeof input.name !== "string" || !input.name.trim()) throw new WorkflowRuntimeError("VALIDATION_ERROR", "name is required");
  if (typeof input.definitionArtifactVersionId !== "string" || !input.definitionArtifactVersionId) {
    throw new WorkflowRuntimeError("VALIDATION_ERROR", "definitionArtifactVersionId is required");
  }
}

async function createWithClient(tx: TxClient, input: CreateWorkflowDefinitionInput, caller: ApprovalKernelCaller) {
  validateCreate(input);
  const [assignmentId, artifactVersion, latest] = await Promise.all([
    resolveAssignmentId(tx, caller),
    tx.artifactVersion.findUnique({
      where: { id: input.definitionArtifactVersionId },
      include: { artifact: { select: { tenantId: true, companyId: true, projectId: true, artifactType: true } } },
    }),
    tx.workflowDefinition.findFirst({
      where: { projectId: caller.scope.projectId, workflowKey: input.workflowKey },
      orderBy: { version: "desc" },
      select: { version: true },
    }),
  ]);

  if (!artifactVersion || artifactVersion.artifact.tenantId !== caller.scope.tenantId || artifactVersion.artifact.companyId !== caller.scope.companyId || artifactVersion.artifact.projectId !== caller.scope.projectId) {
    throw new WorkflowRuntimeError("NOT_FOUND", "workflow definition ArtifactVersion not found");
  }
  if (artifactVersion.artifact.artifactType !== "workflow-definition") {
    throw new WorkflowRuntimeError("VALIDATION_ERROR", "definitionArtifactVersionId must reference a workflow-definition ArtifactVersion");
  }
  assertWorkflowDefinitionEnvelope(artifactVersion);

  try {
    const created = await tx.workflowDefinition.create({
      data: {
        tenantId: caller.scope.tenantId,
        companyId: caller.scope.companyId,
        projectId: caller.scope.projectId,
        workflowKey: input.workflowKey.trim(),
        name: input.name.trim(),
        version: (latest?.version ?? 0) + 1,
        revision: 0,
        status: "draft",
        definitionArtifactVersionId: artifactVersion.id,
        definitionHashVersion: WORKFLOW_DEFINITION_HASH_VERSION,
        definitionHash: artifactVersion.contentHash,
        definitionJson: artifactVersion.contentJson as Prisma.InputJsonValue,
        createdByAssignmentId: assignmentId,
      },
    });
    await appendAuditEvent(tx, {
      scope: { ...caller.scope, level: "PROJECT" },
      eventType: "workflow.definition.created",
      actorId: caller.userId,
      resourceType: "workflow_definition",
      resourceId: created.id,
      details: { workflowKey: created.workflowKey, version: created.version, definitionArtifactVersionId: created.definitionArtifactVersionId },
      idempotencyKey: `workflow-definition:create:${created.id}`,
    });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new WorkflowRuntimeError("STALE_REVISION", "workflow definition version changed concurrently");
    throw error;
  }
}

/** Creates a draft that snapshots the existing U023 ArtifactVersion. It never writes artifact content. */
export async function createWorkflowDefinition(input: CreateWorkflowDefinitionInput, caller: ApprovalKernelCaller, tx?: TxClient) {
  if (tx) return createWithClient(tx, input, caller);
  return prisma.$transaction((client) => createWithClient(client, input, caller));
}

function activationSnapshot(request: {
  id: string;
  revision: number;
  artifactVersionId: string | null;
  artifactHashSnapshot: string | null;
  policyHash: string | null;
  currentValidity: { state: string; requestRevision: number; evaluatedAt: Date | null; artifactVersionId: string; artifactHashSnapshot: string; policyHashSnapshot: string } | null;
}) {
  const validity = request.currentValidity;
  if (
    !validity || validity.state !== "valid" || validity.requestRevision !== request.revision || !validity.evaluatedAt ||
    !request.artifactVersionId || !request.artifactHashSnapshot || !request.policyHash ||
    validity.artifactVersionId !== request.artifactVersionId || validity.artifactHashSnapshot !== request.artifactHashSnapshot || validity.policyHashSnapshot !== request.policyHash
  ) {
    throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "activation approval is not currently valid at its exact revision");
  }
  return {
    activationApprovalRequestId: request.id,
    activationApprovalRequestRevision: request.revision,
    activationApprovalArtifactVersionId: request.artifactVersionId,
    activationApprovalArtifactHash: request.artifactHashSnapshot,
    activationApprovalPolicyHash: request.policyHash,
    activationApprovedAt: validity.evaluatedAt,
  };
}

async function activateWithClient(tx: TxClient, input: ActivateWorkflowDefinitionInput, caller: ApprovalKernelCaller) {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new WorkflowRuntimeError("VALIDATION_ERROR", "expectedRevision must be a non-negative integer");
  if (typeof input.approvalId !== "string" || !input.approvalId) throw new WorkflowRuntimeError("VALIDATION_ERROR", "approvalId is required");
  const definition = await tx.workflowDefinition.findUnique({ where: { id: input.workflowDefinitionId } });
  if (!definition) throw new WorkflowRuntimeError("NOT_FOUND", "workflow definition not found");
  assertScope(definition, caller);
  if (definition.status !== "draft") throw new WorkflowRuntimeError("TERMINAL_STATE", "only a draft workflow definition can be activated");
  if (definition.revision !== input.expectedRevision) throw new WorkflowRuntimeError("STALE_REVISION", "workflow definition revision is stale");

  const active = await tx.workflowDefinition.findFirst({ where: { projectId: definition.projectId, workflowKey: definition.workflowKey, status: "active" }, select: { id: true } });
  if (active && active.id !== definition.id) throw new WorkflowRuntimeError("ACTIVE_DEFINITION_EXISTS", "an active definition already exists for this scope and workflow key");

  let evaluation;
  try {
    evaluation = await evaluateArtifactRelease({ action: "workflow.activate", artifactVersionId: definition.definitionArtifactVersionId, approvalId: input.approvalId }, caller, tx);
  } catch {
    // An opaque/missing approval is not distinguished from an invalid approval at this governed
    // activation boundary; neither may grant activation authority.
    throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "activation approval is not currently releasable");
  }
  if (!evaluation.releasable) throw new WorkflowRuntimeError("APPROVAL_REQUIRED", `activation approval is not releasable (${evaluation.reasonCode})`);
  const approval = await tx.approvalRequest.findUnique({
    where: { id: input.approvalId },
    include: { currentValidity: { select: { state: true, requestRevision: true, evaluatedAt: true, artifactVersionId: true, artifactHashSnapshot: true, policyHashSnapshot: true } } },
  });
  if (!approval) throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "activation approval not found");
  const snapshot = activationSnapshot(approval);
  const updated = await tx.workflowDefinition.updateMany({
    where: { id: definition.id, revision: input.expectedRevision, status: "draft" },
    data: { status: "active", revision: { increment: 1 }, ...snapshot },
  });
  if (updated.count !== 1) throw new WorkflowRuntimeError("STALE_REVISION", "workflow definition changed concurrently");
  const result = await tx.workflowDefinition.findUniqueOrThrow({ where: { id: definition.id } });
  await appendAuditEvent(tx, {
    scope: { ...caller.scope, level: "PROJECT" },
    eventType: "workflow.definition.activated",
    actorId: caller.userId,
    resourceType: "workflow_definition",
    resourceId: definition.id,
    details: { expectedRevision: input.expectedRevision, approvalId: input.approvalId, definitionArtifactVersionId: definition.definitionArtifactVersionId },
    idempotencyKey: `workflow-definition:activate:${definition.id}:${result.revision}`,
  });
  return result;
}

/** Re-evaluates U022/U023 immediately before one exact revision-CAS activation. */
export async function activateWorkflowDefinition(input: ActivateWorkflowDefinitionInput, caller: ApprovalKernelCaller, tx?: TxClient) {
  if (tx) return activateWithClient(tx, input, caller);
  return prisma.$transaction((client) => activateWithClient(client, input, caller));
}

export async function getWorkflowDefinition(workflowDefinitionId: string, caller: ApprovalKernelCaller, tx?: TxClient) {
  const load = async (client: TxClient) => {
    const definition = await client.workflowDefinition.findUnique({ where: { id: workflowDefinitionId } });
    if (!definition) throw new WorkflowRuntimeError("NOT_FOUND", "workflow definition not found");
    assertScope(definition, caller);
    return definition;
  };
  return tx ? load(tx) : prisma.$transaction(load);
}
