import { Prisma, prisma } from "@sangfor/db";
import { resolveActiveCompanyRole, type PersistedCompanyRoleAssignment } from "@sangfor/auth";

import { evaluateArtifactRelease } from "../governance/artifact-release";
import { appendAuditEvent } from "../governance/audit-db";
import type { ApprovalKernelCaller } from "../governance/approval-kernel";
import {
  WorkflowRuntimeError,
  assertRunTransition,
  assertStepTransition,
  isRunStatus,
  isStepStatus,
  jsonEquals,
  normalizeWorkflowInput,
  requiresRunApproval,
  workflowStepDefinitions,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
} from "./workflow-contracts";

type TxClient = Prisma.TransactionClient;

export interface StartWorkflowRunInput {
  readonly workflowDefinitionId: string;
  readonly idempotencyKey: string;
  readonly input: unknown;
  /** Required only when the immutable definition payload declares runApprovalRequired=true. */
  readonly runApprovalId?: string;
}

export interface TransitionWorkflowRunInput {
  readonly workflowRunId: string;
  readonly expectedRevision: number;
  readonly status: WorkflowRunStatus;
}

export interface TransitionWorkflowStepInput {
  readonly workflowRunStepId: string;
  readonly expectedRevision: number;
  readonly status: WorkflowStepStatus;
  readonly output?: unknown;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function jsonForDb(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const normalized = normalizeWorkflowInput(value);
  return normalized === null ? Prisma.JsonNull : (normalized as Prisma.InputJsonValue);
}

function assertScope(row: { tenantId: string; companyId: string; projectId: string }, caller: ApprovalKernelCaller, type: string): void {
  if (row.tenantId !== caller.scope.tenantId || row.companyId !== caller.scope.companyId || row.projectId !== caller.scope.projectId) {
    throw new WorkflowRuntimeError("NOT_FOUND", `${type} not found`);
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

async function lockRun(tx: TxClient, workflowRunId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workflow-run-event:${workflowRunId}`}, 0))`;
}

async function appendRunEvent(
  tx: TxClient,
  run: { id: string; tenantId: string; companyId: string; projectId: string },
  caller: ApprovalKernelCaller,
  assignmentId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await lockRun(tx, run.id);
  const last = await tx.workflowRunEvent.findFirst({ where: { workflowRunId: run.id }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequence = (last?.sequence ?? 0) + 1;
  await tx.workflowRunEvent.create({
    data: {
      workflowRunId: run.id,
      sequence,
      eventType,
      actorAssignmentId: assignmentId,
      actorSessionId: caller.sessionId,
      payloadJson: jsonForDb(payload),
    },
  });
  await appendAuditEvent(tx, {
    scope: { tenantId: run.tenantId, companyId: run.companyId, projectId: run.projectId, level: "PROJECT" },
    eventType: `workflow.${eventType}`,
    actorId: caller.userId,
    resourceType: "workflow_run",
    resourceId: run.id,
    details: { sequence, payload: normalizeWorkflowInput(payload) },
    idempotencyKey: `workflow-run-event:${run.id}:${sequence}`,
  });
}

function activationSnapshot(definition: {
  activationApprovalRequestId: string | null;
  activationApprovalRequestRevision: number | null;
  activationApprovalArtifactVersionId: string | null;
  activationApprovalArtifactHash: string | null;
  activationApprovalPolicyHash: string | null;
  activationApprovedAt: Date | null;
}) {
  const values = [
    definition.activationApprovalRequestId,
    definition.activationApprovalRequestRevision,
    definition.activationApprovalArtifactVersionId,
    definition.activationApprovalArtifactHash,
    definition.activationApprovalPolicyHash,
    definition.activationApprovedAt,
  ];
  if (values.some((value) => value === null)) throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "active definition has a partial activation approval snapshot");
  return {
    activationApprovalRequestId: definition.activationApprovalRequestId!,
    activationApprovalRequestRevision: definition.activationApprovalRequestRevision!,
    activationApprovalArtifactVersionId: definition.activationApprovalArtifactVersionId!,
    activationApprovalArtifactHash: definition.activationApprovalArtifactHash!,
    activationApprovalPolicyHash: definition.activationApprovalPolicyHash!,
    activationApprovedAt: definition.activationApprovedAt!,
  };
}

async function assertCurrentActivation(tx: TxClient, definition: { definitionArtifactVersionId: string } & ReturnType<typeof activationSnapshot>, caller: ApprovalKernelCaller): Promise<void> {
  let evaluation;
  try {
    evaluation = await evaluateArtifactRelease(
      { action: "workflow.activate", artifactVersionId: definition.definitionArtifactVersionId, approvalId: definition.activationApprovalRequestId },
      caller,
      tx,
    );
  } catch {
    throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "definition activation is not currently releasable");
  }
  if (!evaluation.releasable) throw new WorkflowRuntimeError("APPROVAL_REQUIRED", `definition activation is no longer releasable (${evaluation.reasonCode})`);
}

async function runGateSnapshot(tx: TxClient, definition: { definitionArtifactVersionId: string; definitionJson: Prisma.JsonValue }, runApprovalId: string | undefined, caller: ApprovalKernelCaller) {
  const required = requiresRunApproval(definition.definitionJson);
  if (required && !runApprovalId) throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "this workflow definition requires a current workflow.run approval");
  if (!runApprovalId) {
    return {
      runApprovalRequestId: null,
      runApprovalRequestRevision: null,
      runApprovalArtifactVersionId: null,
      runApprovalArtifactHash: null,
      runApprovalPolicyHash: null,
      runApprovedAt: null,
    };
  }
  let evaluation;
  try {
    evaluation = await evaluateArtifactRelease({ action: "workflow.run", artifactVersionId: definition.definitionArtifactVersionId, approvalId: runApprovalId }, caller, tx);
  } catch {
    throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "run approval is not currently releasable");
  }
  if (!evaluation.releasable) throw new WorkflowRuntimeError("APPROVAL_REQUIRED", `run approval is not releasable (${evaluation.reasonCode})`);
  const request = await tx.approvalRequest.findUnique({ where: { id: runApprovalId }, include: { currentValidity: true } });
  if (!request || !request.currentValidity || request.currentValidity.state !== "valid" || !request.currentValidity.evaluatedAt ||
    !request.artifactVersionId || !request.artifactHashSnapshot || !request.policyHash || request.revision !== request.currentValidity.requestRevision ||
    request.artifactVersionId !== definition.definitionArtifactVersionId || request.currentValidity.artifactVersionId !== request.artifactVersionId ||
    request.currentValidity.artifactHashSnapshot !== request.artifactHashSnapshot || request.currentValidity.policyHashSnapshot !== request.policyHash) {
    throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "run approval is not currently valid at its exact revision");
  }
  return {
    runApprovalRequestId: request.id,
    runApprovalRequestRevision: request.revision,
    runApprovalArtifactVersionId: request.artifactVersionId,
    runApprovalArtifactHash: request.artifactHashSnapshot,
    runApprovalPolicyHash: request.policyHash,
    runApprovedAt: request.currentValidity.evaluatedAt,
  };
}

