import { WorkflowRuntimeError, listWorkflowRuns, startWorkflowRun, type ApprovalKernelCaller } from "@sangfor/business";

import { assertApiAccess } from "@/lib/api-auth";

import { ApiError, API_ERRORS } from "../_lib/api-error";
import { createApiErrorResponse, createApiResponse } from "../_lib/api-response";
import { resolveApprovalKernelCaller } from "../_lib/resolve-caller";

export const dynamic = "force-dynamic";
const ALLOWED_KEYS = new Set(["workflowDefinitionId", "idempotencyKey", "input", "runApprovalId"]);
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
export async function POST(request: Request) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const caller = await resolveApprovalKernelCaller(request); if (isResponse(caller)) return caller;
  let body: unknown; try { body = await request.json(); } catch { return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("invalid JSON body")); }
  if (!isRecord(body)) return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("request body must be a JSON object"));
  const unknown = rejectUnknown(body); if (unknown) return unknown;
  if (typeof body.workflowDefinitionId !== "string" || typeof body.idempotencyKey !== "string" || !("input" in body) || (body.runApprovalId !== undefined && typeof body.runApprovalId !== "string")) {
    return createApiErrorResponse(API_ERRORS.VALIDATION_ERROR("workflowDefinitionId, idempotencyKey, and input are required; runApprovalId must be a string when supplied"));
  }
  try { return createApiResponse({ run: await startWorkflowRun({ workflowDefinitionId: body.workflowDefinitionId, idempotencyKey: body.idempotencyKey, input: body.input, runApprovalId: body.runApprovalId as string | undefined }, caller) }, 201); }
  catch (error) {
    if (error instanceof WorkflowRuntimeError) return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
    console.error("[api] workflow_run_start_failed:", error instanceof Error ? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
export async function GET(request: Request) {
  const denied = assertApiAccess(request); if (denied) return denied;
  const caller = await resolveApprovalKernelCaller(request); if (isResponse(caller)) return caller;
  const raw = Number(new URL(request.url).searchParams.get("limit"));
  try { return createApiResponse({ runs: await listWorkflowRuns(caller, Number.isFinite(raw) ? raw : 20) }); }
  catch (error) {
    if (error instanceof WorkflowRuntimeError) return createApiErrorResponse(new ApiError(error.code, error.message, error.httpStatus));
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
