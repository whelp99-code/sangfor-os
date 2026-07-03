import { validateActionWithDb } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { createApiResponse, createApiErrorResponse } from "../../../_lib/api-response";
import { API_ERRORS } from "../../../_lib/api-error";

type RouteContext = { params: Promise<{ actionKey: string }> };

export async function POST(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const { actionKey } = await context.params;
    const validation = await validateActionWithDb(actionKey);
    if (validation.errors.includes("action_not_found")) {
      return createApiResponse(validation, 404);
    }
    const status = validation.valid ? 200 : 400;
    return createApiResponse(validation, status);
  } catch (error) {
    console.error("[api] validate_action_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
