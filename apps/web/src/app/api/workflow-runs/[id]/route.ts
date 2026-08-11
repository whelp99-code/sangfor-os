import { WorkflowRuntimeError, getWorkflowRun, transitionWorkflowRun, transitionWorkflowStep, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";

import { ApiError, API_ERRORS } from "../../_lib/api-error";
import { createApiErrorResponse, createApiResponse } from "../../_lib/api-response";
import { resolveApprovalKernelCaller } from "@/lib/auth/resolve-caller";

export const dynamic = "force-dynamic";
const ALLOWED_KEYS = new Set(["expectedRevision", "status", "stepId", "output"]);
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isResponse(value: ApprovalKernelCaller | Response): value is Response { return value instanceof Response; }
function rejectUnknown(body: Record<string, unknown>): Response | null {
  for (const key of Object.keys(body)) {
    if (ALLOWED_KEYS.has(key)) continue;
    if (key === "tenantId" || key === "companyId" || key === "projectId") return createApiErrorResponse(new ApiError("FOREIGN_SCOPE", "scope is derived from the authenticated session", 403));
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR(`unknown field: ${key}`));
  }
  return null;
}
function toError(error: unknown): Response {
  if (error instanceof WorkflowRuntimeError) return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
  console.error("[api] workflow_run_operation_failed:", error instanceof Error ? error.message : error);
  return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const caller = await resolveApprovalKernelCaller(request); if (isResponse(caller)) return caller;
  try { return createApiResponse({ run: await getWorkflowRun((await context.params).id, caller) }); } catch (error) { return toError(error); }
}
/** PATCH transitions the run, or an owned child step when stepId is present. Actor/scope are always session-derived. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const caller = await resolveApprovalKernelCaller(request); if (isResponse(caller)) return caller;
  let body: unknown; try { body = await request.json(); } catch { return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body")); }
  if (!isRecord(body)) return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object"));
  const unknown = rejectUnknown(body); if (unknown) return unknown;
  const expectedRevision = body.expectedRevision;
  if (!Number.isInteger(expectedRevision) || typeof body.status !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("expectedRevision and status are required"));
  try {
    const { id } = await context.params;
    if (body.stepId !== undefined) {
      if (typeof body.stepId !== "string") return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("stepId must be a string"));
      const step = await transitionWorkflowStep({ workflowRunStepId: body.stepId, expectedRevision: expectedRevision as number, status: body.status as never, output: body.output }, caller);
      if (step.workflowRunId !== id) return createApiErrorResponse(API_ERRORS.NOT_FOUND());
      return createApiResponse({ step });
    }
    return createApiResponse({ run: await transitionWorkflowRun({ workflowRunId: id, expectedRevision: expectedRevision as number, status: body.status as never }, caller) });
  } catch (error) { return toError(error); }
}