function assertStartInput(input: StartWorkflowRunInput): void {
  if (typeof input.workflowDefinitionId !== "string" || !input.workflowDefinitionId) throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflowDefinitionId is required");
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim()) throw new WorkflowRuntimeError("VALIDATION_ERROR", "idempotencyKey is required");
  if (input.runApprovalId !== undefined && (typeof input.runApprovalId !== "string" || !input.runApprovalId)) throw new WorkflowRuntimeError("VALIDATION_ERROR", "runApprovalId must be a non-empty string");
}

async function existingRunForIdempotency(tx: TxClient, caller: ApprovalKernelCaller, input: StartWorkflowRunInput, normalizedInput: unknown) {
  const existing = await tx.workflowRun.findUnique({ where: { projectId_idempotencyKey: { projectId: caller.scope.projectId, idempotencyKey: input.idempotencyKey } }, include: { steps: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { sequence: "asc" } } } });
  if (!existing) return null;
  assertScope(existing, caller, "workflow run");
  if (existing.workflowDefinitionId !== input.workflowDefinitionId || !jsonEquals(existing.inputJson, normalizedInput)) {
    throw new WorkflowRuntimeError("IDEMPOTENCY_CONFLICT", "idempotencyKey is already bound to a different workflow definition or input snapshot");
  }
  return existing;
}

