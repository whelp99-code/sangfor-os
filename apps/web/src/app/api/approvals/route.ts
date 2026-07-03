import { approveRequest } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export async function PATCH(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { approvalId } = body as { approvalId: string };
    const approval = await approveRequest(approvalId);
    return createApiResponse({ approval });
  } catch (error) {
    console.error("[api] approve_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
