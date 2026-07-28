import { ARTIFACT_CONTENT_HASH_VERSION, canonicalizeRfc8785 } from "@sangfor/db";

/** U019's fixed content contract. U025 only verifies/reuses it; it never hashes definitions. */
export const WORKFLOW_DEFINITION_HASH_VERSION = ARTIFACT_CONTENT_HASH_VERSION;

export const RUN_STATUSES = ["pending", "running", "blocked", "succeeded", "failed", "cancelled", "legacy_imported"] as const;
export const STEP_STATUSES = ["pending", "running", "blocked", "succeeded", "failed", "skipped", "cancelled"] as const;
export type WorkflowRunStatus = (typeof RUN_STATUSES)[number];
export type WorkflowStepStatus = (typeof STEP_STATUSES)[number];

export type WorkflowRuntimeErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FOREIGN_SCOPE"
  | "STALE_REVISION"
  | "IDEMPOTENCY_CONFLICT"
  | "APPROVAL_REQUIRED"
  | "ACTIVE_DEFINITION_EXISTS"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "INVARIANT_VIOLATION";

const HTTP_STATUS: Record<WorkflowRuntimeErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FOREIGN_SCOPE: 403,
  STALE_REVISION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  APPROVAL_REQUIRED: 409,
  ACTIVE_DEFINITION_EXISTS: 409,
  ILLEGAL_TRANSITION: 409,
  TERMINAL_STATE: 409,
  INVARIANT_VIOLATION: 422,
};

export class WorkflowRuntimeError extends Error {
  readonly code: WorkflowRuntimeErrorCode;
  readonly httpStatus: number;

  constructor(code: WorkflowRuntimeErrorCode, message: string) {
    super(message);
    this.name = "WorkflowRuntimeError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

const RUN_EDGES: Readonly<Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>> = {
  pending: ["running", "cancelled"],
  running: ["blocked", "succeeded", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  legacy_imported: [],
};

const STEP_EDGES: Readonly<Record<WorkflowStepStatus, readonly WorkflowStepStatus[]>> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["blocked", "succeeded", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export function isRunStatus(value: string): value is WorkflowRunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

export function isStepStatus(value: string): value is WorkflowStepStatus {
  return (STEP_STATUSES as readonly string[]).includes(value);
}

export function assertRunTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): void {
  if (!isRunStatus(from) || !isRunStatus(to)) throw new WorkflowRuntimeError("VALIDATION_ERROR", "unknown workflow run status");
  if (["succeeded", "failed", "cancelled", "legacy_imported"].includes(from)) {
    throw new WorkflowRuntimeError("TERMINAL_STATE", `workflow run ${from} is terminal`);
  }
  if (!RUN_EDGES[from].includes(to)) throw new WorkflowRuntimeError("ILLEGAL_TRANSITION", `illegal workflow run transition ${from} -> ${to}`);
}

export function assertStepTransition(from: WorkflowStepStatus, to: WorkflowStepStatus): void {
  if (!isStepStatus(from) || !isStepStatus(to)) throw new WorkflowRuntimeError("VALIDATION_ERROR", "unknown workflow step status");
  if (["succeeded", "failed", "skipped", "cancelled"].includes(from)) {
    throw new WorkflowRuntimeError("TERMINAL_STATE", `workflow step ${from} is terminal`);
  }
  if (!STEP_EDGES[from].includes(to)) throw new WorkflowRuntimeError("ILLEGAL_TRANSITION", `illegal workflow step transition ${from} -> ${to}`);
}

function normalizeJson(value: unknown, path = "input"): null | boolean | number | string | unknown[] | Record<string, unknown> {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WorkflowRuntimeError("VALIDATION_ERROR", `${path} must contain finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeJson(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new WorkflowRuntimeError("VALIDATION_ERROR", `${path}.${key} is not JSON`);
      }
      result[key] = normalizeJson(item, `${path}.${key}`);
    }
    return result;
  }
  throw new WorkflowRuntimeError("VALIDATION_ERROR", `${path} is not JSON`);
}

/** A deterministic snapshot, not a definition serializer or hash producer. */
export function normalizeWorkflowInput(input: unknown): null | boolean | number | string | unknown[] | Record<string, unknown> {
  return normalizeJson(input);
}

export function jsonEquals(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeRfc8785(normalizeJson(left)) === canonicalizeRfc8785(normalizeJson(right));
  } catch {
    return false;
  }
}

export function assertWorkflowDefinitionEnvelope(value: { contentHashVersion: string; canonicalContentEnvelope: string; contentHash: string; contentJson?: unknown }): void {
  if (value.contentHashVersion !== WORKFLOW_DEFINITION_HASH_VERSION) {
    throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflow definition ArtifactVersion has an unsupported hash version");
  }
  if (!/^[0-9a-f]{64}$/.test(value.contentHash)) {
    throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflow definition ArtifactVersion has an invalid content hash");
  }
  if (value.contentJson !== undefined) {
    const expectedEnvelope = canonicalizeRfc8785({ contract: "sangfor.artifact-content", payload: value.contentJson, version: 1 });
    if (value.canonicalContentEnvelope !== expectedEnvelope) {
      throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflow definition ArtifactVersion canonical envelope does not match its U017 payload");
    }
  }
}

export interface WorkflowStepDefinition {
  readonly stepKey: string;
  readonly sortOrder: number;
  readonly definitionJson: Record<string, unknown>;
}

export function workflowStepDefinitions(definitionJson: unknown): readonly WorkflowStepDefinition[] {
  if (typeof definitionJson !== "object" || definitionJson === null || Array.isArray(definitionJson)) {
    throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflow definition payload must be an object");
  }
  const steps = (definitionJson as Record<string, unknown>).steps;
  if (steps === undefined) return [];
  if (!Array.isArray(steps)) throw new WorkflowRuntimeError("VALIDATION_ERROR", "workflow definition steps must be an array");
  const seen = new Set<string>();
  return steps.map((step, index) => {
    if (typeof step !== "object" || step === null || Array.isArray(step)) throw new WorkflowRuntimeError("VALIDATION_ERROR", `workflow step ${index} must be an object`);
    const normalized = normalizeJson(step, `steps[${index}]`);
    const record = normalized as Record<string, unknown>;
    const stepKey = typeof record.stepKey === "string" ? record.stepKey : typeof record.key === "string" ? record.key : "";
    if (!stepKey.trim() || seen.has(stepKey)) throw new WorkflowRuntimeError("VALIDATION_ERROR", `workflow step ${index} has a missing or duplicate key`);
    seen.add(stepKey);
    return { stepKey, sortOrder: index, definitionJson: record };
  });
}

export function requiresRunApproval(definitionJson: unknown): boolean {
  return typeof definitionJson === "object" && definitionJson !== null && !Array.isArray(definitionJson) && (definitionJson as Record<string, unknown>).runApprovalRequired === true;
}