async function startWithClient(tx: TxClient, input: StartWorkflowRunInput, caller: ApprovalKernelCaller) {
  assertStartInput(input);
  const normalizedInput = normalizeWorkflowInput(input.input);
  const already = await existingRunForIdempotency(tx, caller, input, normalizedInput);
  if (already) return already;

  const [assignmentId, definition] = await Promise.all([
    resolveAssignmentId(tx, caller),
    tx.workflowDefinition.findUnique({ where: { id: input.workflowDefinitionId } }),
  ]);
  if (!definition) throw new WorkflowRuntimeError("NOT_FOUND", "workflow definition not found");
  assertScope(definition, caller, "workflow definition");
  if (definition.status !== "active") throw new WorkflowRuntimeError("APPROVAL_REQUIRED", "workflow definition is not active");
  const activation = activationSnapshot(definition);
  await assertCurrentActivation(tx, { definitionArtifactVersionId: definition.definitionArtifactVersionId, ...activation }, caller);
  const runApproval = await runGateSnapshot(tx, definition, input.runApprovalId, caller);
  const stepDefinitions = workflowStepDefinitions(definition.definitionJson);

  try {
    const created = await tx.workflowRun.create({
      data: {
        tenantId: caller.scope.tenantId,
        companyId: caller.scope.companyId,
        projectId: caller.scope.projectId,
        workflowDefinitionId: definition.id,
        definitionVersion: definition.version,
        definitionArtifactVersionId: definition.definitionArtifactVersionId,
        definitionArtifactHashVersion: definition.definitionHashVersion,
        definitionArtifactHash: definition.definitionHash,
        ...activation,
        ...runApproval,
        requestedByAssignmentId: assignmentId,
        requestedSessionId: caller.sessionId,
        idempotencyKey: input.idempotencyKey.trim(),
        status: "pending",
        inputJson: jsonForDb(normalizedInput),
        revision: 0,
        steps: { create: stepDefinitions.map((step) => ({ stepKey: step.stepKey, sortOrder: step.sortOrder, status: "pending", definitionJson: jsonForDb(step.definitionJson), inputJson: jsonForDb(normalizedInput), revision: 0 })) },
      },
      include: { steps: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { sequence: "asc" } } },
    });
    await appendRunEvent(tx, created, caller, assignmentId, "run.created", { status: "pending", definitionVersion: definition.version, stepCount: stepDefinitions.length });
    return tx.workflowRun.findUniqueOrThrow({ where: { id: created.id }, include: { steps: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { sequence: "asc" } } } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await existingRunForIdempotency(tx, caller, input, normalizedInput);
    if (winner) return winner;
    throw new WorkflowRuntimeError("STALE_REVISION", "workflow run idempotency key changed concurrently");
  }
}

/** Starts a DB-backed pending run, with immutable U019 snapshots and DB-unique idempotency. */
export async function startWorkflowRun(input: StartWorkflowRunInput, caller: ApprovalKernelCaller, tx?: TxClient) {
  if (tx) return startWithClient(tx, input, caller);
  // A loser of the physical unique index race has an aborted PostgreSQL transaction, so its
  // recovery read must happen in a fresh transaction. Retry serialization failures briefly, then
  // resolve the committed winner by the same normalized idempotency comparison.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction((client) => startWithClient(client, input, caller), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      lastError = error;
      const retryable = isUniqueViolation(error) || (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034");
      if (!retryable) throw error;
      const winner = await prisma.$transaction((client) => existingRunForIdempotency(client, caller, input, normalizeWorkflowInput(input.input)));
      if (winner) return winner;
    }
  }
  throw lastError;
}

function assertTransitionInput(input: { expectedRevision: number; status: string }, type: string): void {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new WorkflowRuntimeError("VALIDATION_ERROR", "expectedRevision must be a non-negative integer");
  if (!input.status) throw new WorkflowRuntimeError("VALIDATION_ERROR", `${type} status is required`);
}

