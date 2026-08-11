import { WorkflowRuntimeError, createWorkflowDefinition, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";

import { ApiError, API_ERRORS } from "../_lib/api-error";
import { createApiErrorResponse, createApiResponse } from "../_lib/api-response";
import { resolveApprovalKernelCaller } from "../_lib/resolve-caller";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = new Set(["workflowKey", "name", "definitionArtifactVersionId"]);

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function isResponse(value: ApprovalKernelCaller | Response): value is Response { return value instanceof Response; }

function bodyError(body: Record<string, unknown>): Response | null {
  for (const key of Object.keys(body)) {
    if (ALLOWED_KEYS.has(key)) continue;
    if (key === "tenantId" || key === "companyId" || key === "projectId") return createApiErrorResponse(new ApiError("FOREIGN_SCOPE", "scope is derived from the authenticated session", 403));
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR(`unknown field: ${key}`));
  }
  return null;
}

function runtimeError(error: WorkflowRuntimeError): Response { return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus)); }

/** Canonical immutable U019 definition creation. Artifact bytes/content remain U017/U023-owned. */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const caller = await resolveApprovalKernelCaller(request);
  if (isResponse(caller)) return caller;
  let body: unknown;
  try { body = await request.json(); } catch { return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body")); }
  if (!isRecord(body)) return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object"));
  const invalid = bodyError(body);
  if (invalid) return invalid;
  if (typeof body.workflowKey !== "string" || typeof body.name !== "string" || typeof body.definitionArtifactVersionId !== "string") {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("workflowKey, name, and definitionArtifactVersionId are required"));
  }
  try {
    const definition = await createWorkflowDefinition({ workflowKey: body.workflowKey, name: body.name, definitionArtifactVersionId: body.definitionArtifactVersionId }, caller);
    return createApiResponse({ definition }, 201);
  } catch (error) {
    if (error instanceof WorkflowRuntimeError) return runtimeError(error);
    console.error("[api] workflow_definition_create_failed:", error instanceof Error ? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