async function transitionRunWithClient(tx: TxClient, input: TransitionWorkflowRunInput, caller: ApprovalKernelCaller) {
  assertTransitionInput(input, "workflow run");
  if (!isRunStatus(input.status)) throw new WorkflowRuntimeError("VALIDATION_ERROR", "unknown workflow run status");
  const [assignmentId, run] = await Promise.all([resolveAssignmentId(tx, caller), tx.workflowRun.findUnique({ where: { id: input.workflowRunId } })]);
  if (!run) throw new WorkflowRuntimeError("NOT_FOUND", "workflow run not found");
  assertScope(run, caller, "workflow run");
  if (run.revision !== input.expectedRevision) throw new WorkflowRuntimeError("STALE_REVISION", "workflow run revision is stale");
  assertRunTransition(run.status as WorkflowRunStatus, input.status);
  if (input.status === "succeeded") {
    const incomplete = await tx.workflowRunStep.count({ where: { workflowRunId: run.id, status: { notIn: ["succeeded", "skipped"] } } });
    if (incomplete) throw new WorkflowRuntimeError("INVARIANT_VIOLATION", "workflow run cannot succeed until every step is succeeded or skipped");
  }
  if (input.status === "failed") {
    const failed = await tx.workflowRunStep.count({ where: { workflowRunId: run.id, status: "failed" } });
    if (!failed) throw new WorkflowRuntimeError("INVARIANT_VIOLATION", "workflow run cannot fail without a failed step");
  }
  const terminal = ["succeeded", "failed", "cancelled"].includes(input.status);
  const updated = await tx.workflowRun.updateMany({
    where: { id: run.id, revision: input.expectedRevision, status: run.status },
    data: { status: input.status, revision: { increment: 1 }, startedAt: run.startedAt ?? (input.status === "running" ? new Date() : undefined), completedAt: terminal ? new Date() : undefined },
  });
  if (updated.count !== 1) throw new WorkflowRuntimeError("STALE_REVISION", "workflow run changed concurrently");
  const result = await tx.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
  await appendRunEvent(tx, result, caller, assignmentId, "run.transitioned", { from: run.status, to: input.status, revision: result.revision });
  return tx.workflowRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { sequence: "asc" } } } });
}

export async function transitionWorkflowRun(input: TransitionWorkflowRunInput, caller: ApprovalKernelCaller, tx?: TxClient) {
  if (tx) return transitionRunWithClient(tx, input, caller);
  return prisma.$transaction((client) => transitionRunWithClient(client, input, caller), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function transitionStepWithClient(tx: TxClient, input: TransitionWorkflowStepInput, caller: ApprovalKernelCaller) {
  assertTransitionInput(input, "workflow step");
  if (!isStepStatus(input.status)) throw new WorkflowRuntimeError("VALIDATION_ERROR", "unknown workflow step status");
  const assignmentId = await resolveAssignmentId(tx, caller);
  const step = await tx.workflowRunStep.findUnique({ where: { id: input.workflowRunStepId }, include: { run: true } });
  if (!step) throw new WorkflowRuntimeError("NOT_FOUND", "workflow run step not found");
  assertScope(step.run, caller, "workflow run step");
  if (step.revision !== input.expectedRevision) throw new WorkflowRuntimeError("STALE_REVISION", "workflow run step revision is stale");
  assertStepTransition(step.status as WorkflowStepStatus, input.status);
  const terminal = ["succeeded", "failed", "skipped", "cancelled"].includes(input.status);
  const updated = await tx.workflowRunStep.updateMany({
    where: { id: step.id, revision: input.expectedRevision, status: step.status },
    data: { status: input.status, revision: { increment: 1 }, startedAt: step.startedAt ?? (input.status === "running" ? new Date() : undefined), completedAt: terminal ? new Date() : undefined, ...(input.output === undefined ? {} : { outputJson: jsonForDb(input.output) }) },
  });
  if (updated.count !== 1) throw new WorkflowRuntimeError("STALE_REVISION", "workflow run step changed concurrently");
  const result = await tx.workflowRunStep.findUniqueOrThrow({ where: { id: step.id } });
  await appendRunEvent(tx, step.run, caller, assignmentId, "step.transitioned", { stepId: step.id, stepKey: step.stepKey, from: step.status, to: input.status, revision: result.revision });
  return result;
}

export async function transitionWorkflowStep(input: TransitionWorkflowStepInput, caller: ApprovalKernelCaller, tx?: TxClient) {
  if (tx) return transitionStepWithClient(tx, input, caller);
  return prisma.$transaction((client) => transitionStepWithClient(client, input, caller), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getWorkflowRun(workflowRunId: string, caller: ApprovalKernelCaller, tx?: TxClient) {
  const load = async (client: TxClient) => {
    const run = await client.workflowRun.findUnique({ where: { id: workflowRunId }, include: { steps: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { sequence: "asc" } } } });
    if (!run) throw new WorkflowRuntimeError("NOT_FOUND", "workflow run not found");
    assertScope(run, caller, "workflow run");
    return run;
  };
  return tx ? load(tx) : prisma.$transaction(load);
}

export async function listWorkflowRuns(caller: ApprovalKernelCaller, limit = 20, tx?: TxClient) {
  const take = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
  const load = (client: TxClient) => client.workflowRun.findMany({
    where: { tenantId: caller.scope.tenantId, companyId: caller.scope.companyId, projectId: caller.scope.projectId },
    orderBy: { createdAt: "desc" },
    take,
    include: { steps: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { sequence: "asc" } } },
  });
  return tx ? load(tx) : prisma.$transaction(load);
}
